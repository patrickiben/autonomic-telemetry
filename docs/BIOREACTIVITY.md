# A living view, with a personal estimate

The canvas combines raw wearable-responsive light with an experimental **inferred arousal estimate**. Work supports continuous observation and an optional sustained-elevation cue; Rest adds paced breathing and a personal settling trend. They share the same estimate and references, with different visual palettes and interactions.

## What the number means

The 0–100 estimate compares cardiac features with an initial personal reference. **50 represents that reference.** Higher values reflect higher heart rate and/or lower pulse-interval variability; lower values reflect the opposite pattern. The dual estimate uses Hume's reported HR and eligible Muse PPG-derived PRV-RMSSD. If Hume is absent, accepted Muse pulse intervals can supply rate after optical-channel agreement; HR and PRV then share one sensor rather than providing independent confirmation. A rate-source change rebuilds the reference. EEG remains separate context with zero estimate weight.

A clearly labeled HR-only estimate has its own reference and history when PRV is unavailable. Coverage changes cannot silently alter the dual weights or manufacture a settling trend. Reference progress and unavailable-feature reasons remain visible. The estimate is a personal heuristic, not direct sympathetic activity, a mental-state diagnosis, or a validated attention, stress, meditation, or health score. Its uncertainty is qualitative feature coverage, not a probability or confidence interval.

Open **Reference & signals** to see reference progress, source and feature values, contributions, recent history, and reset. An unavailable estimate is a dash, not zero. See [Methods](METHODS.md) for the exact formula, reference rules, quality gates, arbitrary thresholds, and evidence boundaries. The [Advanced Signal Lab](../Autonomic_Telemetry_Signal_Lab.html) retains a separate recording model and research tools; those scores are not this live estimate.

## What shapes the light

- **Raw EEG variation** changes texture. Spectral context is separate; neither supplies a direct mental-state classification.
- **Raw optical variation** changes expansion. The separate PRV extractor detects eligible pulse intervals under its own motion and signal gates; raw visual movement alone does not establish usable PRV.
- **Motion** changes lateral distortion and helps gate derived Muse features. Low motion does not prove contact quality.
- **Hume's reported HR** changes overall pace, without marking individual measured heartbeats.

The estimate also shapes expansion, pace, and complexity. The raw artistic mappings and their smoothing are not extra evidence or a second physiological score. A raw trace can still be visible while a derived feature is withheld.

## Keep the source in view

| Label | Meaning |
| --- | --- |
| Ambient | Decorative movement; no fresh device input is shaping it |
| Live · Muse / Hume | Accepted recent raw packets from the named source |
| Demo | Explicitly synthetic input, including bridge simulation |
| Ambient · waiting for device | Connection or first data is pending |
| Ambient · signal paused | The device stream is stale or interrupted |

Live raw input and a usable estimate are different states. A connected device can lack an eligible derived feature or completed reference. A stale stream fades toward ambient; continuing animation does not manufacture samples or extend a valid estimate. The Connect sheet holds nearby-device selection, status, feature details, and a recent raw preview.

## Work and Rest

Work's optional sustained-elevation cue is off initially; when enabled, it gives a gentle message after an estimate of at least 67 persists for 60 seconds of valid data. It does not identify a cause or predict an outcome. Rest's optional four-second inhale/six-second exhale guide provides timing, not measured respiration. Rest shows change since entering that mode and a 60-second trend within the same track; interruptions or source/reference changes reset the comparison. A lower estimate is an observation, not proof of recovery. Breathing itself can change pulse variability.

Space provides less copy, gentler movement, a still image, Soft/Vivid color, and full screen where supported. Vivid is the default. Timer remains optional and does not control feature extraction, reference formation, or the estimate.

Raw packets, derived features, references, and visual settings stay in memory. The [Mac bridge](BRIDGE.md) drives the iPhone experience over unencrypted HTTP on trusted private Wi-Fi; the public standalone page does not start that server or a cloud connection.
