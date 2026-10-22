# Live inferred-arousal methods

The immersive canvas combines a personal **experimental inferred-arousal estimate** with artistic raw-signal visuals. The estimate is a transparent inference from cardiac patterns relative to an initial personal reference. It is not direct sympathetic activity, a classification of mental overactivity, or a validated measure of attention, stress, meditation, or health.

The separate [Advanced Signal Lab](../Autonomic_Telemetry_Signal_Lab.html) retains its recording model and research tools. Its [pattern-shift index](SIGNAL_LAB_METHODS.md) and [research lenses](RESEARCH_ENGINE.md) are different calculations, not alternate displays of this live estimate.

## Inputs and availability

| Input | Role in the estimate | Boundary |
| --- | --- | --- |
| Hume device-reported heart rate, or eligible Muse pulse rate when Hume is absent | Increase relative to the personal reference | Reported rate or accepted optical pulse rate, not ECG heartbeat timestamps |
| Muse optical pulse-interval RMSSD | Decrease in log pulse-interval variability relative to reference | Experimental PPG-derived PRV, not ECG-derived HRV |
| Muse acceleration | Motion/continuity gate for derived Muse features | Low motion does not prove good contact or artifact-free data |
| Muse EEG spectral context | Separate descriptive context, zero estimate weight | No direct mental-state or sympathetic interpretation |

PRV means **pulse rate variability**. Its RMSSD is calculated from detected optical pulse intervals, not from the inverse of Hume's reported rate. PPG, pulse transit, breathing, fiducial-point detection, motion, and contact can all affect it. It is not renamed ECG RMSSD or substituted for Apple's SDNN.

The Mac bridge derives eligible features from actual packets. Invalid components retain a reason instead of becoming a zero measurement. Raw transport verification does not validate peak detection, PRV, EEG features, or the arousal inference. The HR-only track can operate without eligible PRV; the dual track needs both components. They keep separate references and trend histories. Switching coverage never silently renormalizes the dual score or compares two different tracks as though they were one continuous estimate.

Hume is the preferred rate source. If it is absent, accepted Muse optical pulse intervals can supply pulse rate after agreement between two optical channels. Rate and PRV then come from the same sensor, explicitly flagged; they are related features, not two independent confirmations. Changing the rate source resets both tracks. Changing the optical channel/protocol resets the dual reference and history. Optical channel indices are retained without assuming their wavelengths.

## Feature extraction and quality gates

The deterministic bridge processor emits feature frames at most once per second. It holds bounded raw windows in memory. Every component carries its own validity, reason, source, and supporting raw receipt time. A later computation or phone delivery does not make an old component fresh.

**Optical PRV** uses 32 seconds of nominal 64 Hz data, requiring 2,048 contiguous samples and at least 20 detected pulse intervals. It detrends the signal, applies forward/backward second-order 0.5–5 Hz Butterworth filtering, detects prominent positive maxima, and refines peak positions by parabolic interpolation. The detector excludes the first and last second of the filtered window. It rejects clipping/dropouts, flat or tiny pulses, intervals outside approximately 333–1,500 ms, intervals more than 25% from their median, inconsistent peak amplitudes, weak periodicity, and RMSSD above 250 ms. Rejected beats are not silently repaired or interpolated into intervals.

The entire optical window needs quiet, fresh acceleration coverage. Two eligible optical channels must agree in pulse rate and RMSSD, or one eligible channel must agree in pulse rate with fresh Hume HR. A selected eligible channel remains selected instead of switching on every small quality fluctuation. These software consistency checks do not prove correct pulse detection, independence, or contact quality. Thirty-two-second PRV is a short-window experimental estimate, not a standard five-minute ECG measurement.

**EEG context** uses four seconds of nominal 256 Hz samples with a Hann periodogram. It integrates alpha 8–12 Hz and beta 13–30 Hz, then reports the median beta/alpha ratio from at least two eligible channels among indices 0–3. Gates reject flatness, large voltage or clipping, insufficient alpha/broadband power, excessive low-frequency drift or high-frequency power, and motion. Eye and muscle artifacts can still pass. The ratio has zero weight in the arousal estimate.

Muse components expire after 1.5 seconds without supporting raw input; Hume HR expires after five seconds. Host gaps over 1.5 seconds, known packet-counter discontinuities, or protocol changes clear the affected raw window. Athena lacks verified per-channel sample timestamps/counters: sample positions use nominal cadence with host-coverage checks. Small undetected packet losses, timing error, and wavelength/placement effects remain possible.

Motion is the RMS acceleration-vector deviation about its window mean, rather than acceleration magnitude including gravity. The derived-Muse quiet gate requires mean gravity magnitude 0.75–1.25 g, RMS deviation at most 0.05 g, and maximum deviation at most 0.2 g with sufficient continuous coverage. The live estimator additionally holds when a supplied current motion value exceeds 0.12 g; absent Muse motion does not by itself prevent a Hume HR-only track. All these limits are engineering gates, not validated physiological cutoffs. The [feature implementation](https://github.com/patrickiben/autonomic-telemetry/blob/main/bridge/features.py) defines the full numerical checks.

## Initial personal reference

Sit comfortably and follow reference progress. Each track requires at least 60 eligible feature frames spanning at least 119 seconds, representing approximately two minutes after that track's features become eligible. Reference observations accrue no faster than twice per second. Brief invalid data pause collection; a gap longer than five seconds in eligible data restarts an unfinished reference. Rate-source changes reset both tracks; optical channel/protocol changes reset the dual track. A reference describes the observed initial segment; the software cannot establish that the person was calm, resting physiologically, or in an optimal state.

Once formed, the reference stays fixed. Sustained later elevation is not quietly absorbed by a moving baseline. A later gap longer than five seconds clears the corresponding recent score/trend history while retaining that fixed reference. The references live in page memory, are separate from demonstration input, and are not automatically saved for another visit. Switching Work and Rest does not recalibrate them.

## Formula

Heart rate is averaged over a trailing 15-second window. PRV-RMSSD uses the eligible rolling optical analysis window, then a natural logarithm. For each reference feature, the center is its median and its robust spread is `1.4826 × median absolute deviation`. Stability floors prevent nearly constant data from producing extreme standardized shifts.

```text
h = (current_HR_15s_mean - reference_HR_median)
    / max(3 bpm, reference_HR_robust_spread)

p = (reference_ln_PRV_RMSSD_median - ln(current_PRV_RMSSD))
    / max(0.15, reference_ln_PRV_robust_spread)

h = clamp(h, -3, 3)
p = clamp(p, -3, 3)

dual_raw = clamp(50 + (50 / 3) × (0.6 × h + 0.4 × p), 0, 100)
HR_only_raw = clamp(50 + (50 / 3) × h, 0, 100)
```

The displayed value is the median of that track's raw scores in the trailing five-second window. The HR-only calculation uses its own personal reference; it is explicitly a one-feature estimate, not a two-feature score with an unannounced missing channel.

A score of 50 represents the reference center. Higher values reflect a weighted pattern of higher HR and/or lower PRV; lower values reflect the opposite directions. Opposing changes can cancel in this composite, so the component values and coverage matter. The number is not a percentage probability or a proportion of maximal physiological arousal.

| Display range | Relative label |
| --- | --- |
| Below 40 | Below personal reference |
| 40 through 60 | Around personal reference |
| Above 60 | Above personal reference |

The weights, logarithm, spread floors, clipping, median filter, reference duration, and display thresholds are declared engineering choices. No study validates these coefficients, the 0–100 scale, its labels, or its uncertainty. Availability labels describe the available evidence; they are not statistical confidence intervals or accuracy probabilities. A low or middle estimate does not prove calmness, and a high estimate does not identify a cause.

## Work and Rest

Work supports continuous observation and an optional sustained-elevation cue: the estimate must remain at least 67 for 60 seconds of valid data. The cue is off initially; enabling it permits a gentle on-screen message. This is a personal heuristic for noticing a sustained pattern, not an alarm or a prediction. Missing, stale, or invalid data must not count toward a sustained cue.

Rest offers an optional four-second inhale/six-second exhale guide, change since entering Rest, and a 60-second personal trend. Its comparison resets after a track/source change, stale or held data, or reference reset. A change in the estimate is an observed within-track change, not proof of recovery or a treatment response. Breathing itself can change pulse variability. The guide is independent timing; it does not measure respiration or automatically lower the estimate. Work and Rest use identical scoring and reference rules.

Open **Reference & signals** for reference progress, component values, source, reference comparison, contributions, recent history, and reset. An unavailable estimate shows a dash rather than zero. Reference learning shows its progress; this is data collection, not a claim that the person's state is known.

## Raw-signal visuals

The estimate modulates the light's expansion, pace, and complexity. The light also responds directly to raw Muse EEG variation, optical variation, acceleration, and Hume's reported rate. Those raw artistic mappings have separate feature gates; raw variation is not additional evidence for the estimate. The visual's size, color, or beauty is not an additional score. EEG context has zero weight in the estimate.

For inspection, the raw packet display mappings use:

```text
EEG texture = clamp(population_SD(packet) / 85, 0, 1)
PPG expansion = clamp(population_SD(packet) / max(abs(mean(packet)) × 0.02, 1), 0, 1)
Motion distortion = clamp(abs(latest_XYZ_magnitude - 1 g) × 2, 0, 1)
```

Reported HR adjusts the field's pace smoothly, not individual measured beats. Raw visual variation can exist while a derived feature is withheld. The display must keep those two availability states distinct.

## Source, freshness, and controls

The initial view is Work with Ambient input and no running timer. Try a demo explicitly selects generated variation with its own declared synthetic reference, so its estimate can be explored immediately. Demonstration data stay labeled and separate from live personal references. A simulated Mac bridge is also Demo.

Accepted recent packets are required for a Live source badge. A Bluetooth connection alone is insufficient. Raw visual effects become stale independently after seven seconds and fade toward ambient; the estimate additionally follows the stricter feature validity and freshness rules. Continued ambient animation is not continued measurement. A fresh remaining source can still shape the display under its own label.

The bridge rejects packets more than five seconds old, estimates the Mac-to-phone clock offset conservatively, and preserves original Mac receipt time. Session IDs and increasing sequence numbers prevent old or duplicate events from becoming new evidence. Receipt time and nominal sampling cadence are not independently verified physiological event times.

Timer is optional: 10, 25, or 50 minutes, or a custom duration from 1 to 360 minutes, with pause/resume and end. It follows wall time rather than animation speed. Space offers less copy, gentler movement, a still image, Soft/Vivid color, and full screen where supported. Vivid is the default; reduced-motion preference initializes gentler movement.

## Transport and privacy

The standalone HTML has inline code, styles, and system fonts, with network connections prohibited by its content policy. It can connect directly to Classic Muse through supported Web Bluetooth. Newer Athena Muse, Hume, and iPhone live use the [Mac bridge](BRIDGE.md), which supplies the current derived-feature path. Classic/Athena detection uses Bluetooth characteristics, not the advertised name.

The bridge permits same-origin state, control, and event connections in the local copy. It processes raw packets and derived features in memory, without a recording database or cloud upload. Local HTTP is unencrypted and requires trusted private Wi-Fi. Private run links and QR codes grant access to that run and must stay private.

The canvas does not automatically persist raw signals, personal references, or settings. Recording import/export and explicit reference-file tools remain in the separate Signal Lab. Reloading resets the live canvas. Use Disconnect and stop the bridge to release wearables. [Device tests](DEVICES.md) establish bounded transport behavior, not the validity of this new inference.

## Primary evidence and implementation sources

- [Pieper et al.: ambulatory stressful events, worry, HR, and HRV](https://pubmed.ncbi.nlm.nih.gov/20410249/) provides primary observational context for cardiac patterns around stress-related experience. Such associations do not identify an individual's current mental state or validate this composite.
- [Singstad et al.: simultaneous finger PPG/ECG at rest, mild exercise, and mild mental stress](https://pmc.ncbi.nlm.nih.gov/articles/PMC8713388/). Detection choices and artifacts materially affect PRV estimates; this is not a validation of forehead Muse PRV.
- [Bent & Dunn: wrist optical sampling-rate experiment](https://pmc.ncbi.nlm.nih.gov/articles/PMC8057382/). RMSSD differed from ECG even at the highest tested optical sampling rate; 64 Hz alone does not establish ECG equivalence.
- [Whitham et al.: scalp EEG during paralysis](https://pubmed.ncbi.nlm.nih.gov/17574912/). Muscle contamination complicates interpretation of higher-frequency scalp EEG, supporting separation of EEG context from the headline estimate.
- [Classic Muse source](https://github.com/urish/muse-js/tree/4e864578c55dd7e26d85b429863f47ccabac54a0), [Athena Muse source](https://github.com/eugenehp/muse-rs/blob/7d6a885cfbb076ec8d50e6f44935a357c65eaf80/src/parse.rs), and [Hume interoperability source](https://github.com/brendangooden/j2208-band-tools/tree/62ce48357e25d1c68e4c3e0bfd8d2cf1bbd745e9) inform transport and decoding.

These sources support measurement boundaries and implementation context. They do not validate this custom inferred-arousal model, its thresholds, or outcomes from using it.
