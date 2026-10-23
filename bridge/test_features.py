"""Analytic/invented waveform fixtures only; no physiological validation/BLE."""

import cmath
import json
import math
import random
import unittest

try:
    from bridge import features as F
except ModuleNotFoundError:
    import features as F

BASE = 1_700_000_000_000


def optical(offset, count=64, amplitude=4000, dc=100000):
    return [dc + amplitude * math.sin(2 * math.pi * 1.2 * (offset + i) / 64) for i in range(count)]


def eeg(offset, count=256):
    return [10 * math.sin(2 * math.pi * 10 * (offset + i) / 256)
            + 20 * math.sin(2 * math.pi * 20 * (offset + i) / 256) for i in range(count)]


def feed(extractor, seconds=40, channels=(1, 2), motion_at=None, hume=False, spacing=1000):
    emitted = []
    for second in range(seconds):
        stamp = BASE + second * spacing
        events = []
        if hume:
            events.append({"device": "hume", "type": "heart_rate", "heart_rate_bpm": 73, "received_at": stamp})
        events.append({"device": "muse", "type": "acc", "protocol": "athena", "received_at": stamp,
                       "samples": [{"x": (0.3 if i % 2 else -0.3) if second == motion_at else 0, "y": 0, "z": 1} for i in range(52)]})
        for channel in channels:
            events.append({"device": "muse", "type": "ppg", "channel": channel, "protocol": "athena", "received_at": stamp,
                           "samples": optical(second * 64)})
        for channel in (0, 1):
            for half in range(2):
                events.append({"device": "muse", "type": "eeg", "channel": channel, "protocol": "athena", "received_at": stamp - 500 + half * 500,
                               "samples": eeg(second * 256 + half * 128, 128)})
        for event in events:
            event["source"] = "synthetic"
            frame = extractor.consume(event)
            if frame:
                emitted.append(frame)
    return extractor.snapshot(stamp), emitted


class SpectralAndPulseTests(unittest.TestCase):
    def test_fft_matches_direct_dft_complex_phases(self):
        values = [1, 2, -1, 4, 0, 3, -2, 5]
        expected = [sum(x * cmath.exp(-2j * math.pi * k * n / len(values)) for n, x in enumerate(values)) for k in range(len(values))]
        for actual, direct in zip(F.fft(values), expected):
            self.assertLess(abs(actual - direct), 1e-10)
        with self.assertRaises(ValueError):
            F.fft([1, 2, 3])

    def test_hann_psd_recovers_known_power_ratio_and_units(self):
        result = F.eeg_band_ratio(eeg(0, 1024))
        self.assertTrue(result["valid"])
        self.assertAlmostEqual(result["alpha_power_uv2"], 50, places=5)
        self.assertAlmostEqual(result["beta_power_uv2"], 200, places=5)
        self.assertAlmostEqual(result["ratio"], 4, places=5)

    def test_eeg_flat_clipped_drift_and_high_frequency_artifacts_are_withheld(self):
        fixtures = [[0] * 1024, [800] * 1024, [1e308] * 1024,
                    [80 * math.sin(2 * math.pi * i / 256) + 5 * math.sin(2 * math.pi * 10 * i / 256) for i in range(1024)],
                    [30 * math.sin(2 * math.pi * 40 * i / 256) + 5 * math.sin(2 * math.pi * 10 * i / 256) for i in range(1024)]]
        for values in fixtures:
            with self.subTest(first=values[0]):
                self.assertFalse(F.eeg_band_ratio(values)["valid"])

    def test_pulse_rate_and_near_zero_prv_are_not_amplitude_inference(self):
        first = F.pulse_variability(optical(0, 2048), "athena")
        scaled = F.pulse_variability(optical(0, 2048, amplitude=9000, dc=200000), "athena")
        self.assertTrue(first["valid"])
        self.assertAlmostEqual(first["pulse_rate_bpm"], 72, delta=0.05)
        self.assertLess(first["rmssd_ms"], 1)
        self.assertAlmostEqual(first["pulse_rate_bpm"], scaled["pulse_rate_bpm"], places=8)
        self.assertAlmostEqual(first["rmssd_ms"], scaled["rmssd_ms"], places=7)

    def test_known_alternating_pulse_intervals_recover_nonzero_rmssd(self):
        beats = [20]
        while beats[-1] < 2100:
            beats.append(beats[-1] + (64 if len(beats) % 2 else 72))
        values = [100000 + 4000 * sum(math.exp(-0.5 * ((i - peak) / 4) ** 2) for peak in beats) for i in range(2048)]
        result = F.pulse_variability(values, "athena")
        self.assertTrue(result["valid"])
        # Real sample-domain intervals alternate 1000/1125 ms; filtering is not exact beat truth.
        self.assertAlmostEqual(result["rmssd_ms"], 125, delta=5)
        self.assertGreaterEqual(result["intervals"], 20)
        n = result["intervals"]
        expected_sdnn = 125 * math.sqrt((n // 2) * ((n + 1) // 2) / (n * (n - 1)))
        self.assertAlmostEqual(result["sdnn_ms"], expected_sdnn, delta=3)
        self.assertGreater(result["rmssd_ms"], 1.8 * result["sdnn_ms"])

    def test_pulse_sdnn_is_sample_spread_not_an_rmssd_proxy(self):
        # Same 24 accepted intervals in two orders: sample SDNN is invariant,
        # while successive-difference RMSSD changes from 125 to 125/sqrt(23).
        alternating = F._pulse_interval_metrics([1000, 1125] * 12)
        grouped = F._pulse_interval_metrics([1000] * 12 + [1125] * 12)
        expected_sdnn = 62.5 * math.sqrt(24 / 23)
        self.assertAlmostEqual(alternating["sdnn_ms"], expected_sdnn, places=10)
        self.assertAlmostEqual(grouped["sdnn_ms"], expected_sdnn, places=10)
        self.assertAlmostEqual(alternating["rmssd_ms"], 125, places=10)
        self.assertAlmostEqual(grouped["rmssd_ms"], 125 / math.sqrt(23), places=10)
        self.assertNotAlmostEqual(alternating["sdnn_ms"], alternating["rmssd_ms"])

    def test_ppg_flat_dropouts_noise_and_out_of_range_values_are_not_repaired(self):
        rng = random.Random(9)
        fixtures = [[100000] * 2048, [0] * 2048,
                    [100000 + rng.uniform(-3000, 3000) for _ in range(2048)],
                    [1e308] + [100000] * 2047, optical(0, 100)]
        for values in fixtures:
            with self.subTest(length=len(values), first=values[0]):
                self.assertFalse(F.pulse_variability(values, "athena")["valid"])


class ExtractorTests(unittest.TestCase):
    def test_hume_only_is_real_hr_not_invented_intervals_and_retains_support_time(self):
        extractor = F.FeatureExtractor()
        first = extractor.consume({"device": "hume", "type": "heart_rate", "heart_rate_bpm": 71, "received_at": BASE})
        self.assertEqual(first["heart_rate_bpm"], 71)
        self.assertTrue(first["quality"]["heart_rate_bpm"]["valid"])
        self.assertIsNone(first["pulse_rmssd_ms"])
        self.assertIsNone(first["pulse_sdnn_ms"])
        self.assertIsNone(first["eeg_beta_alpha"])
        self.assertEqual(first["quality"]["heart_rate_bpm"]["received_at"], BASE)
        stale = extractor.snapshot(BASE + 5001)
        self.assertIsNone(stale["heart_rate_bpm"])
        self.assertFalse(stale["quality"]["heart_rate_bpm"]["valid"])
        self.assertEqual(stale["quality"]["heart_rate_bpm"]["received_at"], BASE)
        extractor.consume({"device": "hume", "type": "heart_rate", "heart_rate_bpm": 72, "received_at": BASE + 1000})
        extractor.consume({"device": "hume", "type": "heart_rate", "heart_rate_bpm": 90, "received_at": BASE})
        self.assertEqual(extractor.snapshot(BASE + 1000)["heart_rate_bpm"], 72)
        extractor.reset("hume")
        self.assertIsNone(extractor.snapshot(BASE + 1000)["heart_rate_bpm"])

    def test_clean_multichannel_optical_and_eeg_frames_are_at_most_one_hz(self):
        extractor = F.FeatureExtractor()
        frame, emitted = feed(extractor)
        self.assertEqual(len(emitted), 40)
        self.assertTrue(all(b["received_at"] - a["received_at"] >= 1000 for a, b in zip(emitted, emitted[1:])))
        self.assertAlmostEqual(frame["eeg_beta_alpha"], 4, places=5)
        self.assertAlmostEqual(frame["heart_rate_bpm"], 72, delta=0.05)
        self.assertLess(frame["pulse_rmssd_ms"], 1)
        self.assertTrue(frame["quality"]["heart_rate_bpm"]["same_sensor_as_pulse_rmssd"])
        self.assertIn("optical-channel-", frame["quality"]["pulse_rmssd_ms"]["source"])
        self.assertEqual(frame["quality"]["pulse_rmssd_ms"]["source_kind"], "synthetic")
        json.dumps(frame, allow_nan=False)

    def test_pulse_sdnn_matches_rmssd_source_support_time_and_quality_gates(self):
        extractor = F.FeatureExtractor()
        frame, _ = feed(extractor, hume=True)

        def assert_pulse_parity(snapshot, valid):
            rmssd_quality = snapshot["quality"]["pulse_rmssd_ms"]
            sdnn_quality = snapshot["quality"]["pulse_sdnn_ms"]
            self.assertEqual({k: v for k, v in rmssd_quality.items() if k != "metric"},
                             {k: v for k, v in sdnn_quality.items() if k != "metric"})
            self.assertEqual(sdnn_quality["valid"], valid)
            self.assertIn("sample SDNN", sdnn_quality["metric"])
            self.assertIn("not ECG HRV", sdnn_quality["metric"])
            self.assertEqual(snapshot["pulse_rmssd_ms"] is not None, valid)
            self.assertEqual(snapshot["pulse_sdnn_ms"] is not None, valid)
            self.assertTrue(snapshot["method"]["no_respiration_inferred"])
            json.dumps(snapshot, allow_nan=False)

        assert_pulse_parity(frame, True)
        self.assertEqual(frame["quality"]["pulse_sdnn_ms"]["received_at"], BASE + 39000)
        self.assertIn("muse:athena:optical-channel-", frame["quality"]["pulse_sdnn_ms"]["source"])
        self.assertEqual(frame["quality"]["pulse_sdnn_ms"]["source_kind"], "synthetic")

        stale = extractor.snapshot(BASE + 40501)
        assert_pulse_parity(stale, False)
        self.assertEqual(stale["quality"]["pulse_sdnn_ms"]["received_at"], BASE + 39000)
        self.assertEqual(stale["heart_rate_bpm"], 73, "Fresh Hume HR cannot refresh stale optical metrics")

        extractor.reset("muse")
        reset = extractor.snapshot(BASE + 40501)
        assert_pulse_parity(reset, False)
        self.assertIsNone(reset["quality"]["pulse_sdnn_ms"]["received_at"])

        moved, _ = feed(F.FeatureExtractor(), motion_at=15)
        assert_pulse_parity(moved, False)
        self.assertIn("artifact", moved["quality"]["pulse_sdnn_ms"]["reason"])

    def test_hume_has_priority_without_becoming_a_second_optical_measurement(self):
        extractor = F.FeatureExtractor()
        frame, _ = feed(extractor, hume=True)
        self.assertEqual(frame["heart_rate_bpm"], 73)
        self.assertEqual(frame["quality"]["heart_rate_bpm"]["source"], "hume:device-reported-heart-rate")
        self.assertTrue(frame["quality"]["pulse_rmssd_ms"]["valid"])
        extractor.reset("hume")
        fallback = extractor.snapshot(BASE + 39000)
        self.assertAlmostEqual(fallback["heart_rate_bpm"], 72, delta=0.05)
        self.assertNotEqual(frame["quality"]["heart_rate_bpm"]["source"], fallback["quality"]["heart_rate_bpm"]["source"])

    def test_single_optical_channel_needs_hume_corroboration_and_disagreement_withholds(self):
        extractor = F.FeatureExtractor()
        frame, _ = feed(extractor, channels=(1,))
        self.assertIsNone(frame["pulse_rmssd_ms"])
        self.assertIn("second optical", frame["quality"]["pulse_rmssd_ms"]["reason"])
        extractor.consume({"device": "hume", "type": "heart_rate", "heart_rate_bpm": 72, "received_at": BASE + 39000})
        self.assertIsNotNone(extractor.snapshot(BASE + 39000)["pulse_rmssd_ms"])
        extractor.consume({"device": "hume", "type": "heart_rate", "heart_rate_bpm": 120, "received_at": BASE + 39001})
        failed = extractor.snapshot(BASE + 39001)
        self.assertIsNone(failed["pulse_rmssd_ms"])
        self.assertEqual(failed["heart_rate_bpm"], 120)
        self.assertIn("disagrees", failed["quality"]["pulse_rmssd_ms"]["reason"])

    def test_motion_in_the_prv_window_cannot_be_hidden_by_current_stillness(self):
        frame, _ = feed(F.FeatureExtractor(), motion_at=15)
        self.assertTrue(frame["quality"]["motion"]["valid"])
        self.assertIsNone(frame["pulse_rmssd_ms"])
        self.assertIn("artifact", frame["quality"]["pulse_rmssd_ms"]["reason"])
        self.assertIsNotNone(frame["eeg_beta_alpha"], "The current 4-second EEG window can recover before a 32-second pulse window")
        moved, _ = feed(F.FeatureExtractor(), motion_at=39)
        self.assertIsNone(moved["eeg_beta_alpha"])
        self.assertIsNone(moved["pulse_rmssd_ms"])
        self.assertFalse(moved["quality"]["motion"]["valid"])

    def test_fresh_accelerometry_is_required_and_reset_removes_muse_features(self):
        extractor = F.FeatureExtractor()
        frame, _ = feed(extractor, hume=True)
        self.assertIsNotNone(frame["pulse_rmssd_ms"])
        extractor.acc.clear()
        missing = extractor.snapshot(BASE + 39000)
        self.assertIsNone(missing["pulse_rmssd_ms"])
        self.assertIsNone(missing["eeg_beta_alpha"])
        self.assertEqual(missing["heart_rate_bpm"], 73)
        extractor.reset("muse")
        reset = extractor.snapshot(BASE + 39000)
        self.assertIsNone(reset["motion"])
        self.assertEqual(reset["heart_rate_bpm"], 73)

    def test_receipt_gaps_and_nominal_rate_disagreement_withhold_features(self):
        extractor = F.FeatureExtractor()
        feed(extractor)
        extractor.consume({"device": "muse", "type": "ppg", "channel": 1, "protocol": "athena", "received_at": BASE + 42000, "samples": optical(40 * 64)})
        self.assertEqual(len(extractor.ppg[1].data), 64)
        self.assertIsNone(extractor.snapshot(BASE + 42000)["pulse_rmssd_ms"])
        slow_extractor = F.FeatureExtractor()
        slow, _ = feed(slow_extractor, spacing=1200)
        self.assertIsNone(slow["pulse_rmssd_ms"])
        self.assertIn("duration", slow_extractor.ppg[1].window(32, BASE + 39 * 1200)[1])

    def test_classic_counter_wrap_duplicate_gap_and_protocol_changes(self):
        extractor = F.FeatureExtractor()
        payload = {"device": "muse", "type": "ppg", "channel": 1, "protocol": "classic", "samples": [100000] * 6}
        extractor.consume({**payload, "index": 65535, "received_at": BASE})
        extractor.consume({**payload, "index": 0, "received_at": BASE + 94})
        self.assertEqual(len(extractor.ppg[1].data), 12)
        extractor.consume({**payload, "index": 0, "received_at": BASE + 188})
        self.assertEqual(len(extractor.ppg[1].data), 12)
        self.assertEqual(extractor.ppg[1].last_ms, BASE + 94)
        extractor.consume({**payload, "index": 2, "received_at": BASE + 282})
        self.assertEqual(len(extractor.ppg[1].data), 6)
        extractor.consume({**payload, "protocol": "athena", "index": 2, "received_at": BASE + 300})
        self.assertEqual(len(extractor.ppg[1].data), 6)
        self.assertEqual(extractor.ppg[1].protocol, "athena")

    def test_invalid_samples_clear_their_window_and_never_output_nonfinite_values(self):
        extractor = F.FeatureExtractor()
        feed(extractor)
        extractor.consume({"device": "muse", "type": "ppg", "channel": 1, "samples": [math.nan], "received_at": BASE + 39000})
        self.assertFalse(extractor.ppg[1].data)
        extractor.consume({"device": "muse", "type": "acc", "samples": [{"x": 0, "y": math.inf, "z": 1}], "received_at": BASE + 39000})
        frame = extractor.snapshot(BASE + 39000)
        self.assertIsNone(frame["pulse_rmssd_ms"])
        self.assertIsNone(frame["eeg_beta_alpha"])
        json.dumps(frame, allow_nan=False)
        self.assertIsNone(extractor.consume({"device": "hume", "type": "heart_rate", "heart_rate_bpm": 72, "received_at": math.inf}))


if __name__ == "__main__":
    unittest.main()
