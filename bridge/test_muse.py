"""Dependency-free protocol and lifecycle checks; no Bluetooth hardware used."""

import asyncio
from array import array
import struct
import unittest
from unittest.mock import patch

try:
    from bridge import muse
except ModuleNotFoundError:  # also supports unittest discovery with -s bridge
    import muse


def eeg_packet(values, index=65535):
    encoded = bytearray(index.to_bytes(2, "big"))
    for first, second in zip(values[::2], values[1::2]):
        encoded.extend((first >> 4, ((first & 15) << 4) | (second >> 8), second & 255))
    return encoded


EEG_PACKET = eeg_packet([0, 2048, 4095, 2049, 2047, 1] * 2)
PPG_PACKET = b"\x12\x34" + b"".join(value.to_bytes(3, "big") for value in (0, 1, 255, 256, 65536, 16777215))
ACC_PACKET = struct.pack(">H9h", 123, -32768, -16384, 0, 16384, 32767, 1, -1, 2, -2)
BATTERY_PACKET = b"\x00\x01" + (50 * 512).to_bytes(2, "big") + bytes(6)


class DecoderTests(unittest.TestCase):
    def test_command_framing_preserves_full_command(self):
        self.assertEqual(muse.encode_command("h"), b"\x02h\n")
        self.assertEqual(muse.encode_command("p50"), b"\x04p50\n")
        self.assertEqual(muse.encode_command("p21"), b"\x04p21\n")
        for value in ("", "x" * 19, "p50\n", "é", None):
            with self.subTest(value=value), self.assertRaises(ValueError):
                muse.encode_command(value)

    def test_eeg_packed_boundaries_and_microvolt_scale(self):
        index, values = muse.decode_eeg(EEG_PACKET)
        self.assertEqual(index, 65535)
        expected = [-1000.0, 0.0, 999.51171875, 0.48828125, -0.48828125, -999.51171875] * 2
        self.assertEqual(values, expected)

    def test_ppg_big_endian_unsigned_24_bit(self):
        self.assertEqual(muse.decode_ppg(PPG_PACKET), (0x1234, [0, 1, 255, 256, 65536, 16777215]))

    def test_acceleration_signed_xyz_and_g_scale(self):
        index, values = muse.decode_acc(ACC_PACKET)
        self.assertEqual(index, 123)
        self.assertEqual(values[0], {"x": -2.0, "y": -1.0, "z": 0.0})
        self.assertEqual(values[1], {"x": 1.0, "y": 32767 / 16384, "z": 1 / 16384})
        self.assertEqual(values[2], {"x": -1 / 16384, "y": 2 / 16384, "z": -2 / 16384})

    def test_sensor_parsers_reject_truncated_oversized_and_nonbytes(self):
        for decoder in (muse.decode_eeg, muse.decode_ppg, muse.decode_acc):
            for data in (b"", bytes(19), bytes(21), [0] * 20, "x" * 20, memoryview(array("H", [0] * 20))):
                with self.subTest(decoder=decoder.__name__, length=len(data)), self.assertRaises(ValueError):
                    decoder(data)

    def test_telemetry_percent_and_invalid_values(self):
        self.assertEqual(muse.decode_battery(BATTERY_PACKET), 50.0)
        for data in (bytes(3), bytes(21), b"\x00\x00\xff\xff", [0, 0, 0, 0]):
            with self.subTest(data_type=type(data).__name__), self.assertRaises(ValueError):
                muse.decode_battery(data)


class Characteristic:
    def __init__(self, uuid, properties=("notify", "write")):
        self.uuid = uuid
        self.properties = list(properties)


class Service:
    def __init__(self, missing=()):
        uuids = (muse.CONTROL, *muse.EEG, *muse.PPG, muse.ACC, muse.TELEMETRY)
        self.characteristics = {uuid: Characteristic(uuid) for uuid in uuids if uuid not in missing}

    def get_characteristic(self, uuid):
        return self.characteristics.get(uuid)


class Services:
    def __init__(self, service):
        self.service = service

    def get_service(self, uuid):
        return self.service if uuid == muse.MUSE_SERVICE else None


class Client:
    def __init__(self, missing=(), failed_subscriptions=(), fail_command=None, hang_connect=False):
        self.service = Service(missing)
        self.services = Services(self.service)
        self.notifications = {}
        self.started = []
        self.stopped = []
        self.writes = []
        self.disconnections = 0
        self.is_connected = False
        self.failed_subscriptions = set(failed_subscriptions)
        self.fail_command = fail_command
        self.hang_connect = hang_connect
        self.connect_started = asyncio.Event()
        self.connect_cancelled = False
        self.disconnected_callback = None

    async def connect(self):
        self.connect_started.set()
        if self.hang_connect:
            try:
                await asyncio.Event().wait()
            except asyncio.CancelledError:
                self.connect_cancelled = True
                raise
        self.is_connected = True

    async def start_notify(self, characteristic, callback):
        if characteristic.uuid in self.failed_subscriptions:
            raise RuntimeError("Subscription denied")
        self.started.append(characteristic.uuid)
        self.notifications[characteristic.uuid] = callback

    async def stop_notify(self, characteristic):
        self.stopped.append(characteristic.uuid)

    async def write_gatt_char(self, characteristic, data, response):
        self.writes.append((characteristic.uuid, bytes(data), response))
        if data == self.fail_command:
            raise RuntimeError("Command rejected")

    async def disconnect(self):
        self.disconnections += 1
        self.is_connected = False

    def notify(self, uuid, payload):
        self.notifications[uuid](self.service.get_characteristic(uuid), bytearray(payload))

    def unplug(self):
        self.is_connected = False
        self.disconnected_callback(self)


async def eventually(predicate, timeout=1.0):
    async def wait():
        while not predicate():
            await asyncio.sleep(0.002)
    await asyncio.wait_for(wait(), timeout)


class _AdapterFixture(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.tasks = []
        self.stops = []

    async def asyncTearDown(self):
        for stop in self.stops:
            stop.set()
        for task in self.tasks:
            if not task.done():
                task.cancel()
        await asyncio.gather(*self.tasks, return_exceptions=True)

    async def launch(self, client=None, emit=None, status=None):
        client = client or Client()
        stop = asyncio.Event()
        packets, phases = [], []
        selected_device = object()

        def make(device, disconnected):
            self.assertIs(device, selected_device)
            client.disconnected_callback = disconnected
            return client

        async def run():
            with patch.object(muse, "_make_client", make), patch.object(muse, "POLL_SECONDS", 0.005):
                await muse.run_muse(selected_device, emit or packets.append, status or phases.append, stop)

        task = asyncio.create_task(run())
        self.tasks.append(task)
        self.stops.append(stop)
        return client, stop, packets, phases, task

    async def ready(self, client):
        await eventually(lambda: any(data == muse.encode_command("d") for _, data, _ in client.writes))



class AdapterTests(_AdapterFixture):
    async def test_real_sensor_packets_and_clean_stop(self):
        phases = []

        async def status(value):
            phases.append(value)

        client, stop, packets, _, task = await self.launch(status=status)
        await self.ready(client)
        # The final stream command can be recorded before its async status callback runs.
        await eventually(lambda: phases and phases[-1]["phase"] == "waiting")
        self.assertEqual(phases[-1]["phase"], "waiting")
        client.notify(muse.EEG[2], EEG_PACKET)
        client.notify(muse.PPG[1], PPG_PACKET)
        client.notify(muse.ACC, ACC_PACKET)
        await eventually(lambda: len(packets) == 3)
        self.assertEqual([packet["type"] for packet in packets], ["eeg", "ppg", "acc"])
        self.assertEqual([packet["channel"] for packet in packets], [2, 1, 0])
        self.assertEqual(packets[0]["index"], 65535)
        self.assertEqual(packets[0]["device"], "muse")
        self.assertIsInstance(packets[0]["received_at"], int)
        self.assertEqual(phases[-1]["phase"], "streaming")
        self.assertNotIn("heart_rate_bpm", packets[1])
        stop.set()
        await asyncio.wait_for(task, 1)
        self.assertEqual([data for _, data, _ in client.writes], [muse.encode_command(text) for text in ("h", "p50", "s", "d", "h")])
        self.assertEqual(set(client.stopped), set(client.started))
        self.assertEqual(client.disconnections, 1)
        self.assertEqual(phases[-1]["phase"], "disconnected")
        client.notify(muse.EEG[0], EEG_PACKET)
        await asyncio.sleep(0)
        self.assertEqual(len(packets), 3)

    async def test_telemetry_and_malformed_packets_never_claim_streaming(self):
        with patch.object(muse, "STALE_SECONDS", 0.03):
            client, stop, packets, phases, task = await self.launch()
            await self.ready(client)
            client.notify(muse.TELEMETRY, BATTERY_PACKET)
            client.notify(muse.EEG[0], bytes(19))
            client.notify(muse.PPG[0], bytes(21))
            await eventually(lambda: phases[-1]["phase"] == "stale")
            self.assertEqual(packets, [])
            self.assertFalse(any(value["phase"] == "streaming" for value in phases))
            self.assertEqual(phases[-1]["battery"], 50)
            client.notify(muse.EEG[0], EEG_PACKET)
            await eventually(lambda: len(packets) == 1)
            self.assertEqual(phases[-1]["phase"], "streaming")
            await eventually(lambda: phases[-1]["phase"] == "stale")
            stop.set()
            await task

    async def test_missing_optional_channels_use_p21_without_fabrication(self):
        client, stop, packets, phases, task = await self.launch(Client(missing=(*muse.PPG, muse.ACC)))
        await self.ready(client)
        await eventually(lambda: phases and phases[-1]["phase"] == "waiting")
        self.assertIn(muse.encode_command("p21"), [data for _, data, _ in client.writes])
        self.assertIn("Unavailable: PPG 0, PPG 1, PPG 2, accelerometer", phases[-1]["message"])
        client.notify(muse.EEG[0], EEG_PACKET)
        await eventually(lambda: len(packets) == 1)
        self.assertEqual(packets[0]["type"], "eeg")
        stop.set()
        await task

    async def test_partial_ppg_subscription_uses_p50_and_reports_missing(self):
        client, stop, _, phases, task = await self.launch(Client(failed_subscriptions=muse.PPG[:2]))
        await self.ready(client)
        await eventually(lambda: phases and phases[-1]["phase"] == "waiting")
        self.assertIn(muse.encode_command("p50"), [data for _, data, _ in client.writes])
        self.assertIn("PPG 0, PPG 1", phases[-1]["message"])
        stop.set()
        await task

    async def test_missing_required_control_or_all_eeg_preserves_error(self):
        for missing in ((muse.CONTROL,), muse.EEG):
            with self.subTest(missing=missing):
                client, _, packets, phases, task = await self.launch(Client(missing=missing))
                await asyncio.wait_for(task, 1)
                self.assertEqual(phases[-1]["phase"], "error")
                self.assertEqual(packets, [])
                self.assertEqual(client.disconnections, 1)

    async def test_stop_interrupts_inflight_connection(self):
        client, stop, packets, phases, task = await self.launch(Client(hang_connect=True))
        await client.connect_started.wait()
        stop.set()
        await asyncio.wait_for(task, 0.5)
        self.assertTrue(client.connect_cancelled)
        self.assertEqual(client.disconnections, 1)
        self.assertEqual(client.writes, [])
        self.assertEqual(packets, [])
        self.assertEqual(phases[-1]["phase"], "disconnected")

    async def test_command_failure_halts_and_disconnects_without_overwriting_error(self):
        client, _, packets, phases, task = await self.launch(Client(fail_command=muse.encode_command("s")))
        await asyncio.wait_for(task, 1)
        self.assertEqual(phases[-1]["phase"], "error")
        self.assertEqual(client.writes[-1][1], muse.encode_command("h"))
        self.assertEqual(set(client.stopped), set(client.started))
        self.assertEqual(client.disconnections, 1)
        self.assertEqual(packets, [])

    async def test_cancel_propagates_after_cleanup(self):
        client, _, _, phases, task = await self.launch()
        await self.ready(client)
        task.cancel()
        with self.assertRaises(asyncio.CancelledError):
            await task
        self.assertEqual(client.writes[-1][1], muse.encode_command("h"))
        self.assertEqual(set(client.stopped), set(client.started))
        self.assertEqual(client.disconnections, 1)
        self.assertEqual(phases[-1]["phase"], "disconnected")

    async def test_external_disconnect_does_not_reconnect_or_emit_queued_packets(self):
        client, _, packets, phases, task = await self.launch()
        await self.ready(client)
        client.unplug()
        client.notify(muse.EEG[0], EEG_PACKET)
        await asyncio.wait_for(task, 1)
        self.assertEqual(phases[-1]["phase"], "disconnected")
        self.assertEqual(packets, [])
        self.assertEqual(client.disconnections, 1)

    async def test_async_consumer_error_still_halts_and_disconnects(self):
        async def failing_emit(_packet):
            raise RuntimeError("Receiver stopped")

        client, _, _, phases, task = await self.launch(emit=failing_emit)
        await self.ready(client)
        client.notify(muse.EEG[0], EEG_PACKET)
        await asyncio.wait_for(task, 1)
        self.assertEqual(phases[-1]["phase"], "error")
        self.assertEqual(client.writes[-1][1], muse.encode_command("h"))
        self.assertEqual(client.disconnections, 1)

    async def test_explicit_write_without_response_property_is_respected(self):
        fake = Client()
        fake.service.get_characteristic(muse.CONTROL).properties = ["notify", "write-without-response"]
        client, stop, _, _, task = await self.launch(fake)
        await self.ready(client)
        stop.set()
        await task
        self.assertTrue(all(response is False for _, _, response in client.writes))




def packed_le(values, bits):
    assert len(values) * bits % 8 == 0
    integer = sum(value << (i * bits) for i, value in enumerate(values))
    return integer.to_bytes(len(values) * bits // 8, "little")


def athena_packet(*entries, index=7):
    body = b"".join(bytes((tag,)) + bytes(4) + payload for tag, payload in entries)
    return bytes(((9 + len(body)) & 255, index)) + bytes(7) + body


ATHENA_EEG = packed_le([8192 + i for i in range(16)], 14)
ATHENA_PPG = packed_le([0, 1, (1 << 20) - 1, 3, 4, 5, 6, 7, 8, 9, 10, 11], 20)
ATHENA_IMU = struct.pack("<18h", 16384, 0, -16384, 10, 20, 30,
                         0, 16384, 0, 40, 50, 60, -16384, 0, 16384, 70, 80, 90)


class AthenaDecoderTests(unittest.TestCase):
    def test_eeg_4_and_8_channel_sample_major_layout(self):
        for tag, channels in ((0x11, 4), (0x12, 8)):
            events = muse.decode_athena(athena_packet((tag, ATHENA_EEG)))
            self.assertEqual(len(events), channels)
            for channel, event in enumerate(events):
                self.assertEqual(event["samples"], [i * .0885 for i in range(channel, 16, channels)])
                self.assertEqual(event["transport_index"], 7)
                self.assertEqual(event["protocol"], "athena")
                self.assertNotIn("index", event)

    def test_eeg_unsigned_boundaries_use_athena_scale(self):
        values = [0, 8192, 16383, 8191] * 4
        events = muse.decode_athena(athena_packet((0x11, packed_le(values, 14))))
        self.assertAlmostEqual(events[0]["samples"][0], -8192 * .0885)
        self.assertEqual(events[1]["samples"], [0.0] * 4)
        self.assertAlmostEqual(events[2]["samples"][0], 8191 * .0885)

    def test_optical_4_8_16_channels_preserve_raw_counts(self):
        for tag, channels, count in ((0x34, 4, 12), (0x35, 8, 16), (0x36, 16, 16)):
            values = list(range(count))
            values[-1] = (1 << 20) - 1
            events = muse.decode_athena(athena_packet((tag, packed_le(values, 20))))
            self.assertEqual(len(events), channels)
            for channel, event in enumerate(events):
                self.assertEqual(event["samples"], values[channel::channels])
                self.assertEqual(event["type"], "ppg")
                self.assertNotIn("heart_rate_bpm", event)

    def test_all_three_imu_samples_are_distinct_and_signed(self):
        event = muse.decode_athena(athena_packet((0x47, ATHENA_IMU)))[0]
        self.assertEqual(event["samples"], [{"x": 1., "y": 0., "z": -1.},
                                          {"x": 0., "y": 1., "z": 0.},
                                          {"x": -1., "y": 0., "z": 1.}])

    def test_multiple_subpackets_and_known_drl_skip(self):
        events = muse.decode_athena(athena_packet((0x12, ATHENA_EEG), (0x53, bytes(24)),
                                                (0x34, ATHENA_PPG), (0x47, ATHENA_IMU)))
        self.assertEqual([e["type"] for e in events], ["eeg"] * 8 + ["ppg"] * 4 + ["acc"])

    def test_battery_old_and_new_use_divisor_256(self):
        for tag, size in ((0x98, 20), (0x88, 188), (0x88, 230)):
            events = muse.decode_athena(athena_packet((tag, (75 * 256).to_bytes(2, "little") + bytes(size - 2))))
            self.assertEqual(events[0]["battery"], 75.)
            self.assertEqual(events[0]["type"], "telemetry")
        self.assertEqual(muse.decode_athena(athena_packet((0x98, b"\xff\xff" + bytes(18)))), [])

    def test_unknown_tag_never_searches_payload_for_sensor_like_bytes(self):
        misleading = bytes((0x12,)) + bytes(4) + ATHENA_EEG
        self.assertEqual(muse.decode_athena(athena_packet((0xff, misleading))), [])
        events = muse.decode_athena(athena_packet((0x11, ATHENA_EEG), (0xff, misleading)))
        self.assertEqual(len(events), 4)

    def test_known_truncation_rejects_whole_notification(self):
        for packet in (athena_packet((0x11, ATHENA_EEG[:-1])),
                       athena_packet((0x11, ATHENA_EEG), (0x47, ATHENA_IMU[:-1])),
                       athena_packet((0x88, bytes(1))), bytes(13), bytes(513)):
            with self.subTest(size=len(packet)), self.assertRaises(ValueError):
                muse.decode_athena(packet)


class AthenaAdapterTests(_AdapterFixture):
    def athena_client(self):
        client = Client(missing=(*muse.EEG, *muse.PPG, muse.ACC, muse.TELEMETRY))
        client.service.characteristics[muse.ATHENA] = Characteristic(muse.ATHENA, ("notify",))
        client.service.get_characteristic(muse.CONTROL).properties = ["notify", "write-without-response"]
        return client

    async def test_athena_detect_start_receive_and_clean_stop(self):
        delays = []

        async def delay(seconds):
            delays.append(seconds)

        with patch.object(muse, "_startup_delay", delay):
            client, stop, packets, phases, task = await self.launch(self.athena_client())
            await eventually(lambda: phases and phases[-1]["phase"] == "waiting")
            self.assertEqual(phases[-1]["protocol"], "athena")
            self.assertEqual(client.started, [muse.CONTROL, muse.ATHENA])
            self.assertEqual([data for _, data, _ in client.writes],
                             [muse.encode_command(command) for command, _ in muse.ATHENA_STARTUP])
            self.assertEqual(delays, [delay for _, delay in muse.ATHENA_STARTUP])
            self.assertTrue(all(response is False for _, _, response in client.writes))
            client.notify(muse.ATHENA, athena_packet((0x12, ATHENA_EEG), (0x34, ATHENA_PPG), (0x47, ATHENA_IMU)))
            await eventually(lambda: len(packets) == 13)
            self.assertEqual(phases[-1]["phase"], "streaming")
            self.assertTrue(all(p["device"] == "muse" and p["protocol"] == "athena" for p in packets))
            stop.set()
            await asyncio.wait_for(task, 1)
            self.assertEqual(client.writes[-1][1], muse.encode_command("h"))
            self.assertEqual(set(client.stopped), {muse.CONTROL, muse.ATHENA})
            self.assertEqual(client.disconnections, 1)

    async def test_battery_or_malformed_athena_packets_do_not_claim_live(self):
        async def delay(_seconds):
            pass
        with patch.object(muse, "_startup_delay", delay), patch.object(muse, "STALE_SECONDS", .03):
            client, stop, packets, phases, task = await self.launch(self.athena_client())
            await eventually(lambda: phases and phases[-1]["phase"] == "waiting")
            client.notify(muse.ATHENA, athena_packet((0x98, (50 * 256).to_bytes(2, "little") + bytes(18))))
            client.notify(muse.ATHENA, athena_packet((0x12, ATHENA_EEG[:-1])))
            await eventually(lambda: phases[-1]["phase"] == "stale")
            self.assertEqual(packets, [])
            self.assertEqual(phases[-1]["battery"], 50.)
            self.assertFalse(any(p["phase"] == "streaming" for p in phases))
            stop.set()
            await task

    async def test_stop_interrupts_athena_firmware_settle_delay(self):
        entered = asyncio.Event()
        async def delay(_seconds):
            entered.set()
            await asyncio.Event().wait()
        with patch.object(muse, "_startup_delay", delay):
            client, stop, packets, phases, task = await self.launch(self.athena_client())
            await entered.wait()
            stop.set()
            await asyncio.wait_for(task, .5)
            self.assertEqual(packets, [])
            self.assertEqual(client.disconnections, 1)
            self.assertEqual(phases[-1]["phase"], "disconnected")

    async def test_failed_athena_subscription_reports_actual_reason(self):
        client = self.athena_client()
        client.failed_subscriptions.add(muse.ATHENA)
        client, _, packets, phases, task = await self.launch(client)
        await asyncio.wait_for(task, 1)
        self.assertEqual(phases[-1]["phase"], "error")
        self.assertIn("Subscription denied", phases[-1]["message"])
        self.assertEqual(packets, [])
        self.assertEqual(client.disconnections, 1)


if __name__ == "__main__":
    unittest.main()
