"""Local HTTP/SSE relay checks using synthetic data only, without Bleak."""

import asyncio
import http.client
import json
import queue
import threading
import time
import unittest

try:
    from bridge import server
except ModuleNotFoundError:
    import server


class HubTests(unittest.TestCase):
    def test_snapshots_are_independent_and_raw_has_honest_provenance(self):
        hub = server.Hub(simulated=True)
        snapshot = hub.snapshot()
        snapshot["devices"]["muse"]["phase"] = "streaming"
        self.assertEqual(hub.snapshot()["devices"]["muse"]["phase"], "idle")
        subscriber = hub.subscribe()
        hub.publish("raw", {"device": "muse", "type": "eeg", "samples": [1], "source": "device-reported"})
        event = subscriber.get_nowait()
        self.assertEqual(event["payload"]["source"], "synthetic")
        self.assertEqual(event["session"], hub.snapshot()["session"])
        self.assertEqual(event["sequence"], 1)

    def test_per_listener_queue_is_bounded_and_retains_newest(self):
        hub = server.Hub()
        subscriber = hub.subscribe()
        for index in range(400):
            hub.publish("raw", {"device": "muse", "type": "eeg", "index": index})
        self.assertEqual(subscriber.qsize(), 256)
        self.assertEqual(subscriber.get_nowait()["payload"]["index"], 144)
        while subscriber.qsize() > 1:
            subscriber.get_nowait()
        self.assertEqual(subscriber.get_nowait()["payload"]["index"], 399)
        hub.unsubscribe(subscriber)
        self.assertNotIn(subscriber, hub.listeners)

    def test_listener_limit_and_reuse(self):
        hub = server.Hub()
        listeners = [hub.subscribe() for _ in range(12)]
        with self.assertRaises(RuntimeError):
            hub.subscribe()
        hub.unsubscribe(listeners[0])
        self.assertIsInstance(hub.subscribe(), queue.Queue)

    def test_invalid_status_cannot_create_a_device_or_live_phase(self):
        hub = server.Hub()
        subscriber = hub.subscribe()
        hub.publish("status", {"device": "unknown", "phase": "streaming"})
        hub.publish("status", {"device": "muse", "phase": "live"})
        self.assertEqual(hub.snapshot()["devices"]["muse"]["phase"], "idle")
        self.assertTrue(subscriber.empty())


class LocalRelayTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.hub = server.Hub(simulated=True)
        cls.engine = server.Engine(cls.hub)
        cls.token = "test-private-local-link"
        cls.httpd = server.RelayServer(("127.0.0.1", 0), server.handler_for(cls.hub, cls.engine, cls.token))
        cls.engine.start()
        cls.thread = threading.Thread(target=cls.httpd.serve_forever, kwargs={"poll_interval": 0.02}, daemon=True)
        cls.thread.start()
        cls.host = "127.0.0.1:" + str(cls.httpd.server_address[1])
        cls.prefix = "/" + cls.token + "/"

    @classmethod
    def tearDownClass(cls):
        cls.engine.close()
        cls.httpd.shutdown()
        cls.httpd.server_close()
        cls.thread.join(timeout=2)
        cls.engine.loop.close()

    def request(self, path, method="GET", payload=None, headers=None):
        connection = http.client.HTTPConnection(self.host, timeout=3)
        try:
            connection.request(method, path, body=payload, headers=headers or {})
            response = connection.getresponse()
            return response.status, dict(response.getheaders()), response.read()
        finally:
            connection.close()

    def control(self, data, **header_overrides):
        headers = {"Origin": "http://" + self.host, "Content-Type": "application/json"}
        headers.update(header_overrides)
        return self.request(self.prefix + "api/control", "POST", json.dumps(data), headers)

    def state(self):
        code, _, body = self.request(self.prefix + "api/state")
        self.assertEqual(code, 200)
        return json.loads(body)

    def wait_state(self, predicate, timeout=3):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            snapshot = self.state()
            if predicate(snapshot):
                return snapshot
            time.sleep(0.01)
        self.fail("Relay state did not reach the expected condition")

    def test_private_path_required_and_responses_are_not_cached(self):
        for path in ("/", "/api/state", "/wrong/api/state", "/test-private-local-link-other/api/state"):
            with self.subTest(path=path):
                code, headers, _ = self.request(path)
                self.assertEqual(code, 404)
                self.assertIn("no-store", headers["Cache-Control"])
                self.assertEqual(headers["Referrer-Policy"], "no-referrer")
                self.assertNotIn("Access-Control-Allow-Origin", headers)
        self.assertTrue(self.state()["simulated"])

    def test_static_whitelist_and_traversal_cannot_expose_backend_or_git_files(self):
        for path in ("bridge/server.py", "bridge/requirements.txt", ".git/config", "package-lock.json",
                     "../README.md", "docs/../README.md", "docs/%2e%2e/README.md", "docs/../../Documents/test.md"):
            with self.subTest(path=path):
                code, _, _ = self.request(self.prefix + path)
                self.assertEqual(code, 404)
        for path in ("", "Autonomic_Telemetry_Field_Guide.html", "Autonomic_Telemetry_Signal_Lab.html", "docs/BRIDGE.md", "examples/demo-session.json"):
            with self.subTest(path=path):
                code, _, body = self.request(self.prefix + path)
                self.assertEqual(code, 200)
                self.assertGreater(len(body), 50)

    def test_control_rejects_missing_wrong_or_cross_site_origin(self):
        payload = json.dumps({"action": "scan"})
        attempts = ({"Content-Type": "application/json"},
                    {"Origin": "https://example.invalid", "Content-Type": "application/json"},
                    {"Origin": "http://" + self.host, "Content-Type": "application/json", "Sec-Fetch-Site": "cross-site"})
        for headers in attempts:
            with self.subTest(headers=headers):
                code, _, _ = self.request(self.prefix + "api/control", "POST", payload, headers)
                self.assertEqual(code, 403)

    def test_control_validates_json_type_and_body_size(self):
        origin = {"Origin": "http://" + self.host, "Content-Type": "application/json"}
        for payload in ("{", "[]", "null", '{"action":"unknown"}', '{"action":"connect","device":"other"}'):
            with self.subTest(payload=payload):
                code, _, _ = self.request(self.prefix + "api/control", "POST", payload, origin)
                self.assertEqual(code, 400)
        code, _, _ = self.request(self.prefix + "api/control", "POST", "{}", {**origin, "Content-Type": "text/plain"})
        self.assertEqual(code, 415)
        for payload in ("", "x" * 2049):
            code, _, _ = self.request(self.prefix + "api/control", "POST", payload, origin)
            self.assertEqual(code, 413)

    def test_explicit_synthetic_scan_connect_sse_and_disconnect(self):
        code, _, _ = self.control({"action": "scan"})
        self.assertEqual(code, 202)
        snapshot = self.wait_state(lambda state: len(state["discovery"]["devices"]) == 2 and not state["discovery"]["scanning"])
        self.assertEqual({device["id"] for device in snapshot["discovery"]["devices"]}, {"demo-muse", "demo-hume"})
        self.assertTrue(all("Synthetic" in device["name"] for device in snapshot["discovery"]["devices"]))
        for kind in ("muse", "hume"):
            code, _, _ = self.control({"action": "connect", "device": kind, "id": "demo-" + kind})
            self.assertEqual(code, 202)
        snapshot = self.wait_state(lambda state: all(state["devices"][kind]["phase"] == "streaming" for kind in ("muse", "hume")))
        self.assertEqual(snapshot["heart_rate"]["source"], "synthetic")
        self.assertTrue(all(value["source"] == "synthetic" for value in snapshot["devices"].values()))

        connection = http.client.HTTPConnection(self.host, timeout=3)
        try:
            connection.request("GET", self.prefix + "api/events")
            response = connection.getresponse()
            self.assertEqual(response.status, 200)
            self.assertEqual(response.getheader("Content-Type"), "text/event-stream")
            events = []
            deadline = time.monotonic() + 3
            while time.monotonic() < deadline and not any(event["kind"] == "raw" for event in events):
                line = response.readline()
                if line.startswith(b"data: "):
                    events.append(json.loads(line[6:]))
            self.assertEqual(events[0]["kind"], "hello")
            self.assertTrue(events[0]["payload"]["simulated"])
            raw = next(event for event in events if event["kind"] == "raw")
            self.assertEqual(raw["payload"]["source"], "synthetic")
            self.assertIsInstance(raw["server_sent_at"], int)
            self.assertEqual(raw["session"], snapshot["session"])
        finally:
            connection.close()

        for kind in ("muse", "hume"):
            self.control({"action": "disconnect", "device": kind})
        self.wait_state(lambda state: all(state["devices"][kind]["phase"] == "disconnected" for kind in ("muse", "hume")))
        sequence = self.state()["sequence"]
        time.sleep(0.12)
        self.assertEqual(self.state()["sequence"], sequence, "Stopped synthetic adapters must not continue publishing")

    def test_wrong_selected_device_type_reports_error_without_starting(self):
        self.control({"action": "scan"})
        self.wait_state(lambda state: len(state["discovery"]["devices"]) == 2 and not state["discovery"]["scanning"])
        self.control({"action": "connect", "device": "muse", "id": "demo-hume"})
        snapshot = self.wait_state(lambda state: state["devices"]["muse"]["phase"] == "error")
        self.assertIn("matching wearable", snapshot["devices"]["muse"]["message"])

    def test_rapid_replacement_and_disconnect_do_not_leave_parallel_adapters(self):
        original = self.engine.simulate
        active = 0
        maximum = 0

        async def tracked(kind, emit, status, stop):
            nonlocal active, maximum
            active += 1
            maximum = max(maximum, active)
            try:
                await stop.wait()
            finally:
                active -= 1

        async def exercise():
            self.engine.available = {"demo-muse": "muse"}
            self.engine.simulate = tracked
            try:
                await self.engine.connect("muse", "demo-muse")
                await asyncio.sleep(0)
                await asyncio.gather(self.engine.connect("muse", "demo-muse"),
                                     self.engine.connect("muse", "demo-muse"),
                                     self.engine.disconnect("muse"))
                await self.engine.disconnect("muse")
            finally:
                self.engine.simulate = original

        asyncio.run_coroutine_threadsafe(exercise(), self.engine.loop).result(timeout=3)
        self.assertEqual(maximum, 1)
        self.assertEqual(active, 0)
        self.assertNotIn("muse", self.engine.runs)


if __name__ == "__main__":
    unittest.main()
