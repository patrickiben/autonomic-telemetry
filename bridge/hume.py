"""Experimental Hume/J2208 live heart-rate adapter; no BLE scan at import or run.

Protocol reference: brendangooden/j2208-band-tools, commit
62ce48357e25d1c68e4c3e0bfd8d2cf1bbd745e9. Upstream reports verification on one
Hume Band V2, firmware v0.0.3.9. Live HR with 20-second renewals was also
checked on the owner's Hume Band V2 on 2026-10-22: 84 valid responses over a
90-second interval after warm-up, longest gap 3 seconds. This verifies that
transport on that unit, not physiological accuracy or all firmware versions.
Only live-heart start/stop commands are sent. No settings, history, firmware,
raw PPG, RR intervals, HRV, stress, or blood-pressure values are requested.

Protocol command framing and field interpretation adapted from:
MIT License, Copyright (c) 2026 Brendan Gooden

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
"""

from __future__ import annotations

import asyncio
import inspect
import time
from typing import Any, Callable

SERVICE = "0000fff0-0000-1000-8000-00805f9b34fb"
CHAR_WRITE = "0000fff6-0000-1000-8000-00805f9b34fb"
CHAR_NOTIFY = "0000fff7-0000-1000-8000-00805f9b34fb"
FRESH_SECONDS = 5.0
WARMUP_SECONDS = 30.0
POLL_SECONDS = 0.25
RENEWAL_SECONDS = 20.0
PROTOCOL = "j2208-live-0x28"


class InvalidPacket(ValueError):
    """A live-heart frame was incomplete or failed its checksum."""


class MeasurementRejected(RuntimeError):
    """The band explicitly rejected the live measurement command."""


class _Stopped(Exception):
    pass


def heart_command(start: bool) -> bytes:
    """The sole command builder: type-2 heart measurement, start or stop."""
    packet = bytearray(16)
    packet[0:3] = bytes((0x28, 0x02, int(bool(start))))
    packet[15] = sum(packet[:15]) & 0xFF
    return bytes(packet)


def decode_live_heart(payload: bytes | bytearray) -> float | None:
    """Return current type-2 HR; ignore unrelated modes and warm-up zero.

    Rejection is an error, malformed live packets raise InvalidPacket, and
    other packet types are ignored. The device-reported integer is not a
    validated heart rate or a beat interval. It must not be converted to RMSSD.
    """
    data = bytes(payload)
    if not data or data[0] != 0x28:
        return None
    # Firmware can use a two-byte rejection instead of a full reply.
    if data == bytes((0x28, 0xFF)):
        raise MeasurementRejected("Band rejected live heart measurement.")
    if len(data) != 16:
        raise InvalidPacket("Expected a complete 16-byte live-heart frame.")
    if sum(data[:15]) & 0xFF != data[15]:
        raise InvalidPacket("Live-heart checksum mismatch.")
    if data[1] == 0xFF:
        raise MeasurementRejected("Band rejected live heart measurement.")
    if data[1] != 2 or data[2] == 0:
        return None
    return float(data[2])


async def _call(callback: Callable[[dict[str, Any]], Any], value: dict[str, Any]) -> None:
    result = callback(value)
    if inspect.isawaitable(result):
        await result


async def _until_stop(awaitable: Any, stop: asyncio.Event) -> Any:
    """Make setup cancellable without leaving an unobserved BLE task."""
    work = asyncio.ensure_future(awaitable)
    stopping = asyncio.create_task(stop.wait())
    try:
        done, _ = await asyncio.wait((work, stopping), return_when=asyncio.FIRST_COMPLETED)
        if stopping in done and stop.is_set():
            work.cancel()
            await asyncio.gather(work, return_exceptions=True)
            raise _Stopped()
        return await work
    finally:
        for task in (work, stopping):
            if not task.done():
                task.cancel()
        await asyncio.gather(work, stopping, return_exceptions=True)


async def run_hume(
    device: Any,
    emit: Callable[[dict[str, Any]], Any],
    status: Callable[[dict[str, Any]], Any],
    stop: asyncio.Event,
) -> None:
    """Connect a discovered BLEDevice and emit live device-reported HR.

    Both callbacks may be synchronous or asynchronous. This function performs
    no scanning and never reconnects automatically. The caller owns device
    selection and retries. A set stop event or task cancellation requests a
    best-effort measurement stop followed by unsubscribe and disconnect.
    """
    if stop.is_set():
        await _call(status, {"device": "hume", "phase": "disconnected", "message": "Hume connection stopped before starting."})
        return
    try:
        from bleak import BleakClient  # optional dependency, loaded only on use
    except ImportError:
        await _call(status, {"device": "hume", "phase": "error", "message": "Install the bridge's bleak dependency to connect Hume."})
        return

    loop = asyncio.get_running_loop()
    inbox: asyncio.Queue[tuple[int, float, bytes]] = asyncio.Queue(maxsize=256)
    disconnected = asyncio.Event()
    accepting = True
    client = None
    write_characteristic = None
    subscribed = False
    measurement_started = False
    last_phase: str | None = None
    rejected_packets = 0
    queue_drops = 0
    terminal_error = False

    async def report(phase: str, message: str) -> None:
        nonlocal last_phase
        if phase == last_phase:
            return
        last_phase = phase
        await _call(status, {"device": "hume", "phase": phase, "message": message,
                             "rejected_packets": rejected_packets, "queue_drops": queue_drops})

    def on_disconnect(_client: Any) -> None:
        if accepting:
            loop.call_soon_threadsafe(disconnected.set)

    def enqueue(received_at: int, arrived: float, data: bytes) -> None:
        nonlocal queue_drops
        if not accepting or stop.is_set():
            return
        if inbox.full():
            inbox.get_nowait()
            queue_drops += 1
        inbox.put_nowait((received_at, arrived, data))

    def on_notify(_characteristic: Any, data: bytearray) -> None:
        if accepting:
            loop.call_soon_threadsafe(enqueue, round(time.time() * 1000), time.monotonic(), bytes(data))

    try:
        await report("connecting", "Connecting to Hume. Close the Hume app if it is holding the band.")
        client = BleakClient(device, disconnected_callback=on_disconnect, timeout=20.0)
        await _until_stop(client.connect(), stop)
        if stop.is_set():
            raise _Stopped()
        service = client.services.get_service(SERVICE)
        if service is None:
            raise RuntimeError("Selected device does not expose the Hume/J2208 FFF0 service.")
        write_characteristic = service.get_characteristic(CHAR_WRITE)
        if write_characteristic is None or service.get_characteristic(CHAR_NOTIFY) is None:
            raise RuntimeError("Selected device lacks the required FFF6 write / FFF7 notify characteristics.")
        properties = set(write_characteristic.properties)
        if not properties.intersection({"write", "write-without-response"}):
            raise RuntimeError("Hume write characteristic has no supported write mode.")
        response = "write-without-response" not in properties
        subscribed = True
        await _until_stop(client.start_notify(CHAR_NOTIFY, on_notify), stop)
        # Subscribe before starting. This owner's band stopped notifying after
        # roughly 30 seconds in a physical diagnostic, so renew only the same
        # reversible live-heart request; no configuration is changed.
        measurement_started = True
        await _until_stop(client.write_gatt_char(write_characteristic, heart_command(True), response=response), stop)
        connected_at = time.monotonic()
        next_renewal = connected_at + RENEWAL_SECONDS
        last_valid: float | None = None
        await report("waiting", "Hume connected; waiting for a nonzero current heart-rate reading. Allow about 30 seconds while worn.")
        while not stop.is_set() and not disconnected.is_set():
            try:
                received_at, arrived, payload = await asyncio.wait_for(inbox.get(), timeout=POLL_SECONDS)
            except asyncio.TimeoutError:
                pass
            else:
                if stop.is_set() or disconnected.is_set():
                    break
                # A slow consumer must never make an old queued packet look live.
                if time.monotonic() - arrived <= FRESH_SECONDS:
                    try:
                        hr = decode_live_heart(payload)
                    except InvalidPacket:
                        rejected_packets += 1
                    else:
                        if hr is not None:
                            last_valid = arrived
                            await report("streaming", "Receiving current Hume device-reported heart rate; no RR intervals, RMSSD, or raw PPG are inferred.")
                            await _call(emit, {"type": "heart_rate", "device": "hume", "heart_rate_bpm": hr,
                                               "received_at": received_at, "source": "device-reported",
                                               "protocol": PROTOCOL, "measurement_type": "heart"})
            now = time.monotonic()
            if last_valid is not None and now - last_valid > FRESH_SECONDS:
                await report("stale", "No valid Hume heart-rate reading for over five seconds. Retained values are not live.")
            elif last_valid is None and now - connected_at > WARMUP_SECONDS:
                await report("stale", "No valid nonzero heart-rate reading yet. Check fit, wear the band, and reconnect if needed; no measurement is substituted.")
            if (not stop.is_set() and not disconnected.is_set()
                    and getattr(client, "is_connected", False) and now >= next_renewal):
                # Renewals do not refresh last_valid or change the phase.
                # Only a new validated nonzero response can establish live HR.
                await _until_stop(client.write_gatt_char(write_characteristic, heart_command(True), response=response), stop)
                next_renewal = time.monotonic() + RENEWAL_SECONDS
    except _Stopped:
        pass
    except asyncio.CancelledError:
        raise
    except Exception as error:
        terminal_error = True
        await report("error", f"Hume live connection failed: {error}")
    finally:
        accepting = False
        if client is not None:
            if measurement_started and getattr(client, "is_connected", False) and write_characteristic is not None:
                try:
                    response = "write-without-response" not in set(write_characteristic.properties)
                    await asyncio.wait_for(client.write_gatt_char(write_characteristic, heart_command(False), response=response), timeout=3)
                except Exception:
                    pass
            if subscribed and getattr(client, "is_connected", False):
                try:
                    await asyncio.wait_for(client.stop_notify(CHAR_NOTIFY), timeout=3)
                except Exception:
                    pass
            if getattr(client, "is_connected", False):
                try:
                    await asyncio.wait_for(client.disconnect(), timeout=5)
                except Exception:
                    pass
        if not terminal_error:
            await report("disconnected", "Hume live connection stopped. No retained measurement should be labeled live.")
