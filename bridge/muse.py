"""Raw Classic / Athena Muse BLE adapter for the local relay (Python >= 3.10).

This is a community-protocol adapter, not the manufacturer SDK. It has not
been validated for all hardware/firmware combinations. Classic Muse S/Muse 2
and the Muse S Athena multiplexed transport are selected by discovered GATT
characteristics, never the advertised model name. Values are raw EEG microvolts, PPG
ADC counts, and acceleration in g. No heart rate, HRV, quality, or mental-state
estimate is inferred. ``received_at`` is host receipt time, not sample time;
the original 16-bit packet counter is retained as ``index``.

Protocol/decoder reference, pinned to muse-js commit
4e864578c55dd7e26d85b429863f47ccabac54a0 (2021-12-20):
https://github.com/urish/muse-js/blob/4e864578c55dd7e26d85b429863f47ccabac54a0/src/muse.ts
https://github.com/urish/muse-js/blob/4e864578c55dd7e26d85b429863f47ccabac54a0/src/lib/muse-parse.ts
https://github.com/urish/muse-js/blob/4e864578c55dd7e26d85b429863f47ccabac54a0/src/lib/muse-utils.ts
Transport API: https://bleak.readthedocs.io/en/stable/api/client.html
(tested with Bleak 3.0.2). Bleak is imported only when connecting.

Athena protocol reference pinned to muse-rs commit
7d6a885cfbb076ec8d50e6f44935a357c65eaf80 (Apache-2.0):
https://github.com/eugenehp/muse-rs/blob/7d6a885cfbb076ec8d50e6f44935a357c65eaf80/src/parse.rs
https://github.com/eugenehp/muse-rs/blob/7d6a885cfbb076ec8d50e6f44935a357c65eaf80/src/muse_client.rs
Copyright 2026 Eugene Hauptmann. See LICENSE.muse-rs for the upstream license.
This Python adaptation uses strict bounds and stops on unknown tags rather
than searching arbitrary payload bytes for possible sensor tags.

The Classic decoding arithmetic and command framing are adapted from muse-js:

The MIT License (MIT)
Copyright (c) 2017 Uri Shaked and contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
"""

from __future__ import annotations

import asyncio
import inspect
import struct
import time
from contextlib import suppress
from typing import TYPE_CHECKING, Any, Callable

if TYPE_CHECKING:
    from bleak.backends.device import BLEDevice

MUSE_SERVICE = "0000fe8d-0000-1000-8000-00805f9b34fb"
_SUFFIX = "-4c4d-454d-96be-f03bac821358"
CONTROL = "273e0001" + _SUFFIX
ATHENA = "273e0013" + _SUFFIX
ATHENA_STARTUP = (("v4", .1), ("s", .1), ("h", .1), ("p1045", .1),
                  ("dc001", .05), ("dc001", .05), ("d", .1), ("L1", 2.1))
EEG = tuple(f"273e{n:04x}" + _SUFFIX for n in range(3, 7))
PPG = tuple(f"273e{n:04x}" + _SUFFIX for n in range(15, 18))
ACC = "273e000a" + _SUFFIX
TELEMETRY = "273e000b" + _SUFFIX
STALE_SECONDS = 5.0
POLL_SECONDS = 0.25
QUEUE_PACKETS = 256


class _Stopped(Exception):
    pass


def encode_command(command: str) -> bytes:
    """Frame a short printable ASCII command, including its newline."""
    if not isinstance(command, str) or not 1 <= len(command) <= 18:
        raise ValueError("Muse command must contain 1–18 printable ASCII characters")
    if any(not 0x20 <= ord(char) <= 0x7E for char in command):
        raise ValueError("Muse command must contain printable ASCII characters")
    encoded = command.encode("ascii")
    return bytes((len(encoded) + 1,)) + encoded + b"\n"


def _packet(data: bytes | bytearray | memoryview) -> bytes:
    if not isinstance(data, (bytes, bytearray, memoryview)):
        raise ValueError("Classic Muse sensor packets must contain exactly 20 bytes")
    data = bytes(data)
    if len(data) != 20:
        raise ValueError("Classic Muse sensor packets must contain exactly 20 bytes")
    return data


def decode_eeg(data: bytes | bytearray | memoryview) -> tuple[int, list[float]]:
    """Decode one channel's 12 unsigned 12-bit samples into microvolts."""
    data = _packet(data)
    values = []
    for offset in range(2, 20, 3):
        first, middle, last = data[offset : offset + 3]
        values.extend((((first << 4) | (middle >> 4)) - 2048,
                       (((middle & 15) << 8) | last) - 2048))
    return int.from_bytes(data[:2], "big"), [value * 0.48828125 for value in values]


def decode_ppg(data: bytes | bytearray | memoryview) -> tuple[int, list[int]]:
    """Decode six unsigned 24-bit raw ADC counts, without pulse inference."""
    data = _packet(data)
    return int.from_bytes(data[:2], "big"), [
        int.from_bytes(data[offset : offset + 3], "big") for offset in range(2, 20, 3)
    ]


def decode_acc(data: bytes | bytearray | memoryview) -> tuple[int, list[dict[str, float]]]:
    """Decode three signed XYZ samples. The scale is 1/16384 g per count."""
    data = _packet(data)
    values = struct.unpack(">H9h", data)
    return values[0], [
        dict(zip(("x", "y", "z"), (value / 16384.0 for value in values[offset : offset + 3])))
        for offset in (1, 4, 7)
    ]


def decode_battery(data: bytes | bytearray | memoryview) -> float:
    """Read telemetry battery percent; malformed/out-of-range values fail closed."""
    if not isinstance(data, (bytes, bytearray, memoryview)):
        raise ValueError("Invalid Classic Muse telemetry length")
    data = bytes(data)
    if not 4 <= len(data) <= 20:
        raise ValueError("Invalid Classic Muse telemetry length")
    battery = int.from_bytes(data[2:4], "big") / 512.0
    if not 0 <= battery <= 100:
        raise ValueError("Invalid Classic Muse battery percentage")
    return battery


def _unpack_le(data: bytes, bits: int, count: int) -> list[int]:
    """Decode a byte-aligned block of packed LSB-first unsigned integers."""
    if len(data) * 8 != bits * count:
        raise ValueError("Athena packed payload has an unexpected length")
    packed = int.from_bytes(data, "little")
    mask = (1 << bits) - 1
    return [(packed >> (index * bits)) & mask for index in range(count)]


def decode_athena(data: bytes | bytearray | memoryview) -> list[dict[str, Any]]:
    """Decode a complete Athena notification into raw, per-channel readings.

    Header: nine bytes; each subpacket is tag + four opaque metadata bytes +
    its fixed payload. EEG/optical values are sample-major, little-endian bit
    packed. Unknown tags terminate parsing; a known truncated payload rejects
    the entire notification. A battery-only notification never implies a live
    physiological stream. The header index is a transport packet index, not a
    per-channel sample counter or reconstructed sample timestamp.
    """
    if not isinstance(data, (bytes, bytearray, memoryview)):
        raise ValueError("Athena notification must be bytes")
    data = bytes(data)
    if len(data) < 14 or len(data) > 512:
        raise ValueError("Invalid Athena notification length")
    sizes = {0x11: 28, 0x12: 28, 0x34: 30, 0x35: 40, 0x36: 40,
             0x47: 36, 0x53: 24, 0x98: 20}
    events: list[dict[str, Any]] = []
    cursor = 9
    while cursor < len(data):
        tag = data[cursor]
        if tag not in sizes and tag != 0x88:
            break  # Payload bytes cannot safely re-synchronize an unknown tag.
        start = cursor + 5
        if start > len(data):
            raise ValueError("Truncated Athena subpacket metadata")
        size = len(data) - start if tag == 0x88 else sizes[tag]
        end = start + size
        if end > len(data) or (tag == 0x88 and size < 2):
            raise ValueError("Truncated Athena sensor payload")
        payload = data[start:end]
        common = {"protocol": "athena", "transport_index": data[1], "tag": tag}
        if tag in (0x11, 0x12):
            channels = 4 if tag == 0x11 else 8
            raw = _unpack_le(payload, 14, 16)
            for channel in range(channels):
                values = [(raw[offset] - 8192) * .0885
                          for offset in range(channel, 16, channels)]
                events.append({**common, "type": "eeg", "channel": channel, "samples": values})
        elif tag in (0x34, 0x35, 0x36):
            channels = {0x34: 4, 0x35: 8, 0x36: 16}[tag]
            count = 12 if tag == 0x34 else 16
            raw = _unpack_le(payload, 20, count)
            for channel in range(channels):
                events.append({**common, "type": "ppg", "channel": channel,
                               "samples": raw[channel::channels]})
        elif tag == 0x47:
            raw = struct.unpack("<18h", payload)
            xyz = [dict(zip(("x", "y", "z"),
                            (raw[offset + axis] / 16384.0 for axis in range(3))))
                   for offset in (0, 6, 12)]
            events.append({**common, "type": "acc", "channel": 0, "samples": xyz})
            # Gyroscope remains unexposed: the visual accepts acceleration only.
        elif tag in (0x88, 0x98):
            percentage = int.from_bytes(payload[:2], "little") / 256.0
            if 0 <= percentage <= 100:
                events.append({**common, "type": "telemetry", "battery": percentage})
        # 0x53 is a known DRL/reference block, deliberately not interpreted.
        cursor = end
    return events


async def _startup_delay(seconds: float) -> None:
    await asyncio.sleep(seconds)


def _make_client(device: BLEDevice, disconnected: Callable[..., None]) -> Any:
    from bleak import BleakClient

    return BleakClient(device, disconnected_callback=disconnected, services=[MUSE_SERVICE], timeout=20.0)


async def _call(callback: Callable[[dict[str, Any]], Any], value: dict[str, Any]) -> None:
    result = callback(value)
    if inspect.isawaitable(result):
        await result


async def _until_stop(awaitable: Any, stop: asyncio.Event) -> Any:
    """Cancel setup promptly when the caller stops, observing both tasks."""
    work = asyncio.ensure_future(asyncio.wait_for(awaitable, timeout=20.0))
    stopping = asyncio.create_task(stop.wait())
    try:
        done, _ = await asyncio.wait((work, stopping), return_when=asyncio.FIRST_COMPLETED)
        if stopping in done and stop.is_set():
            raise _Stopped()
        return await work
    finally:
        for task in (work, stopping):
            if not task.done():
                task.cancel()
        await asyncio.gather(work, stopping, return_exceptions=True)


async def run_muse(
    device: BLEDevice,
    emit: Callable[[dict[str, Any]], Any],
    status: Callable[[dict[str, Any]], Any],
    stop: asyncio.Event,
) -> None:
    """Connect the selected BLEDevice and relay bounded, valid raw packets.

    Callbacks may be synchronous or awaitable. Notifications use a bounded
    queue, dropping oldest pending packets if the receiver cannot keep up;
    this live preview is not a lossless recorder. An unexpected disconnect
    returns without reconnecting or selecting another device. Connection/
    callback errors are reported through ``status``; cancellation propagates
    after best-effort halt, notification cleanup, and disconnect.
    """
    if stop.is_set():
        await _call(status, {"device": "muse", "phase": "disconnected", "message": "Muse connection stopped before starting."})
        return
    loop = asyncio.get_running_loop()
    queue: asyncio.Queue[dict[str, Any] | None] = asyncio.Queue(QUEUE_PACKETS)
    disconnected = asyncio.Event()
    subscriptions: list[Any] = []
    client = None
    control = None
    closing = False
    phase: str | None = None
    battery: float | None = None
    reported_battery: float | None = None
    last_sensor: float | None = None
    connected_at = 0.0
    unavailable: list[str] = []
    subscription_errors: dict[str, str] = {}
    protocol: str | None = None
    failed = False

    async def report(next_phase: str, message: str, force: bool = False) -> None:
        nonlocal phase, reported_battery
        if not force and next_phase == phase and battery == reported_battery:
            return
        phase, reported_battery = next_phase, battery
        value: dict[str, Any] = {"device": "muse", "phase": next_phase, "message": message}
        if protocol is not None:
            value["protocol"] = protocol
        if battery is not None:
            value["battery"] = battery
        await _call(status, value)

    def enqueue(value: dict[str, Any] | None, arrived: float | None = None) -> None:
        nonlocal last_sensor
        if closing or stop.is_set() or disconnected.is_set():
            return
        if arrived is not None:
            last_sensor = max(arrived, last_sensor) if last_sensor is not None else arrived
        if queue.full():
            queue.get_nowait()
        queue.put_nowait(value)

    def sensor(kind: str, channel: int, decoder: Callable[..., Any]) -> Callable[..., None]:
        def notification(_sender: Any, data: bytearray) -> None:
            if closing or stop.is_set() or disconnected.is_set():
                return
            try:
                index, samples = decoder(data)
            except (ValueError, TypeError, struct.error):
                return
            loop.call_soon_threadsafe(enqueue,
                {"device": "muse", "type": kind, "channel": channel,
                 "index": index, "samples": samples,
                 "received_at": time.time_ns() // 1_000_000}, time.monotonic())
        return notification

    def athena_notification(_sender: Any, data: bytearray) -> None:
        nonlocal battery
        if closing or stop.is_set() or disconnected.is_set():
            return
        try:
            events = decode_athena(data)
        except (ValueError, TypeError, struct.error):
            return
        stamp, arrived = time.time_ns() // 1_000_000, time.monotonic()
        for event in events:
            if event["type"] == "telemetry":
                battery = event["battery"]
                loop.call_soon_threadsafe(enqueue, None)
            else:
                loop.call_soon_threadsafe(enqueue,
                    {"device": "muse", **event, "received_at": stamp}, arrived)

    def telemetry(_sender: Any, data: bytearray) -> None:
        nonlocal battery
        if closing or stop.is_set() or disconnected.is_set():
            return
        try:
            battery = decode_battery(data)
        except (ValueError, TypeError):
            return
        loop.call_soon_threadsafe(enqueue, None)

    def on_disconnect(_client: Any) -> None:
        if not closing and not loop.is_closed():
            loop.call_soon_threadsafe(disconnected.set)

    async def subscribe(service: Any, uuid: str, callback: Callable[..., None], label: str) -> bool:
        characteristic = service.get_characteristic(uuid)
        if characteristic is None:
            subscription_errors[label] = "characteristic absent"
            unavailable.append(label)
            return False
        try:
            await _until_stop(client.start_notify(characteristic, callback), stop)
        except _Stopped:
            raise
        except Exception as error:
            subscription_errors[label] = f"{type(error).__name__}: {error}"[:160]
            unavailable.append(label)
            return False
        subscriptions.append(characteristic)
        return True

    async def command(text: str) -> None:
        properties = getattr(control, "properties", ())
        response = "write-without-response" not in properties or "write" in properties
        await client.write_gatt_char(control, encode_command(text), response=response)

    async def cleanup() -> None:
        if client is None:
            return
        if client.is_connected:
            if control is not None:
                with suppress(Exception):
                    await asyncio.wait_for(command("h"), timeout=1.0)
            deadline = time.monotonic() + 3.0
            for characteristic in reversed(subscriptions):
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    break
                with suppress(Exception):
                    await asyncio.wait_for(client.stop_notify(characteristic), timeout=min(0.5, remaining))
        # Disconnect also stops notifications, including any cleanup timed out above.
        with suppress(Exception):
            await asyncio.wait_for(client.disconnect(), timeout=3.0)

    try:
        await report("connecting", "Connecting to selected Muse and detecting its sensor protocol.")
        client = _make_client(device, on_disconnect)
        await _until_stop(client.connect(), stop)
        connected_at = time.monotonic()
        if stop.is_set() or disconnected.is_set():
            return
        service = client.services.get_service(MUSE_SERVICE)
        if service is None:
            raise RuntimeError("Muse service 0xfe8d is unavailable")
        control = service.get_characteristic(CONTROL)
        if control is None:
            raise RuntimeError("Muse control characteristic is unavailable")
        # Subscribe to control before sending commands, as in the reference client.
        await _until_stop(client.start_notify(control, lambda _sender, _data: None), stop)
        subscriptions.append(control)
        protocol = "athena" if service.get_characteristic(ATHENA) is not None else "classic"
        if protocol == "athena":
            if not await subscribe(service, ATHENA, athena_notification, "Athena multiplexed sensors"):
                raise RuntimeError("Muse Athena notification subscription failed: " + subscription_errors.get("Athena multiplexed sensors", "unknown error"))
            # Transitional Athena firmware may reject dc001 in its control reply
            # yet accept d. Both are normal streaming-start commands, not updates.
            for text, delay in ATHENA_STARTUP:
                if stop.is_set() or disconnected.is_set():
                    return
                await _until_stop(command(text), stop)
                await _until_stop(_startup_delay(delay), stop)
        else:
            eeg_count = 0
            for channel, uuid in enumerate(EEG):
                eeg_count += await subscribe(service, uuid, sensor("eeg", channel, decode_eeg), f"EEG {channel}")
            if not eeg_count:
                reasons = "; ".join(f"{key}: {value}" for key, value in subscription_errors.items())
                raise RuntimeError("No Classic Muse EEG notifications could be subscribed. " + reasons)
            ppg_count = 0
            for channel, uuid in enumerate(PPG):
                ppg_count += await subscribe(service, uuid, sensor("ppg", channel, decode_ppg), f"PPG {channel}")
            await subscribe(service, ACC, sensor("acc", 0, decode_acc), "accelerometer")
            await subscribe(service, TELEMETRY, telemetry, "battery telemetry")
            if stop.is_set() or disconnected.is_set():
                return
            for text in ("h", "p50" if ppg_count else "p21", "s", "d"):
                if stop.is_set() or disconnected.is_set():
                    return
                await _until_stop(command(text), stop)
        waiting = f"Waiting for valid raw Muse {protocol.title()} sensor packets."
        if unavailable:
            waiting += " Unavailable: " + ", ".join(unavailable) + "."
        await report("waiting", waiting)
        while not stop.is_set() and not disconnected.is_set() and client.is_connected:
            try:
                packet = await asyncio.wait_for(queue.get(), timeout=POLL_SECONDS)
            except asyncio.TimeoutError:
                packet = None
            if stop.is_set() or disconnected.is_set() or not client.is_connected:
                break
            age = time.monotonic() - (last_sensor if last_sensor is not None else connected_at)
            if age > STALE_SECONDS:
                await report("stale", "No valid raw Muse sensor packets for at least 5 seconds.")
            elif last_sensor is not None:
                await report("streaming", "Receiving raw Muse sensor packets; contact quality is not assessed.")
            else:
                await report("waiting", waiting)
            if packet is not None:
                await _call(emit, packet)
    except _Stopped:
        pass
    except asyncio.CancelledError:
        raise
    except Exception as error:
        failed = True
        with suppress(Exception):
            await report("error", f"Muse connection failed: {str(error)[:240]}", force=True)
    finally:
        closing = True
        await cleanup()
        if not failed:
            with suppress(Exception):
                await report("disconnected", "Muse disconnected; no automatic reconnect.")
