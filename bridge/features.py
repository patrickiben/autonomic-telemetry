"""Experimental, deterministic live features from actual wearable samples.

No dependency, network, persistence, device control, missing-channel synthesis,
or arousal classification lives here. ``valid`` means the documented software
gates passed, not that a physiological measurement has been validated.

Timing: Classic packet counters are checked when present. Athena has no
verified per-channel sample timestamps/counters: contiguous received samples
are indexed at the nominal EEG 256 Hz / optical 64 Hz. Host gaps >1.5 s reset
windows; nominal sample duration must also agree with host coverage. Small
undetected transport losses and clock error remain possible. These estimates
must not be described as ECG beat intervals or validated ECG HRV.

PPG: 32 s, >=20 pulse intervals; detrend, forward/backward second-order
Butterworth 0.5–5 Hz, prominent positive maxima, 333–1500 ms refractory/range,
parabolic peak interpolation, interval/morphology/periodicity gates, and a
quiet, fresh accelerometer window. No rejected beats are silently repaired.
Two optical channels must agree, or a single clean channel must agree with
fresh Hume HR. Channel names/wavelengths are not assumed for Athena. RMSSD is
the root mean square of successive *pulse* interval differences (PRV); pulse
SDNN is the sample standard deviation (N-1) of those same accepted intervals,
not a rescaled RMSSD or ECG-derived NN measurement. The
32 s window and every numerical quality threshold are engineering choices,
not manufacturer validation or a substitute for ECG/contact-quality review.

EEG: a 4 s Hann periodogram at 256 Hz, alpha 8–12 / beta 13–30 Hz inclusive;
median beta/alpha across >=2 eligible standard channels 0–3, with voltage,
flatness, low/high-frequency, freshness, and motion gates. It remains context;
muscle/eye artifacts can pass these gates, and no mental state is established.

Primary protocol and measurement references (not claims of validation here):
https://github.com/eugenehp/muse-rs/tree/7d6a885cfbb076ec8d50e6f44935a357c65eaf80
https://github.com/urish/muse-js/tree/4e864578c55dd7e26d85b429863f47ccabac54a0
https://pmc.ncbi.nlm.nih.gov/articles/PMC3805543/ (Elgendi et al., 2013:
    filtering/beat-detection context; this is an independent detector)
https://pmc.ncbi.nlm.nih.gov/articles/PMC11013825/ (2024: sampling/site-specific
    disagreement of PRV and ECG HRV, particularly variability metrics)
https://pmc.ncbi.nlm.nih.gov/articles/PMC8057382/ (2021: optical sampling limits)

API: FeatureExtractor.consume(raw) -> frame | None, at most once per second;
reset('muse'|'hume') on disconnect/error, and snapshot(now_ms) for expiry/status
inspection. A component's received_at is its supporting raw receipt, never
the later computation/forwarding time. Stale/rejected values are null.
"""

from __future__ import annotations

import cmath
from collections import deque
import math
import statistics
from typing import Any

EEG_HZ = 256
PPG_HZ = 64
ACC_HZ = 52
EEG_SECONDS = 4
PPG_SECONDS = 32
GAP_MS = 1500
FRESH_MS = 1500
HEART_FRESH_MS = 5000


def _finite(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def _mean(values: list[float]) -> float:
    return math.fsum(values) / len(values)


def _rms(values: list[float]) -> float:
    return math.sqrt(math.fsum(value * value for value in values) / len(values))


def fft(values: list[complex | float]) -> list[complex]:
    """Iterative radix-2 FFT; no padding or fabricated observations."""
    n = len(values)
    if n < 2 or n & (n - 1):
        raise ValueError("FFT length must be a power of two >=2")
    out = [complex(value) for value in values]
    j = 0
    for i in range(1, n):
        bit = n >> 1
        while j & bit:
            j ^= bit
            bit >>= 1
        j ^= bit
        if i < j:
            out[i], out[j] = out[j], out[i]
    size = 2
    while size <= n:
        root = cmath.exp(-2j * math.pi / size)
        for start in range(0, n, size):
            phase = 1 + 0j
            for offset in range(size // 2):
                even = out[start + offset]
                odd = phase * out[start + offset + size // 2]
                out[start + offset] = even + odd
                out[start + offset + size // 2] = even - odd
                phase *= root
        size *= 2
    return out


def eeg_band_ratio(values: list[float]) -> dict[str, Any]:
    """Band powers are integrated one-sided Hann PSD, in microvolts squared."""
    if len(values) != EEG_HZ * EEG_SECONDS or not all(_finite(v) for v in values):
        return {"valid": False, "reason": "Need 1,024 contiguous finite EEG samples."}
    if any(abs(v) >= 700 for v in values):
        return {"valid": False, "reason": "EEG voltage/clipping artifact gate failed."}
    center = _mean(values)
    x = [v - center for v in values]
    rms = _rms(x)
    if rms < 0.5:
        return {"valid": False, "reason": "EEG is flat or below the amplitude floor."}
    if rms > 100 or max(x) - min(x) > 500 or any(abs(v) >= 700 for v in values):
        return {"valid": False, "reason": "EEG voltage/clipping artifact gate failed."}
    hann = [0.5 - 0.5 * math.cos(2 * math.pi * i / (len(x) - 1)) for i in range(len(x))]
    spectrum = fft([v * w for v, w in zip(x, hann)])
    scale = EEG_HZ * math.fsum(w * w for w in hann)
    df = EEG_HZ / len(x)
    powers = [(abs(spectrum[i]) ** 2) * (1 if i in (0, len(x) // 2) else 2) / scale * df
              for i in range(len(x) // 2 + 1)]

    def band(lo: float, hi: float) -> float:
        return math.fsum(power for i, power in enumerate(powers) if lo <= i * df <= hi)

    alpha, beta, total = band(8, 12), band(13, 30), band(0.5, 45)
    if total < 1 or alpha < 0.1:
        return {"valid": False, "reason": "Insufficient alpha/broadband EEG power."}
    if band(0.5, 4) / total > 0.6 or band(30.25, 45) / total > 0.35:
        return {"valid": False, "reason": "Slow-drift or high-frequency EEG artifact gate failed."}
    ratio = beta / alpha
    if not math.isfinite(ratio) or ratio > 50:
        return {"valid": False, "reason": "EEG ratio exceeds the declared analysis range."}
    return {"valid": True, "ratio": ratio, "alpha_power_uv2": alpha, "beta_power_uv2": beta,
            "rms_uv": rms, "reason": "Software spectral gates passed; contact/EMG are not verified."}


def _filter(values: list[float], cutoff: float, highpass: bool) -> list[float]:
    k = math.tan(math.pi * cutoff / PPG_HZ)
    norm = 1 / (1 + math.sqrt(2) * k + k * k)
    b0 = norm if highpass else k * k * norm
    b1, b2 = (-2 * b0 if highpass else 2 * b0), b0
    a1, a2 = 2 * (k * k - 1) * norm, (1 - math.sqrt(2) * k + k * k) * norm
    result = []
    x1 = x2 = y1 = y2 = 0.0
    for x in values:
        y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2
        result.append(y)
        x2, x1, y2, y1 = x1, x, y1, y
    return result


def _pulse_interval_metrics(intervals: list[float]) -> dict[str, float]:
    """Describe already accepted optical intervals; no ECG/NN inference.

    The caller's pulse gates require at least 20 finite, in-range intervals.
    Both metrics use exactly that interval population, without beat repair.
    """
    return {"rmssd_ms": _rms([b - a for a, b in zip(intervals, intervals[1:])]),
            "sdnn_ms": statistics.stdev(intervals)}


def pulse_variability(values: list[float], protocol: str = "unknown") -> dict[str, Any]:
    """Conservative pulse-interval statistics; never an ECG/NN estimator."""
    n = PPG_HZ * PPG_SECONDS
    if len(values) != n or not all(_finite(v) and v >= 0 for v in values):
        return {"valid": False, "reason": "Need 2,048 contiguous nonnegative optical samples."}
    full_scale = 1048575 if protocol == "athena" else 16777215
    if any(v > full_scale for v in values):
        return {"valid": False, "reason": "Optical samples exceed the declared ADC range."}
    if sum(v == 0 or v >= full_scale for v in values) / n > 0.005:
        return {"valid": False, "reason": "Optical clipping/dropout gate failed."}
    dc = _mean(values)
    slope = (values[-1] - values[0]) / (n - 1)
    detrended = [v - dc - slope * (i - (n - 1) / 2) for i, v in enumerate(values)]
    pad = PPG_HZ * 2
    x = list(reversed(detrended[1:pad + 1])) + detrended + list(reversed(detrended[-pad - 1:-1]))
    # Forward/backward filtering is zero phase; padding is never counted as beats.
    for reverse in (False, True):
        if reverse:
            x.reverse()
        x = _filter(_filter(x, 0.5, True), 5.0, False)
    x.reverse()
    x = x[pad:pad + n]
    amplitude = _rms(x)
    if dc <= 0 or amplitude < 1 or amplitude / dc < 0.00001:
        return {"valid": False, "reason": "Optical pulse amplitude/flatness gate failed."}
    margin, radius, refractory = PPG_HZ, round(PPG_HZ * 0.2), PPG_HZ / 3
    peaks: list[int] = []
    for i in range(margin, n - margin):
        if not (x[i - 1] < x[i] >= x[i + 1] and x[i] > 0.3 * amplitude):
            continue
        prominence = x[i] - max(min(x[i - radius:i + 1]), min(x[i:i + radius + 1]))
        if prominence < 0.5 * amplitude:
            continue
        if peaks and i - peaks[-1] < refractory:
            if x[i] > x[peaks[-1]]:
                peaks[-1] = i
        else:
            peaks.append(i)
    positions = []
    for i in peaks:
        denominator = x[i - 1] - 2 * x[i] + x[i + 1]
        delta = 0.5 * (x[i - 1] - x[i + 1]) / denominator if denominator else 0
        positions.append(i + max(-0.5, min(0.5, delta)))
    intervals = [(b - a) * 1000 / PPG_HZ for a, b in zip(positions, positions[1:])]
    if len(intervals) < 20:
        return {"valid": False, "reason": "Fewer than 20 detected pulse intervals."}
    median = statistics.median(intervals)
    if any(v < 1000 / 3 or v > 1500 or abs(v - median) > 0.25 * median for v in intervals):
        return {"valid": False, "reason": "Pulse interval/range consistency gate failed; no beats repaired."}
    heights = [x[i] for i in peaks]
    if statistics.pstdev(heights) / _mean(heights) > 0.4:
        return {"valid": False, "reason": "Pulse morphology/amplitude consistency gate failed."}
    lag = round(median * PPG_HZ / 1000)
    a, b = x[:-lag], x[lag:]
    periodicity = math.fsum(u * v for u, v in zip(a, b)) / math.sqrt(math.fsum(u * u for u in a) * math.fsum(v * v for v in b))
    if periodicity < 0.6:
        return {"valid": False, "reason": "Optical periodicity gate failed."}
    metrics = _pulse_interval_metrics(intervals)
    if metrics["rmssd_ms"] > 250:
        return {"valid": False, "reason": "Pulse RMSSD exceeds the declared experimental range."}
    return {"valid": True, **metrics, "pulse_rate_bpm": 60000 / _mean(intervals),
            "intervals": len(intervals), "periodicity": periodicity,
            "reason": "Software pulse gates passed; PRV is not ECG HRV and nominal timing is assumed."}


class _Signal:
    def __init__(self, hz: int, seconds: int):
        self.hz = hz
        self.data: deque[tuple[Any, float]] = deque(maxlen=hz * seconds)
        self.last_ms: float | None = None
        self.index: int | None = None
        self.protocol = "unknown"
        self.source_kind = "device-reported"
        self.count = 0

    def clear(self) -> None:
        self.data.clear()
        self.last_ms = self.index = None
        self.count = 0

    def append(self, values: list[Any], stamp: float, index: Any, protocol: str, source_kind: str) -> None:
        if self.last_ms is not None and stamp < self.last_ms:
            return
        indexed = isinstance(index, int) and not isinstance(index, bool) and 0 <= index <= 65535
        if indexed and self.index is not None and index == self.index and protocol == self.protocol and source_kind == self.source_kind:
            return  # Retransmission is not a new sample or a freshness update.
        if self.last_ms is not None and (stamp - self.last_ms > GAP_MS or protocol != self.protocol or source_kind != self.source_kind or
                                        (indexed and self.index is not None and index != (self.index + 1) % 65536)):
            self.clear()
        self.protocol, self.source_kind = protocol, source_kind
        self.data.extend((value, stamp) for value in values)
        self.last_ms, self.index = stamp, index if indexed else None
        self.count += len(values)

    def window(self, seconds: int, now: float) -> tuple[list[Any] | None, str]:
        n = self.hz * seconds
        if self.last_ms is None or not 0 <= now - self.last_ms <= FRESH_MS:
            return None, "Raw component is missing or stale."
        if len(self.data) < n:
            return None, f"Warming up: need {seconds} seconds of contiguous samples."
        points = list(self.data)[-n:]
        observed, nominal = points[-1][1] - points[0][1], 1000 * (n - 1) / self.hz
        if abs(observed - nominal) > max(750, nominal * 0.05):
            return None, "Nominal sampling duration disagrees with host receipt coverage."
        return [value for value, _ in points], ""


class FeatureExtractor:
    """One instance per relay/session. No background thread or clock is created."""

    def __init__(self):
        self.eeg: dict[int, _Signal] = {}
        self.ppg: dict[int, _Signal] = {}
        self.acc = _Signal(ACC_HZ, 40)
        self.hr: tuple[float, float, str] | None = None
        self.last_emitted: float | None = None
        self.latest_ms: float | None = None
        self.selected_ppg: int | None = None

    def reset(self, device: str) -> None:
        if device == "muse":
            self.eeg.clear()
            self.ppg.clear()
            self.acc.clear()
            self.selected_ppg = None
        elif device == "hume":
            self.hr = None
        else:
            raise ValueError("Feature reset requires muse or hume")

    def consume(self, payload: dict[str, Any]) -> dict[str, Any] | None:
        if not isinstance(payload, dict) or not _finite(payload.get("received_at")):
            return None
        stamp = payload["received_at"]
        if stamp < 0:
            return None
        device, kind = payload.get("device"), payload.get("type")
        source_kind = "synthetic" if payload.get("source") in ("synthetic", "demo") else "device-reported"
        if device == "hume" and kind == "heart_rate":
            if self.hr and stamp < self.hr[1]:
                return None
            value = payload.get("heart_rate_bpm")
            self.hr = (float(value), stamp, source_kind) if _finite(value) and 25 <= value <= 240 else None
        elif device == "muse" and kind in ("eeg", "ppg", "acc"):
            channel, values = payload.get("channel", 0), payload.get("samples")
            if not isinstance(channel, int) or isinstance(channel, bool) or not 0 <= channel <= 15:
                return None
            protocol = payload.get("protocol", "unknown")
            protocol = protocol if protocol in ("classic", "athena") else "unknown"
            signal = self.acc if kind == "acc" else (self.eeg if kind == "eeg" else self.ppg).setdefault(channel, _Signal(EEG_HZ if kind == "eeg" else PPG_HZ, 40))
            valid = isinstance(values, list) and 0 < len(values) <= 4096
            if kind == "acc":
                valid = valid and all(isinstance(v, dict) and all(_finite(v.get(axis)) and abs(v[axis]) <= 16 for axis in ("x", "y", "z")) for v in values)
                if valid:
                    values = [tuple(v[axis] for axis in ("x", "y", "z")) for v in values]
            else:
                valid = valid and all(_finite(v) and (v >= 0 if kind == "ppg" else abs(v) <= 2000) for v in values)
            if not valid:
                signal.clear()
            else:
                signal.append(values, stamp, payload.get("index"), protocol, source_kind)
        else:
            return None
        self.latest_ms = max(stamp, self.latest_ms) if self.latest_ms is not None else stamp
        if self.last_emitted is not None and self.latest_ms - self.last_emitted < 1000:
            return None
        self.last_emitted = self.latest_ms
        return self.snapshot(self.latest_ms)

    def _motion(self, now: float, seconds: int) -> dict[str, Any]:
        if self.acc.last_ms is None or not 0 <= now - self.acc.last_ms <= FRESH_MS:
            return {"valid": False, "reason": "Fresh accelerometer samples are required."}
        points = [(v, t) for v, t in self.acc.data if t >= now - seconds * 1000]
        if len(points) < ACC_HZ * seconds * 0.85 or (points[-1][1] - points[0][1]) / 1000 < max(0.5, seconds - 1):
            return {"valid": False, "reason": "Continuous accelerometer coverage is still warming up."}
        means = [_mean([v[j] for v, _ in points]) for j in range(3)]
        deviations = [math.sqrt(math.fsum((v[j] - means[j]) ** 2 for j in range(3))) for v, _ in points]
        motion = _rms(deviations)
        gravity = math.sqrt(math.fsum(v * v for v in means))
        quiet = 0.75 <= gravity <= 1.25 and motion <= 0.05 and max(deviations) <= 0.2
        return {"valid": quiet, "value": motion, "received_at": self.acc.last_ms,
                "reason": "Quiet acceleration gate passed; contact quality remains unverified." if quiet else "Movement/gravity artifact gate failed."}

    @staticmethod
    def _quality(valid: bool, reason: str, stamp: float | None, source: str, **details: Any) -> dict[str, Any]:
        return {"valid": valid, "reason": reason, "received_at": stamp, "source": source, **details}

    def snapshot(self, now_ms: float) -> dict[str, Any]:
        if not _finite(now_ms):
            raise ValueError("Feature snapshot needs finite epoch milliseconds")
        values: dict[str, Any] = {"type": "features", "received_at": now_ms,
                                  "heart_rate_bpm": None, "pulse_rmssd_ms": None, "pulse_sdnn_ms": None,
                                  "eeg_beta_alpha": None, "motion": None}
        quality = {}
        fresh_hr = self.hr if self.hr and 0 <= now_ms - self.hr[1] <= HEART_FRESH_MS else None
        if fresh_hr:
            values["heart_rate_bpm"] = fresh_hr[0]
        quality["heart_rate_bpm"] = self._quality(bool(fresh_hr), "Fresh device-reported Hume heart rate; device contact quality is unavailable." if fresh_hr else "No fresh device-reported Hume heart rate.",
                                                        self.hr[1] if self.hr else None, "hume:device-reported-heart-rate", source_kind=self.hr[2] if self.hr else None)
        motion = self._motion(now_ms, 2)
        values["motion"] = motion.get("value")
        quality["motion"] = self._quality(motion["valid"], motion["reason"], self.acc.last_ms, "muse:accelerometer-vector-rms", source_kind=self.acc.source_kind)
        eeg_motion = self._motion(now_ms, EEG_SECONDS)
        eligible = []
        eeg_reason = eeg_motion["reason"]
        for channel in range(4):
            signal = self.eeg.get(channel)
            if signal is None:
                continue
            data, reason = signal.window(EEG_SECONDS, now_ms)
            if data is None:
                eeg_reason = reason
            elif eeg_motion["valid"]:
                result = eeg_band_ratio(data)
                if result["valid"]:
                    eligible.append((channel, signal, result))
                else:
                    eeg_reason = result["reason"]
        if len(eligible) >= 2:
            values["eeg_beta_alpha"] = statistics.median(r["ratio"] for _, _, r in eligible)
            stamp = min(s.last_ms for _, s, _ in eligible)
            channels = [channel for channel, _, _ in eligible]
            quality["eeg_beta_alpha"] = self._quality(True, "Median eligible-channel Hann PSD ratio; EEG is context, not a validated arousal input.", stamp,
                "muse:" + eligible[0][1].protocol + ":eeg:" + ",".join(map(str, channels)), channels=channels, sample_rate_hz=EEG_HZ,
                window_seconds=EEG_SECONDS, alpha_hz=[8, 12], beta_hz=[13, 30], timing_assumed=True, contact_verified=False,
                source_kind=eligible[0][1].source_kind)
        else:
            quality["eeg_beta_alpha"] = self._quality(False, "At least two eligible EEG channels required. " + eeg_reason,
                max((s.last_ms for s in self.eeg.values() if s.last_ms is not None), default=None), "muse:eeg-hann-psd")

        ppg_motion = self._motion(now_ms, PPG_SECONDS)
        candidates = {}
        ppg_reason = ppg_motion["reason"]
        if ppg_motion["valid"]:
            for channel, signal in self.ppg.items():
                data, reason = signal.window(PPG_SECONDS, now_ms)
                if data is None:
                    ppg_reason = reason
                    continue
                result = pulse_variability(data, signal.protocol)
                if result["valid"]:
                    if fresh_hr and abs(result["pulse_rate_bpm"] - fresh_hr[0]) > max(8, fresh_hr[0] * 0.15):
                        ppg_reason = "Optical pulse rate disagrees with fresh Hume heart rate."
                    else:
                        candidates[channel] = (signal, result)
                else:
                    ppg_reason = result["reason"]
        selected = self.selected_ppg if self.selected_ppg in candidates else (
            max(candidates, key=lambda channel: (candidates[channel][1]["periodicity"], -channel)) if candidates else None)
        agreement = False
        if selected is not None:
            signal, result = candidates[selected]
            agreement = any(channel != selected and abs(other["pulse_rate_bpm"] - result["pulse_rate_bpm"]) <= max(5, result["pulse_rate_bpm"] * 0.08)
                            and abs(other["rmssd_ms"] - result["rmssd_ms"]) <= max(20, result["rmssd_ms"] * 0.6)
                            for channel, (_, other) in candidates.items())
            if not agreement and fresh_hr is None:
                ppg_reason = "Need agreement from a second optical channel or fresh Hume heart rate."
            else:
                self.selected_ppg = selected
                values["pulse_rmssd_ms"] = result["rmssd_ms"]
                values["pulse_sdnn_ms"] = result["sdnn_ms"]
                source = f"muse:{signal.protocol}:optical-channel-{selected}"
                pulse_quality = self._quality(True, result["reason"], signal.last_ms, source, channel=selected,
                    protocol=signal.protocol, source_kind=signal.source_kind, sample_rate_hz=PPG_HZ, window_seconds=PPG_SECONDS,
                    pulse_intervals=result["intervals"], pulse_rate_bpm=result["pulse_rate_bpm"], periodicity=result["periodicity"],
                    corroboration="optical-channel agreement" if agreement else "Hume pulse-rate agreement", timing_assumed=True,
                    contact_verified=False)
                quality["pulse_rmssd_ms"] = {**pulse_quality, "metric": "pulse rate variability RMSSD; not ECG HRV"}
                quality["pulse_sdnn_ms"] = {**pulse_quality, "metric": "pulse-interval sample SDNN; not ECG HRV"}
                if fresh_hr is None:
                    values["heart_rate_bpm"] = result["pulse_rate_bpm"]
                    quality["heart_rate_bpm"] = self._quality(True, "Rate from accepted optical pulse intervals, not from amplitude or EEG.", signal.last_ms,
                        source + ":pulse-rate", same_sensor_as_pulse_rmssd=True, source_kind=signal.source_kind)
        if "pulse_rmssd_ms" not in quality:
            pulse_quality = self._quality(False, ppg_reason,
                max((s.last_ms for s in self.ppg.values() if s.last_ms is not None), default=None), "muse:optical-pulse-intervals")
            quality["pulse_rmssd_ms"] = {**pulse_quality, "metric": "pulse rate variability RMSSD; not ECG HRV"}
            quality["pulse_sdnn_ms"] = {**pulse_quality, "metric": "pulse-interval sample SDNN; not ECG HRV"}
        values["quality"] = quality
        values["method"] = {"version": 1, "experimental": True, "eeg_context_only": True,
                            "nominal_sample_timing": True, "small_packet_losses_may_be_undetected": True,
                            "prv_is_not_ecg_hrv": True, "no_respiration_inferred": True}
        return values
