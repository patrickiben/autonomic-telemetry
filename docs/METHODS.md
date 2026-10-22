# Methods and data contract

This document describes the experimental model implemented in the console. The design favors inspectable arithmetic and clear missing-data behavior. None of the custom outputs has been clinically validated. Numerical precision in the UI is not a confidence interval.

## 1. Scope and acquisition

The console visualizes normalized time-series summaries. It does not acquire live device data or estimate heart rate, RMSSD, breathing, EEG spectra, or signal quality from raw sensors. An importer's `quality: "good"` is an assertion supplied with the file, not a quality judgment independently verified by the console.

The bundled deterministic eight-minute demo supplies one synthetic sample per second. Playback can advance faster than wall time without changing the sample timestamps or numerical results. A preloaded two-minute synthetic segment supplies its reference. Reference, Change, Easing, and Motion presets jump to moments in that same recording. Synthetic provenance remains visible and survives export.

Muse Web Bluetooth and OSC paths from the original prototype are unsupported and removed. Future integrations would need protocol verification, timing and unit checks, artifact handling, and validation against appropriate reference recordings.

## 2. Normalized JSON and CSV

Top-level JSON fields:

| Field | Contract |
| --- | --- |
| `schema_version` | `2` |
| `provenance` | `{kind: "synthetic" | "user-supplied", label: string}` |
| `samples` | Array of normalized sample objects |
| `markers` | Array of `{timestamp, label}` annotations |

Every normalized sample uses these fields:

| Field | Unit or allowed value | Role |
| --- | --- | --- |
| `timestamp` | ISO 8601 with explicit timezone, or Unix epoch milliseconds | Ordering, durations, gaps |
| `heart_rate_bpm` | Number or `null`; beats/minute | Index and descriptive lenses |
| `rmssd_ms` | Number or `null`; milliseconds | Index and descriptive lenses |
| `resp_rate_brpm` | Number or `null`; breaths/minute | Index and descriptive lenses |
| `eeg_beta_alpha` | Number or `null`; supplied ratio | Supplied value in Temporal texture; no physiological interpretation or index weight |
| `motion_g` | Number or `null`; gravity-removed motion magnitude in g | Motion gate |
| `quality` | `good`, `poor`, or `unknown` | Eligibility gate |

CSV headers use the sample field names above, with no extra columns. Blank numeric cells become `null`. A missing value is never converted to a zero measurement. Use ISO 8601 timestamps with seconds and an explicit timezone (`Z` or `±HH:MM`), numeric epoch milliseconds in JSON, or 13-digit epoch milliseconds in CSV. Epoch-number inputs are limited to 2000–2100; seconds are not accepted. Rows must arrive in order, with at least one second between samples. Dense summaries must be aggregated before import. A session accepts 1–20,000 samples in a file up to 20 MB. CSV defaults to `user-supplied`; JSON must explicitly declare its provenance kind. A source label is not certification of a measurement. Markers annotate the recording and do not change the calculations.

Supported input bounds are HR 25–240 bpm, RMSSD 0–500 ms, respiratory rate 3–60 breaths/min, optional EEG ratio 0–100, and motion 0–16 g. Out-of-range values are rejected rather than clipped. These are software input bounds, not physiological normal ranges.

## 3. Eligibility and fixed reference

A model-eligible sample must satisfy all of the following:

1. Its supplied quality is `good`.
2. When motion is supplied, `motion_g <= 0.25`. Missing motion is permitted, but cannot confirm low motion.
3. At least two of the three index channels—heart rate, RMSSD, respiratory rate—are present.

The initial reference needs at least 60 eligible samples spanning at least 119 seconds. Its candidate collection restarts after an excluded sample, fewer than two available index channels, a gap longer than 10 seconds, or a change in the available index-channel set. Its endpoint completes calibration; scoring begins with the next eligible sample. The reference is fixed once formed; it does not adapt to a sustained later shift. A reference is a comparison segment, not a claim that the participant was resting, healthy, or in an optimal state.

A later sample must have the **same** available index-channel set as the reference. If a reference used all three channels, a later row missing RMSSD is not rescored as a two-channel composite. The index is withheld. This avoids an apparent shift caused only by changing weights. Quality and motion exclusions are applied before model outputs; invalid segments are not bridged to manufacture continuity.

There is no automatic baseline persistence and no Apple Health baseline seeding. Reloading or starting another recording discards the current session's reference.

## 4. Pattern-shift index

Let `mu[j]` and `sd[j]` be a channel's reference mean and sample standard deviation. The effective standard deviation is `max(sd[j], floor[j])`. Floors prevent an almost constant reference from producing extreme scores for tiny changes.

| Channel | Direction scored | Original weight | SD floor |
| --- | --- | ---: | ---: |
| Heart rate | Increase | 0.4 | 2 bpm |
| RMSSD | Decrease | 0.4 | 5 ms |
| Respiratory rate | Increase | 0.2 | 1 breath/min |

The weights are normalized **once** over the channels available in the reference. With HR and RMSSD, for example, they become 0.5 and 0.5. This set remains fixed for subsequent scoring.

For each reference channel:

```text
z[j] = direction[j] * (value[j] - mu[j]) / effective_sd[j]
contribution[j] = normalized_weight[j] * clamp(z[j], 0, 4) / 4
index = 100 * sum(contribution[j])
```

Directions are `+1` for heart rate and respiration and `-1` for RMSSD. Only HR increases, RMSSD decreases, and respiratory-rate increases contribute; opposite-direction deviations contribute zero. The index is therefore one-sided, not the full distance from reference. A low score means little shift in the scored directions. Even large HR decreases, RMSSD increases, or respiratory-rate decreases can score zero, so a low score does not establish closeness to the reference, calmness, or health.

| Index range | Display label |
| --- | --- |
| Below 25 | Low directional shift |
| 25 to below 46 | Small shift |
| 46 to below 68 | Moderate shift |
| 68 to 100 | Large shift |

Weights, SD floors, clipping at four standard deviations, and tier cutoffs are arbitrary transparent design choices. The labels are not validated physiological states or medical thresholds.

## 5. Novelty and coincident change events

Novelty describes the latest feature **first differences per second**. Each step is divided by its actual timestamp interval, centered by the reference's mean rate of change, standardized by its rate-of-change variability, then combined as a root mean square across the reference channels. The rate-of-change SD floors are 0.5 bpm/s for HR, 1 ms/s for RMSSD, and 0.15 (breaths/min)/s for respiration.

```text
rate[j] = (current[j] - previous[j]) / elapsed_seconds
q[j] = (rate[j] - reference_rate_mean[j]) / max(reference_rate_sd[j], rate_floor[j])
novelty = sqrt(mean(q[j]^2))
```

It is dimensionless. It is not negative log-likelihood, information in nats, a forecast, or a measured thermodynamic quantity. A stable elevated plateau may have a high shift index and low novelty. A gap longer than 10 seconds or an excluded sample breaks the step history.

An event requires all of the following on eligible data:

- Novelty of at least 3.
- At least two directional steps—HR up, RMSSD down, or respiration up—each at least one effective reference SD from the preceding five-second mean, with at least three prior clean samples in that interval.
- At least 20 seconds since the previous event.

These are heuristic coincidence rules. They do not identify stress, sympathetic surges, posture changes, artifacts, or causes. Quality-excluded periods are not relabeled as physiological events. The threshold is not an estimated false-positive rate, and an absence of events does not establish physiological stability.

## 6. Descriptive lenses and pacer

- **Trend association:** Pearson correlation of aligned clean contiguous HR and respiratory-rate summaries in the latest window of up to 60 seconds, requiring at least 20 paired samples. Correlated rates do not establish respiratory sinus arrhythmia, physiological coupling strength, or causal direction.
- **Temporal texture / HR persistence:** lag-one association of consecutive clean HR summaries, requiring at least 20 samples. It is a sample lag, not a fixed one-second lag on irregular inputs. Sampling and smoothing affect it; it is not evidence of critical slowing or an impending transition.
- **Temporal texture / RMSSD dispersion:** sample standard deviation of at least 20 supplied RMSSD summary values in that same window. It is not beat-to-beat SDNN, entropy, or a derived measure of autonomic complexity.
- **State portrait:** standardized HR versus standardized RMSSD, relative to the fixed reference. It is a two-axis plot, not PCA or a learned phenotype.
- **Breathing pacer:** an independent visual timing guide. It does not measure breathing, RSA, HRV biofeedback, adherence, or a treatment response, and its speed does not alter the sample model.

No LF/HF, spectral power, RSA amplitude, critical-transition predictor, or causal lead–lag network is computed in this release.

## 7. Device context: Hume Band 2.0 and Apple Watch

Hume Band 2.0 daily context can be entered with **Add Hume reading** using a date, resting HR, HRV, and respiratory rate. The HRV definition selector accepts Unspecified / not confirmed, RMSSD, or SDNN. Unspecified HRV is not relabeled or converted. These are user-transcribed notes, held in memory and included in exports; they cannot feed a 1 Hz session score or seed its reference. One context snapshot is held at a time; adding another manual reading or Health XML replaces it. The supplied calendar date is serialized at noon UTC for export; it is not an observed measurement timestamp.

Hume's [FAQ](https://humehealth.com/en-gb/pages/faq) describes incomplete Connected Apps sharing and lists native export as “Coming Soon” (checked 2026-10-22). No Hume export format, direct Bluetooth link, or public API is assumed. If Hume metrics are present in Apple Health, they can be reviewed through the XML context path. Google Fit import is not implemented.

The Apple Health XML path is retrospective context only, with a 100 MB local-file limit. Its source-name filter keeps records from Hume, Apple Watch, or another writer separate and initially selects a Hume-named source when present. Supported quantities are resting HR, SDNN, respiratory rate, and oxygen saturation. For each supported metric within the selected source, the importer validates the unit and selects the record with the latest measurement timestamp (`endDate`, falling back to `startDate`), rather than taking the final XML element. The displayed date belongs to that metric; records may have different ages. Records at least 30 days old receive an age warning. This 30-day label is an interface convention, not a clinical validity boundary.

HealthKit's HRV quantity is **SDNN**. It is kept distinct from RMSSD and cannot populate the model's RMSSD field. Sparse Health records cannot form the session reference or enter the index or event detector. The importer makes no sleep-stage or overnight-recovery estimate. Only normalized JSON/CSV sessions and Apple Health `export.xml` context are supported; vendor CSV and Health Auto Export JSON are not interchangeable with this schema.

## 8. Privacy and reproducibility

There are no fetch calls, remote assets, analytics, browser-storage writes, or automatic uploads. Imported content is held in memory for the current page. A reload clears it. Export explicitly creates a JSON file that preserves provenance, timestamps, null values, quality flags, and markers. Such a file may contain personal information; review it before sharing.

The synthetic session and playback controls allow reproducible review of the interface. JSON export includes the complete loaded recording, not just the portion already played. Passing software tests verifies the tested software behavior; it cannot establish clinical accuracy or validate a physiological interpretation.

## Sources and claim boundaries

- [Billman GE (2013). The LF/HF ratio does not accurately measure cardiac sympathovagal balance.](https://pmc.ncbi.nlm.nih.gov/articles/PMC3576706/) Supports caution about interpreting LF/HF; this release omits that ratio.
- [Laborde S, Mosley E, Thayer JF (2017). Heart rate variability and cardiac vagal tone in psychophysiological research.](https://pmc.ncbi.nlm.nih.gov/articles/PMC5316555/) Supports careful HRV measurement, study design, analysis, and reporting. HRV interpretation depends on recording methods and context.
- [Apple HealthKit documentation: heartRateVariabilitySDNN.](https://developer.apple.com/documentation/healthkit/hkquantitytypeidentifier/heartratevariabilitysdnn) Defines Apple's SDNN quantity; it does not define RMSSD.

These references provide context only. They do not support or validate the custom composite, its weights, thresholds, novelty metric, event detector, or any clinical use.
