# A living view, with a personal estimate

The canvas gives the experimental **inferred arousal estimate** a consistent visual meaning. Work supports continuous observation and an optional sustained-elevation cue; Rest adds paced breathing and a personal settling trend. They share the same estimate, references, and visual scale.

## What the number means

The 0–100 estimate compares cardiac features with an initial personal reference. **50 represents that reference.** Higher values reflect higher heart rate and/or lower pulse-interval variability; lower values reflect the opposite pattern. The dual estimate uses Hume's reported HR and eligible Muse PPG-derived PRV-RMSSD. If Hume is absent, accepted Muse pulse intervals can supply rate after optical-channel agreement; HR and PRV then share one sensor rather than providing independent confirmation. A rate-source change rebuilds the reference. EEG remains separate context with zero estimate weight.

A clearly labeled HR-only estimate has its own reference and history when PRV is unavailable. Coverage changes cannot silently alter the dual weights or manufacture a settling trend. Reference progress and unavailable-feature reasons remain visible. The estimate is a personal heuristic, not direct sympathetic activity, a mental-state diagnosis, or a validated attention, stress, meditation, or health score. Its uncertainty is qualitative feature coverage, not a probability or confidence interval.

Open **Reference & signals** to see reference progress, source and feature values, contributions, recent history, and reset. An unavailable estimate is a dash, not zero. See [Methods](METHODS.md) for the exact formula, reference rules, quality gates, arbitrary thresholds, and evidence boundaries. The [Advanced Signal Lab](../Autonomic_Telemetry_Signal_Lab.html) retains a separate recording model and research tools; those scores are not this live estimate.

## What shapes the light

- **The available estimate alone** sets the cloud's extent, brightness, warmth, and star-arm spread. Lower values are smaller and cooler aqua; the personal reference at 50 is lavender; higher values are larger, brighter, and warmer coral/peach. A fixed reference orbit marks 50 so the changing extent has a stable comparison.
- **Work** presents a slowly spiraling galaxy. **Rest** presents a diffuse nebula. The score-to-size and score-to-color meanings stay the same in both modes.
- **Raw EEG and optical variation** add only minor filament texture. They do not independently enlarge or brighten the score cloud. Raw motion does not move the cloud; its role in feature quality gates is unchanged.
- **Rest's breathing guide** is a separate outer ring. Its inhale/exhale cycle does not resize the score cloud or manufacture a change in the estimate.

The small visual key in the experience explains this mapping. Color and size encode the displayed estimate; they are not extra evidence, another physiological score, or individual heartbeat timing. A raw trace can remain visible while a derived feature is withheld.

## Keep the source in view

| Label | Meaning |
| --- | --- |
| Ambient | Decorative movement; no fresh device input is shaping it |
| Live · Muse / Hume | Accepted recent raw packets from the named source |
| Demo | Explicitly synthetic input, including bridge simulation |
| Ambient · waiting for device | Connection or first data is pending |
| Ambient · signal paused | The device stream is stale or interrupted |

Live raw input and a usable estimate are different states. A connected device can lack an eligible derived feature or completed reference. Waiting, held, and stale states remove the score-encoded halo and show a distinct ambient sky. An unavailable estimate is never animated back toward 50. Continuing ambient movement does not manufacture samples or extend a valid estimate. The Connect sheet holds nearby-device selection, status, feature details, and a recent raw preview.

## Work and Rest

Work's optional sustained-elevation cue is off initially; when enabled, it gives a gentle message after an estimate of at least 67 persists for 60 seconds of valid data. It does not identify a cause or predict an outcome. Rest's optional four-second inhale/six-second exhale guide provides timing, not measured respiration. Rest shows change since entering that mode and a 60-second trend within the same track; interruptions or source/reference changes reset the comparison. A lower estimate is an observation, not proof of recovery. Breathing itself can change pulse variability.

Space provides less copy, gentler movement, a still image, Soft/Vivid color, and full screen where supported. Vivid is the default. Gentler movement and the system's reduced-motion preference freeze decorative drift while allowing static redraws for updated estimates. Still image freezes canvas updates for fresh values. If the estimate becomes stale, held, or unavailable, its score encoding clears once even while Still image remains on. The number and status continue updating. Timer remains optional and does not control feature extraction, reference formation, or the estimate.

Raw packets, derived features, references, and visual settings stay in memory. The [Mac bridge](BRIDGE.md) drives the iPhone experience over unencrypted HTTP on trusted private Wi-Fi; the public standalone page does not start that server or a cloud connection.
