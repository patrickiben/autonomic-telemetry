"""Hardware-free protocol and lifecycle checks: python3 -m unittest bridge.test_hume."""

import asyncio
import sys
import types
import unittest
from unittest.mock import patch

from bridge import hume


def reply(hr=72, kind=2):
    packet = bytearray(16)
    packet[:3] = bytes((0x28, kind, hr))
    packet[15] = sum(packet[:15]) & 255
    return packet


class FrameTests(unittest.TestCase):
    def test_only_expected_start_and_stop_frames(self):
        self.assertEqual(hume.heart_command(True), bytes.fromhex("28 02 01 00 00 00 00 00 00 00 00 00 00 00 00 2b"))
        self.assertEqual(hume.heart_command(False), bytes.fromhex("28 02 00 00 00 00 00 00 00 00 00 00 00 00 00 2a"))

    def test_device_hr_is_not_replaced_by_unrelated_or_warmup_values(self):
        self.assertEqual(hume.decode_live_heart(reply(73)), 73.0)
        self.assertIsNone(hume.decode_live_heart(reply(0)))
        self.assertIsNone(hume.decode_live_heart(reply(73, kind=1)))
        self.assertIsNone(hume.decode_live_heart(bytes((0x13, 90))))

    def test_checksum_and_exact_live_length_required(self):
        invalid = reply()
        invalid[2] += 1
        with self.assertRaises(hume.InvalidPacket):
            hume.decode_live_heart(invalid)
        for packet in (reply()[:10], reply() + b"\x00"):
            with self.assertRaises(hume.InvalidPacket):
                hume.decode_live_heart(packet)

    def test_explicit_rejection_is_not_a_measurement(self):
        for packet in (bytes((0x28, 0xFF)), reply(0, kind=0xFF)):
            with self.assertRaises(hume.MeasurementRejected):
                hume.decode_live_heart(packet)


class FakeCharacteristic:
    properties = ["write", "write-without-response"]


class FakeService:
    def get_characteristic(self, _uuid):
        return FakeCharacteristic()


class FakeClient:
    instances = []
    inject = [reply(0), reply(74)]
    missing_service = False
    disconnect_after_start = False
    inject_after_first_start = None

    def __init__(self, device, disconnected_callback, timeout):
        self.device = device
        self.callback = disconnected_callback
        self.is_connected = False
        self.services = types.SimpleNamespace(get_service=lambda _: None if self.missing_service else FakeService())
        self.writes = []
        self.unsubscribed = False
        self.disconnected = False
        self.notify = None
        self.starts = 0
        self.instances.append(self)

    async def connect(self):
        self.is_connected = True

    async def start_notify(self, _uuid, callback):
        self.notify = callback

    async def write_gatt_char(self, _char, packet, response):
        self.writes.append((bytes(packet), response))
        if packet == hume.heart_command(True):
            self.starts += 1
            values = self.inject_after_first_start if self.starts > 1 and self.inject_after_first_start is not None else self.inject
            for data in values:
                self.notify(None, data)
            if self.disconnect_after_start:
                self.is_connected = False
                self.callback(self)

    async def stop_notify(self, _uuid):
        self.unsubscribed = True

    async def disconnect(self):
        self.is_connected = False
        self.disconnected = True


class LifecycleTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        FakeClient.instances = []
        FakeClient.inject = [reply(0), reply(74)]
        FakeClient.missing_service = False
        FakeClient.disconnect_after_start = False
        FakeClient.inject_after_first_start = None
        self.patch = patch.dict(sys.modules, {"bleak": types.SimpleNamespace(BleakClient=FakeClient)})
        self.patch.start()

    async def asyncTearDown(self):
        self.patch.stop()

    async def test_valid_hr_and_explicit_stop_cleanup(self):
        events, states = [], []
        stop = asyncio.Event()

        async def emit(event):
            events.append(event)
            stop.set()

        await hume.run_hume(object(), emit, states.append, stop)
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0]["heart_rate_bpm"], 74.0)
        self.assertEqual(events[0]["type"], "heart_rate")
        self.assertNotIn("rmssd_ms", events[0])
        self.assertEqual([s["phase"] for s in states], ["connecting", "waiting", "streaming", "disconnected"])
        client = FakeClient.instances[0]
        self.assertEqual([p for p, _ in client.writes], [hume.heart_command(True), hume.heart_command(False)])
        self.assertTrue(all(response is False for _, response in client.writes))
        self.assertTrue(client.unsubscribed and client.disconnected)

    async def test_bad_checksum_and_zero_never_become_live(self):
        corrupt = reply(90)
        corrupt[-1] ^= 1
        FakeClient.inject = [corrupt, reply(0), reply(99, kind=1)]
        events, states = [], []
        stop = asyncio.Event()
        with patch.object(hume, "WARMUP_SECONDS", 0.01), patch.object(hume, "POLL_SECONDS", 0.01):
            async def status(event):
                states.append(event)
                if event["phase"] == "stale":
                    stop.set()
            await hume.run_hume(object(), events.append, status, stop)
        self.assertFalse(events)
        self.assertNotIn("streaming", [s["phase"] for s in states])
        self.assertEqual(next(s for s in states if s["phase"] == "stale")["rejected_packets"], 1)

    async def test_missing_service_sends_no_command(self):
        FakeClient.missing_service = True
        states = []
        await hume.run_hume(object(), lambda _: None, states.append, asyncio.Event())
        self.assertEqual(states[-1]["phase"], "error")
        self.assertFalse(FakeClient.instances[0].writes)
        self.assertTrue(FakeClient.instances[0].disconnected)

    async def test_rejected_measurement_errors_and_stops(self):
        FakeClient.inject = [bytes((0x28, 0xFF))]
        states, events = [], []
        await hume.run_hume(object(), events.append, states.append, asyncio.Event())
        self.assertEqual(states[-1]["phase"], "error")
        self.assertFalse(events)
        self.assertEqual(FakeClient.instances[0].writes[-1][0], hume.heart_command(False))

    async def test_transport_disconnect_stops_without_emitting_queued_data(self):
        FakeClient.disconnect_after_start = True
        states, events = [], []
        await hume.run_hume(object(), events.append, states.append, asyncio.Event())
        self.assertFalse(events)
        self.assertEqual(states[-1]["phase"], "disconnected")

    async def test_stale_after_valid_then_resume_is_explicit(self):
        states, events = [], []
        stop = asyncio.Event()
        with patch.object(hume, "FRESH_SECONDS", 0.01), patch.object(hume, "POLL_SECONDS", 0.01):
            async def status(event):
                states.append(event)
                if event["phase"] == "stale":
                    FakeClient.instances[0].notify(None, reply(76))

            async def emit(event):
                events.append(event)
                if len(events) == 2:
                    stop.set()

            await hume.run_hume(object(), emit, status, stop)
        self.assertEqual([e["heart_rate_bpm"] for e in events], [74.0, 76.0])
        self.assertEqual([s["phase"] for s in states].count("streaming"), 2)

    async def test_task_cancel_stops_measurement_and_propagates(self):
        stop = asyncio.Event()
        started = asyncio.Event()

        async def emit(_):
            started.set()

        task = asyncio.create_task(hume.run_hume(object(), emit, lambda _: None, stop))
        await started.wait()
        task.cancel()
        with self.assertRaises(asyncio.CancelledError):
            await task
        client = FakeClient.instances[0]
        self.assertEqual(client.writes[-1][0], hume.heart_command(False))
        self.assertTrue(client.unsubscribed and client.disconnected)

    async def test_only_same_safe_start_is_renewed_and_nothing_writes_after_stop(self):
        events = []
        stop = asyncio.Event()

        async def emit(event):
            events.append(event)
            if len(events) == 3:
                stop.set()

        with patch.object(hume, "RENEWAL_SECONDS", 0.01), patch.object(hume, "POLL_SECONDS", 0.005):
            await hume.run_hume(object(), emit, lambda _: None, stop)
            client = FakeClient.instances[0]
            writes = list(client.writes)
            await asyncio.sleep(0.025)
        self.assertEqual([packet for packet, _ in writes], [hume.heart_command(True)] * 3 + [hume.heart_command(False)])
        self.assertEqual(client.writes, writes)
        self.assertTrue(client.unsubscribed and client.disconnected)

    async def test_renewal_with_zero_replies_cannot_keep_old_hr_fresh(self):
        FakeClient.inject_after_first_start = [reply(0)]
        events, states = [], []
        stop = asyncio.Event()

        async def status(event):
            states.append(event)
            if event["phase"] == "stale":
                stop.set()

        with patch.object(hume, "RENEWAL_SECONDS", 0.006), patch.object(hume, "POLL_SECONDS", 0.004), patch.object(hume, "FRESH_SECONDS", 0.03):
            await hume.run_hume(object(), events.append, status, stop)
        self.assertEqual(len(events), 1)
        self.assertGreaterEqual(FakeClient.instances[0].starts, 2)
        self.assertEqual([s["phase"] for s in states], ["connecting", "waiting", "streaming", "stale", "disconnected"])


if __name__ == "__main__":
    unittest.main()
