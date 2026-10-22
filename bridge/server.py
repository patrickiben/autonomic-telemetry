"""Serve the app and a bounded, authenticated-by-link local SSE wearable relay.

No accounts, cloud relay, health database, recording, or automatic pairing.
Bluetooth is accessed only after an explicit scan/connect action.
"""
from __future__ import annotations

import argparse
import asyncio
import contextlib
import hashlib
import json
import mimetypes
from pathlib import Path
import queue
import secrets
import signal
import socket
import subprocess
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit, unquote
import webbrowser

ROOT = Path(__file__).resolve().parent.parent
PHASES = {"idle", "connecting", "waiting", "streaming", "stale", "disconnected", "error"}


def now_ms():
    return int(time.time() * 1000)


class Hub:
    """Latest status plus bounded per-listener queues; nothing is saved to disk."""
    def __init__(self, simulated=False):
        self.lock = threading.RLock()
        self.session = secrets.token_urlsafe(16)
        self.simulated = simulated
        self.sequence = 0
        self.listeners = set()
        self.devices = {kind: {"device": kind, "phase": "idle", "message": "Not connected"}
                        for kind in ("muse", "hume")}
        self.discovery = {"devices": [], "scanning": False, "error": ""}
        self.latest_hr = None

    def snapshot(self):
        with self.lock:
            return json.loads(json.dumps({"session": self.session, "sequence": self.sequence,
                "server_now": now_ms(), "simulated": self.simulated,
                "devices": self.devices, "discovery": self.discovery, "heart_rate": self.latest_hr}))

    def publish(self, kind, data):
        with self.lock:
            self.sequence += 1
            data = dict(data)
            data["source"] = "synthetic" if self.simulated else "device-reported"
            if kind == "status":
                device = data.get("device")
                if device not in self.devices or data.get("phase") not in PHASES:
                    return
                self.devices[device] = data
            elif kind == "devices":
                self.discovery = data
            elif kind == "raw" and data.get("type") == "heart_rate":
                self.latest_hr = data
            event = {"kind": kind, "payload": data, "session": self.session,
                     "sequence": self.sequence}
            for subscriber in tuple(self.listeners):
                if subscriber.full():
                    with contextlib.suppress(queue.Empty):
                        subscriber.get_nowait()
                with contextlib.suppress(queue.Full):
                    subscriber.put_nowait(event)

    def subscribe(self):
        with self.lock:
            if len(self.listeners) >= 12:
                raise RuntimeError("Too many open dashboard connections; close an unused tab.")
            subscriber = queue.Queue(maxsize=256)
            self.listeners.add(subscriber)
            return subscriber

    def unsubscribe(self, subscriber):
        with self.lock:
            self.listeners.discard(subscriber)


class Engine:
    def __init__(self, hub):
        self.hub = hub
        self.loop = asyncio.new_event_loop()
        self.thread = threading.Thread(target=self._run, daemon=True, name="wearable-relay")
        self.available = {}
        self.runs = {}
        self.generation = {"muse": 0, "hume": 0}
        self.scan_lock = None
        self.device_locks = {}
        from .features import FeatureExtractor
        self.features = FeatureExtractor()

    def _run(self):
        asyncio.set_event_loop(self.loop)
        self.scan_lock = asyncio.Lock()
        self.device_locks = {kind: asyncio.Lock() for kind in self.generation}
        self.loop.run_forever()

    def start(self):
        self.thread.start()

    def command(self, action, device=None, identifier=None):
        if action == "scan":
            future = asyncio.run_coroutine_threadsafe(self.scan(), self.loop)
        elif action in ("connect", "disconnect") and device in self.generation:
            if action == "connect":
                future = asyncio.run_coroutine_threadsafe(self.connect(device, identifier), self.loop)
            else:
                future = asyncio.run_coroutine_threadsafe(self.disconnect(device), self.loop)
        else:
            raise ValueError("Choose scan, connect, or disconnect and a supported device.")
        # Exceptions are reported to the UI without exposing addresses or tracebacks.
        def completed(result):
            try:
                result.result()
            except Exception as error:
                if device in self.generation:
                    self.hub.publish("status", {"device": device, "phase": "error", "message": str(error)[:300]})
                else:
                    self.hub.publish("devices", {"devices": [], "scanning": False, "error": str(error)[:300]})
        future.add_done_callback(completed)

    async def scan(self):
        if self.scan_lock.locked():
            return
        async with self.scan_lock:
            self.hub.publish("devices", {"devices": [], "scanning": True, "error": ""})
            if self.hub.simulated:
                await asyncio.sleep(0.1)
                self.available = {"demo-muse": "muse", "demo-hume": "hume"}
                self.hub.publish("devices", {"scanning": False, "error": "", "devices": [
                    {"id": "demo-muse", "name": "Synthetic Muse", "kind": "muse", "rssi": None},
                    {"id": "demo-hume", "name": "Synthetic Hume", "kind": "hume", "rssi": None}]})
                return
            try:
                from bleak import BleakScanner
                found = await BleakScanner.discover(timeout=8, return_adv=True)
                devices, available = [], {}
                for candidate, advert in found.values():
                    name = (advert.local_name or candidate.name or "Unnamed wearable")[:80]
                    lower = name.lower()
                    uuids = [str(value).lower() for value in (advert.service_uuids or [])]
                    # FFF0 is also used by lights and many unrelated peripherals.
                    # Only advertise the known band family as a Hume candidate.
                    kind = "muse" if "muse" in lower or any("fe8d" in u for u in uuids) else (
                        "hume" if "hume band" in lower or lower.startswith(("2301b", "x3b")) else None)
                    if not kind:
                        continue
                    identifier = hashlib.sha256((self.hub.session + candidate.address).encode()).hexdigest()[:20]
                    available[identifier] = (candidate, kind, name)
                    devices.append({"id": identifier, "name": name, "kind": kind,
                                    "rssi": getattr(advert, "rssi", None)})
                self.available = available
                self.hub.publish("devices", {"devices": devices[:50], "scanning": False, "error": ""})
            except Exception as error:
                self.hub.publish("devices", {"devices": [], "scanning": False,
                    "error": "Bluetooth scan could not complete. Allow Bluetooth for the launcher or Terminal in macOS System Settings, turn Bluetooth on, and try again. " + str(error)[:180]})

    async def disconnect(self, kind):
        async with self.device_locks[kind]:
            await self._disconnect(kind)

    async def _disconnect(self, kind):
        self.generation[kind] += 1
        self.features.reset(kind)
        running = self.runs.pop(kind, None)
        if running:
            stop, task = running
            stop.set()
            try:
                await asyncio.wait_for(asyncio.shield(task), timeout=10)
            except (asyncio.TimeoutError, asyncio.CancelledError):
                task.cancel()
                with contextlib.suppress(asyncio.CancelledError, Exception):
                    await task
        self.hub.publish("status", {"device": kind, "phase": "disconnected", "message": "Disconnected"})

    async def connect(self, kind, identifier):
        async with self.device_locks[kind]:
            await self._connect(kind, identifier)

    async def _connect(self, kind, identifier):
        selected = self.available.get(identifier)
        if selected is None:
            raise ValueError("Scan again, then choose your wearable.")
        if (selected if self.hub.simulated else selected[1]) != kind:
            raise ValueError("Choose the matching wearable type.")
        await self._disconnect(kind)
        generation = self.generation[kind]
        stop = asyncio.Event()
        name = "Synthetic " + kind.title() if self.hub.simulated else selected[2]
        def emit(payload):
            if generation == self.generation[kind] and not stop.is_set():
                raw = {**payload, "device": kind, "source": "synthetic" if self.hub.simulated else "device-reported"}
                self.hub.publish("raw", raw)
                frame = self.features.consume(raw)
                if frame is not None:
                    self.hub.publish("features", frame)
        def status(payload):
            if generation == self.generation[kind] and not stop.is_set():
                if payload.get("phase") in {"error", "disconnected", "stale"}:
                    self.features.reset(kind)
                self.hub.publish("status", {**payload, "device": kind, "deviceName": name})
        if self.hub.simulated:
            routine = self.simulate(kind, emit, status, stop)
        elif kind == "muse":
            from .muse import run_muse
            routine = run_muse(selected[0], emit, status, stop)
        else:
            from .hume import run_hume
            routine = run_hume(selected[0], emit, status, stop)
        self.runs[kind] = (stop, asyncio.create_task(routine))

    async def simulate(self, kind, emit, status, stop):
        import math
        status({"phase": "waiting", "message": "Synthetic bridge test; no wearable data"})
        index = 0
        while not stop.is_set():
            stamp = now_ms()
            if kind == "hume":
                emit({"type": "heart_rate", "heart_rate_bpm": 68 + 4 * math.sin(index / 35), "received_at": stamp})
            else:
                samples = [18 * math.sin((index * 12 + i) * 0.11) + 5 * math.cos((index * 12 + i) * 0.23) for i in range(12)]
                emit({"type": "eeg", "channel": 0, "samples": samples, "index": index, "received_at": stamp})
                emit({"type": "ppg", "channel": 1, "samples": [150000 + 6000 * math.sin((index * 6 + i) * .12) for i in range(6)], "index": index, "received_at": stamp})
                emit({"type": "acc", "channel": 0, "samples": [{"x": .01 * math.sin(index * .1), "y": .02, "z": 1.0}], "index": index, "received_at": stamp})
            status({"phase": "streaming", "message": "Synthetic bridge test; no wearable data"})
            index += 1
            try:
                await asyncio.wait_for(stop.wait(), timeout=1.2 if kind == "hume" else .08)
            except asyncio.TimeoutError:
                pass

    def close(self):
        async def stop_all():
            await asyncio.gather(*(self.disconnect(kind) for kind in self.generation), return_exceptions=True)
            pending = [task for task in asyncio.all_tasks() if task is not asyncio.current_task()]
            for task in pending:
                task.cancel()
            await asyncio.gather(*pending, return_exceptions=True)
        with contextlib.suppress(Exception):
            asyncio.run_coroutine_threadsafe(stop_all(), self.loop).result(timeout=14)
        self.loop.call_soon_threadsafe(self.loop.stop)
        self.thread.join(timeout=2)


class RelayServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True


def handler_for(hub, engine, token):
    prefix = "/" + token + "/"
    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def log_message(self, *args):
            pass  # Never log private pairing URLs, device identifiers, or health values.

        def relative_path(self):
            path = unquote(urlsplit(self.path).path)
            if not path.startswith(prefix):
                return None
            return path[len(prefix):]

        def headers_common(self):
            self.send_header("Cache-Control", "no-store, max-age=0")
            self.send_header("Referrer-Policy", "no-referrer")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("X-Frame-Options", "DENY")

        def reply(self, code, body, content_type="application/json; charset=utf-8"):
            if not isinstance(body, (str, bytes)):
                body = json.dumps(body, allow_nan=False)
            body = body.encode("utf-8") if isinstance(body, str) else body
            self.send_response(code)
            self.headers_common()
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            relative = self.relative_path()
            if relative is None:
                return self.reply(404, {"error": "Open the private link shown by your Mac bridge."})
            if relative == "api/state":
                return self.reply(200, hub.snapshot())
            if relative == "api/events":
                return self.events()
            if relative == "pair.svg":
                phone_url = getattr(self.server, "phone_url", "")
                if not phone_url:
                    return self.reply(503, {"error": "No phone address is available on this network."})
                try:
                    import qrcode
                    from qrcode.image.svg import SvgPathImage
                    svg = qrcode.make(phone_url, image_factory=SvgPathImage, border=4).to_string()
                    return self.reply(200, svg, "image/svg+xml")
                except ImportError:
                    return self.reply(503, {"error": "Run the launcher to install the local QR-code dependency."})
            relative = relative or "index.html"
            if ".." in Path(relative).parts or "\\" in relative:
                return self.reply(404, {"error": "File not found"})
            safe = relative in {"index.html", "Autonomic_Telemetry_Console.html", "Autonomic_Telemetry_Signal_Lab.html", "Autonomic_Telemetry_Field_Guide.html", "README.md"}
            safe = safe or (relative.startswith("docs/") and len(Path(relative).parts) == 2 and Path(relative).suffix in {".md", ".png"})
            safe = safe or relative in {"examples/demo-session.json", "examples/session-template.csv", "examples/README.md"}
            filename = (ROOT / relative).resolve()
            if not safe or not filename.is_relative_to(ROOT) or not filename.is_file():
                return self.reply(404, {"error": "File not found"})
            body = filename.read_bytes()
            if relative == "Autonomic_Telemetry_Console.html":
                html = body.decode("utf-8")
                html = html.replace("connect-src 'none'", "connect-src 'self'")
                # Only the relay-served copy connects to this same server. Public HTML stays offline.
                config = json.dumps({"base": prefix, "session": hub.session, "simulated": hub.simulated,
                    "phoneUrl": getattr(self.server, "phone_url", ""), "qrUrl": prefix + "pair.svg"})
                client = (ROOT / "bridge/client.js").read_text()
                html = html.replace("</body>", "<script>window.__AUTONOMIC_RELAY__=" + config + ";\n" + client + "\n</script></body>")
                body = html.encode("utf-8")
            content_type = mimetypes.guess_type(str(filename))[0] or "application/octet-stream"
            if content_type.startswith("text/"):
                content_type += "; charset=utf-8"
            self.reply(200, body, content_type)

        def events(self):
            try:
                subscriber = hub.subscribe()
            except RuntimeError as error:
                return self.reply(503, {"error": str(error)})
            def send(event):
                event = {**event, "server_sent_at": now_ms()}
                self.wfile.write(("data: " + json.dumps(event, allow_nan=False, separators=(",", ":")) + "\n\n").encode())
                self.wfile.flush()
            try:
                self.send_response(200)
                self.headers_common()
                self.send_header("Content-Type", "text/event-stream")
                self.send_header("Connection", "keep-alive")
                self.send_header("X-Accel-Buffering", "no")
                self.end_headers()
                self.connection.settimeout(5)
                send({"kind": "hello", "payload": hub.snapshot(), "session": hub.session, "sequence": hub.sequence})
                while True:
                    try:
                        event = subscriber.get(timeout=1)
                    except queue.Empty:
                        event = {"kind": "heartbeat", "payload": {}, "session": hub.session, "sequence": hub.sequence}
                    send(event)
            except (BrokenPipeError, ConnectionResetError, TimeoutError, OSError):
                pass
            finally:
                hub.unsubscribe(subscriber)
                self.close_connection = True

        def do_POST(self):
            if self.relative_path() != "api/control":
                return self.reply(404, {"error": "Unknown route"})
            origin = self.headers.get("Origin", "")
            expected = "http://" + self.headers.get("Host", "")
            if origin != expected or self.headers.get("Sec-Fetch-Site") == "cross-site":
                return self.reply(403, {"error": "Controls must come from the dashboard's own local address."})
            if self.headers.get("Content-Type", "").split(";")[0].strip() != "application/json":
                return self.reply(415, {"error": "JSON controls required"})
            try:
                length = int(self.headers.get("Content-Length", "0"))
                if not 0 < length <= 2048:
                    return self.reply(413, {"error": "Invalid request size"})
                data = json.loads(self.rfile.read(length))
                if not isinstance(data, dict):
                    raise ValueError("Invalid control")
                engine.command(data.get("action"), data.get("device"), data.get("id"))
                self.reply(202, {"accepted": True})
            except (ValueError, TypeError, json.JSONDecodeError):
                self.reply(400, {"error": "Invalid control request"})
    return Handler


def local_addresses():
    addresses = {"127.0.0.1"}
    preferred = []
    # Wi-Fi/Ethernet addresses are more useful to a nearby phone than a VPN route.
    if Path("/usr/sbin/ipconfig").exists():
        for interface in ("en0", "en1", "en2"):
            with contextlib.suppress(OSError, subprocess.TimeoutExpired):
                result = subprocess.run(["/usr/sbin/ipconfig", "getifaddr", interface],
                    capture_output=True, text=True, timeout=2)
                address = result.stdout.strip()
                with contextlib.suppress(OSError):
                    socket.inet_pton(socket.AF_INET, address)
                    if address and not address.startswith("127."):
                        preferred.append(address)
                        addresses.add(address)
    with contextlib.suppress(OSError):
        for row in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            addresses.add(row[4][0])
    with contextlib.suppress(OSError):
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as connection:
            connection.connect(("192.0.2.1", 9))  # Route lookup only; no packet is sent.
            addresses.add(connection.getsockname()[0])
    return sorted(addresses, key=lambda value: (value not in preferred, value == "127.0.0.1", value))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--open", action="store_true", help="Open this dashboard on the Mac")
    parser.add_argument("--simulate", action="store_true", help="Explicit synthetic transport test; never reads Bluetooth")
    args = parser.parse_args()
    if not 0 <= args.port <= 65535:
        parser.error("Port must be 0–65535")
    token = secrets.token_urlsafe(24)
    hub = Hub(args.simulate)
    engine = Engine(hub)
    server = RelayServer((args.host, args.port), handler_for(hub, engine, token))
    engine.start()
    port = server.server_address[1]
    addresses = local_addresses()
    phone_address = next((address for address in addresses if address != "127.0.0.1" and args.host in ("0.0.0.0", address)), None)
    server.phone_url = f"http://{phone_address}:{port}/{token}/" if phone_address else ""
    print("\nAutonomic Telemetry · local iPhone bridge", flush=True)
    print("SYNTHETIC TEST — no wearable data" if args.simulate else "Ready · Bluetooth starts only when you choose Scan / Connect.", flush=True)
    print("Keep this Mac awake. Open a private link below on your iPhone on the same trusted Wi-Fi.", flush=True)
    for address in addresses:
        if args.host in ("0.0.0.0", address):
            print(f"http://{address}:{port}/{token}/", flush=True)
    print("Links grant local control. Local Wi-Fi transport is HTTP. Ctrl+C stops both devices.\n", flush=True)
    if args.open:
        webbrowser.open(f"http://127.0.0.1:{port}/{token}/")
    def stop_server(*_):
        threading.Thread(target=server.shutdown, daemon=True).start()
    signal.signal(signal.SIGINT, stop_server)
    signal.signal(signal.SIGTERM, stop_server)
    try:
        server.serve_forever(poll_interval=.25)
    finally:
        engine.close()
        server.server_close()


if __name__ == "__main__":
    main()
