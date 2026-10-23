# Advanced Signal Lab methods

[Signal Lab](../Autonomic_Telemetry_Signal_Lab.html) now begins its analytical views with **Integrated arousal model**: the same `multivariate-1` engine that drives the main visual. It automatically replays the normalized recording through its cursor, or opens an exact feature export from the main page. Its formula, two-minute fixed profile, zero-reference scale, quality gates, and causal event detector are documented in [Live multivariate methods](METHODS.md). Rewinding replays only the available prefix; future observations cannot train the current result.

The remaining sections below document the retained **Directional shift · comparison model**, its normalized recording schema, fixed reference, first-difference novelty, descriptive lenses, markers, JSON export, and retrospective wearable context. That three-signal model is deliberately separate from the integrated headline. Both are experimental; their thresholds are not clinical cutoffs. Raw Bluetooth diagnostics do not silently turn a demo recording into measured data.

The Lab's retained direct-browser Muse diagnostics use the Classic transport and have not been physically verified here. The immersive canvas's Mac bridge separately supports Classic and Athena transport, plus Hume's reported rate; its hardware evidence does not validate this recording model or imply Athena support in the Lab's browser adapter. See [Devices](DEVICES.md).

The additional **Original research lenses** are documented separately in [Research engine methods](RESEARCH_ENGINE.md): rolling AR(1)/EWMA surprise, regularized multivariate distance, covariance/PCA concentration, sample entropy, signed cross-lags, and RR-only interval metrics. They restore research capabilities with explicit mathematical definitions and input requirements; they are not an unchanged copy of the prototype or clinical measures. The core first-difference novelty below remains distinct from AR prediction-error surprise, and the core HR/RMSSD portrait remains distinct from a PCA lens.

## Live analysis session replay

Use **Open a live analysis session** in the integrated panel for the main page's `live-multivariate-1` JSON export. It preserves feature and browser-observation timestamps, per-channel quality/source, synthetic versus personal provenance, model version, and any explicit starting reference. The imported session has its own cursor. **Follow the recording again** restores the normalized-recording cursor. A file accepts up to 20,000 frames and 30 MB. The main page visibly stops its in-memory recording at 20,000 frames while live analysis continues.

## 1. Normalized JSON and CSV


Top-level JSON fields:

| Field | Contract |
| --- | --- |
| `schema_version` | `2` |
| `provenance` | `{kind: "synthetic" | "user-supplied", label: string}` |
| `samples` | Array of normalized sample objects |
| `markers` | Array of `{timestamp, label}` annotations |
| `context` | Optional retrospective wearable-context snapshot |

Every normalized sample uses these fields:

| Field | Unit or allowed value | Role |
| --- | --- | --- |
| `timestamp` | ISO 8601 with explicit timezone, or Unix epoch milliseconds | Ordering, durations, gaps |
| `heart_rate_bpm` | Number or `null`; beats/minute | Index and descriptive lenses |
| `rmssd_ms` | Number or `null`; milliseconds | Index and descriptive lenses |
| `resp_rate_brpm` | Number or `null`; breaths/minute | Index and descriptive lenses |
| `eeg_beta_alpha` | Number or `null`; supplied ratio | Integrated model term and descriptive view; no weight in the three-signal comparison |
| `pulse_sdnn_ms` | Optional number or `null`; milliseconds | Explicitly supplied sample SDNN for the integrated model; no weight in the comparison |
| `motion_g` | Number or `null`; gravity-removed motion magnitude in g | Motion gate |
| `quality` | `good`, `poor`, or `unknown` | Eligibility gate |

CSV headers use the sample field names above, with no extra columns. Blank numeric cells become `null`. A missing value is never converted to a zero measurement. Use ISO 8601 timestamps with seconds and an explicit timezone (`Z` or `±HH:MM`), numeric epoch milliseconds in JSON, or 13-digit epoch milliseconds in CSV. Epoch-number inputs are limited to 2000–2100; seconds are not accepted. Rows must arrive in order, with at least one second between samples. Dense summaries must be aggregated before import. A session accepts 1–20,000 samples in a file up to 20 MB. CSV defaults to `user-supplied`; JSON must explicitly declare its provenance kind. A source label is not certification of a measurement. Markers annotate the recording and do not change the calculations.

Supported input bounds are HR 25–240 bpm, RMSSD 0–500 ms, respiratory rate 3–60 breaths/min, optional EEG ratio 0–100, optional pulse SDNN 0–500 ms, and motion 0–16 g. Out-of-range values are rejected rather than clipped. These are software input bounds, not physiological normal ranges.

## 2. Comparison model: eligibility and fixed reference


A model-eligible sample must satisfy all of the following:

1. Its supplied quality is `good`.
2. When motion is supplied, `motion_g <= 0.25`. Missing motion is permitted, but cannot confirm low motion.
3. At least two of the three index channels—heart rate, RMSSD, respiratory rate—are present.

The initial reference needs at least 60 eligible samples spanning at least 119 seconds. Its candidate collection restarts after an excluded sample, fewer than two available index channels, a gap longer than 10 seconds, or a change in the available index-channel set. Its endpoint completes calibration; scoring begins with the next eligible sample. The reference is fixed once formed; it does not adapt to a sustained later shift. A reference is a comparison segment, not a claim that the participant was resting, healthy, or in an optimal state.

A later sample must have the **same** available index-channel set as the reference. If a reference used all three channels, a later row missing RMSSD is not rescored as a two-channel composite. The index is withheld. This avoids an apparent shift caused only by changing weights. Quality and motion exclusions are applied before model outputs; invalid segments are not bridged to manufacture continuity.

There is no automatic baseline persistence or Apple Health baseline seeding. Reloading or starting another recording discards the comparison model's reference. The integrated model separately supports an explicit reference carried by a main-page session export.

## 3. Comparison model: pattern-shift index

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

## 4. Novelty and coincident change events

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

## 5. Descriptive lenses and pacer

- **Trend association:** Pearson correlation of aligned clean contiguous HR and respiratory-rate summaries in the latest window of up to 60 seconds, requiring at least 20 paired samples. Correlated rates do not establish respiratory sinus arrhythmia, physiological coupling strength, or causal direction.
- **Temporal texture / HR persistence:** lag-one association of consecutive clean HR summaries, requiring at least 20 samples. It is a sample lag, not a fixed one-second lag on irregular inputs. Sampling and smoothing affect it; it is not evidence of critical slowing or an impending transition.
- **Temporal texture / RMSSD dispersion:** sample standard deviation of at least 20 supplied RMSSD summary values in that same window. It is not beat-to-beat SDNN, entropy, or a derived measure of autonomic complexity.
- **State portrait:** standardized HR versus standardized RMSSD, relative to the fixed reference. It is a two-axis plot, not PCA or a learned phenotype.
- **Breathing pacer:** an independent visual timing guide. It does not measure breathing, RSA, HRV biofeedback, adherence, or a treatment response, and its speed does not alter the sample model.

No LF/HF, spectral power, RSA amplitude, critical-transition predictor, or causal lead–lag network is computed in this release.

## 6. Retrospective wearable context

The Lab can import Apple Health `export.xml` as context and accept a dated manual Hume reading. Context cannot seed the reference, fill a missing recording channel, or enter the index. Apple's SDNN is not substituted for RMSSD. An unspecified HRV definition stays unspecified.

Health XML is limited to 100 MB. Within each original source name, the latest supported record is selected by timestamp, not by XML order. Supported quantities are resting HR, SDNN, respiratory rate, and oxygen saturation, with unit and value checks. Each metric shows its date; records at least 30 days old receive an age warning. No sleep stage or overnight-recovery estimate is derived. One context snapshot is held at a time.

The live Hume Mac adapter is a different path, providing device-reported current heart rate to the immersive canvas. It does not convert a sparse Health export into a live feed or create the Lab's RMSSD/respiratory features.

## 7. Provenance, export, and privacy

Synthetic examples remain labeled synthetic. User-supplied recordings are not certified measurements. Missing values remain null. JSON export preserves the complete loaded recording, markers, and context, including content that may be sensitive. The Lab's recording and context remain in page memory unless explicitly exported; its reference is not automatically saved.

The bundled eight-minute synthetic example supplies one summary per second. Playback, seeking, and moment presets change the view of that recording; they do not change sample timestamps or acquire real measurements. A software test can verify tested arithmetic or import behavior, not physiological validity.

## Sources and claim boundaries

- [Billman (2013)](https://pmc.ncbi.nlm.nih.gov/articles/PMC3576706/): cautions about LF/HF interpretation; the Lab omits that ratio.
- [Laborde, Mosley & Thayer (2017)](https://pmc.ncbi.nlm.nih.gov/articles/PMC5316555/): careful HRV design, analysis, and reporting.
- [Apple HealthKit SDNN definition](https://developer.apple.com/documentation/healthkit/hkquantitytypeidentifier/heartratevariabilitysdnn).

These references provide measurement context. They do not validate the custom index, weights, floors, tiers, novelty metric, or event detector.
