# Methods and data contract

This document describes the practice tools, experimental signal model, and data contract implemented in the console. The design favors inspectable arithmetic and clear missing-data behavior. None of the custom signal outputs has been clinically validated. Numerical precision in the UI is not a confidence interval.

## Modes, workbench, and clocks

**Rest & meditation** is the default quiet workspace, with an optional breathing guide, a 10-minute practice timer, an intention, and optional self-rated ease. Rest activities are relaxation, comfortable breathing, or meditation. **Work & learning** starts with an untimed task companion: one current task, small step checkoffs, a queue, distraction parking, a checkpoint for returning, break/resume, and completed-task history. A focus timer is optional and its disclosure starts closed. The task workflow does not require a wearable or countdown.

Tasks, steps, interruptions, and completion are user-entered records. The interface supports self-directed organization, including ADHD-friendly workflows, without claiming to treat ADHD, infer attention from EEG, or measure learning, productivity, or task quality. Marking a task complete records a user's choice. It does not depend on a physiological threshold, and unchecked steps remain unchecked. The progress trail counts the user's checkoffs; it is not sensor-driven.

Themes are presentation choices: Rest uses deep evergreen, sage, and warm neutrals; Work uses midnight blue, indigo, periwinkle, and cool accents. Each scheme stays consistent across backgrounds, panels, controls, dialogs, and timers. Theme colors do not encode a physiological state or alter any calculation. Mobile layouts keep work controls accessible and offer quick practice controls when using the timer.

The two modes retain separate practice drafts and timers. Duration presets are 5/10/20 minutes for rest and 25/45/60 minutes for an optional work timer, with custom durations from 1 to 180 whole minutes. Duration, activity, and the optional before-rating are set while idle. Start, pause/resume, reset, and finish are explicit controls. Elapsed time follows the wall clock, not the recording's timestamp, playback multiplier, or scrubber. Paused time does not contribute to elapsed practice time. A countdown completes at its planned duration or when explicitly finished early. Reset preserves duration, intention, activity, and completed recaps while clearing the current timer, ratings, and reflection. The visual pacer is independent and is not a breathing measurement.

Switching modes pauses a running practice and the pacer while retaining the workbench, dataset, provenance, reference, markers, and wearable context. It does not recalibrate, alter score weights or thresholds, change samples, or assign a different physiological meaning to the same recording.

Timed-practice completion is quiet and produces a timestamped self-reported recap: mode, activity, planned duration, elapsed time, intention, and optional before/after ratings or reflection. Intentions are limited to 160 characters and reflections to 300. Ratings are optional integers from 1 (very little ease or focus) to 5 (ample). Ease and focus are different questions and are not inferred from wearable signals. Up to 200 practice recaps are retained in memory, with the latest eight displayed. Task completion history is separate from these timer recaps.

Explicit JSON export preserves the workbench and practice workspace alongside the recording. Importing workspace notes restores any running timers as paused and replaces the task board when a workbench is supplied. A file without a workbench retains the current task board; a file without any workspace also retains current practice drafts and notes while pausing the active timer and pacer. Opening a recording does not change the model definitions. By default, workspace information is memory-only; optional task-board persistence is described under Privacy below.

## 1. Scope and acquisition

The scored session model visualizes normalized time-series summaries. It does not estimate heart rate, RMSSD, breathing, EEG spectra, or signal quality from raw sensors. An importer's `quality: "good"` is an assertion supplied with the file, not a quality judgment independently verified by the console.

A separate experimental Muse S Bluetooth preview inspects raw device input: EEG voltage, PPG ADC counts, acceleration, battery, packet counts, and freshness. It is hardware-unverified and does not provide model features, change the selected session's provenance, or enter its index, reference, or event detector. The labeled demo or imported recording remains the signal model's source. Raw preview data stays in a bounded memory buffer (approximately 60 seconds, at most 10,000 packets) and is not exported. Hume Band 2.0 and Apple Watch paths provide daily context rather than a live scored feed. See [Device setup](DEVICES.md) for acquisition boundaries and browser constraints.

### Bio-reactive visual companion

The visual companion can use raw Muse S input, an explicitly selected synthetic demonstration, or an ambient animation with no device link. Its default Signal bloom maps relative raw EEG amplitude and sample-to-sample variation to layered organic contours. Signal tide shows the EEG waveform, Pulse ribbon represents raw PPG ADC counts without beat detection, and Motion field represents acceleration magnitude including gravity. That raw motion quantity is distinct from the gravity-removed `motion_g` field accepted by the scored session model. Live bloom geometry changes only with the received sample window; no simulated heartbeat or breathing cycle is added.

A live raw label requires a connected, streaming device and fresh data for the selected signal within five seconds. Stale or disconnected Muse input freezes and dims the last frame; it never silently substitutes demonstration or ambient motion. Display autoscaling is labeled. Neither shape nor color is an attention, meditation, stress, or productivity score, and no visual input feeds the pattern-shift model.

Low-motion animation is the default. Reduced-motion preferences make demonstration and ambient visuals static and limit live snapshots to at most once per second. Quiet view hides the canvas while keeping source status and controls available. These visual settings are neither persisted nor exported. See [Bio-reactive visuals](BIOREACTIVITY.md) for exact mappings and freshness rules.

The bundled deterministic eight-minute demo supplies one synthetic sample per second. Playback can advance faster than wall time without changing the sample timestamps or numerical results. A preloaded two-minute synthetic segment supplies its reference. Reference, Change, Easing, and Motion presets jump to moments in that same recording. Synthetic provenance remains visible and survives export.

The original Muse-derived physiological features and OSC bridge are unsupported and removed. Converting any experimental raw preview into a scored feed would require protocol verification, timing and unit checks, artifact handling, and validation against appropriate reference recordings.

## 2. Normalized JSON and CSV

Top-level JSON fields:

| Field | Contract |
| --- | --- |
| `schema_version` | `2` |
| `provenance` | `{kind: "synthetic" | "user-supplied", label: string}` |
| `samples` | Array of normalized sample objects |
| `markers` | Array of `{timestamp, label}` annotations |
| `context` | Optional retrospective wearable-context snapshot |
| `workspace` | Optional version-1 workspace for practice and the workbench; independent of signal schema version 2 |

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

### Optional practice workspace

The optional `workspace` object uses its own `schema_version: 1` and contains:

| Field | Contract |
| --- | --- |
| `active_mode` | `rest` or `work` |
| `practices` | Independent `rest` and `work` practice drafts |
| `sessions` | At most 200 completed practice recaps |
| `signal_details` | Boolean visibility preference for `rest` and `work`; both default to false |
| `work_timer_visible` | Optional boolean; false by default |
| `workbench` | Optional self-directed task board and distraction parking |

Each draft records `mode`, `phase` (`idle`, `running`, `paused`, `complete`), `activity`, `durationMs`, `elapsedMs`, derived `remainingMs`, `intention`, optional `before`/`after` ratings, `outcome`, `startedAt`, `endedAt`, and `entryId`. Activities are `rest`/`breath`/`meditation` in rest mode and `focus`/`learn`/`practice` in work mode. Unset ratings and timestamps remain `null`. Completed session entries add an `id` and `source: "self-reported"`. Durations and elapsed times are milliseconds; timestamps are epoch milliseconds. Wall-clock timer anchors are not exported. Import validates the workspace, recalculates remaining time, and changes `running` to `paused`; it does not run a timer retroactively while the file was closed.

### Optional task workbench

`workspace.workbench` is independent of the timers and signal model. Its `version: 1` contract is:

| Field | Contract |
| --- | --- |
| `tasks` | At most 200 tasks, including completed history |
| `currentTaskId` | The sole active task's ID, or `null` when there is no active task |
| `onBreak` | Boolean; true only while a current task exists |
| `parking` | At most 200 parked thoughts |

Each task has `id`, `title`, `state` (`queued`, `active`, or `done`), `steps`, `createdAt`, nullable `completedAt`, and `restartNote`. There are at most 50 steps per task, each with `id`, `text`, and a boolean `done`. Titles, step text, and restart notes are limited to 160 characters. Each parked thought has `id`, `text` up to 300 characters, and `createdAt`. IDs must be unique across tasks, steps, and parked thoughts. Timestamps are numeric epoch milliseconds.

The first added task becomes current; additional tasks are queued. Making a queued task current puts the previous active task aside. Taking a pause retains the current task and checkpoint without starting a countdown. Completing a task does not check off its remaining steps or automatically select another task. Reopening a completed task makes it current if no task is active; otherwise it returns to the queue. The interface displays the latest eight completed tasks while retaining up to the overall 200-task limit. At capacity, remove a task before adding one; history is not silently discarded.

The exported workbench excludes the remember setting. Import validates task state, IDs, timestamps, text limits, and checkoff types. It does not turn on browser persistence; if the user already enabled remembering, the imported board follows that existing preference. Workbench export/import does not carry raw Muse data, Health data, or bio-reactive settings inside the task object.

Markers still locate the recording's current cursor via `timestamp`. New markers also preserve `created_at` as the actual wall-clock creation time and `mode` as `rest` or `work`. A practice timer does not automatically insert recording markers. This distinction matters when inspecting historical or synthetic data: marking a distraction now does not imply it happened at that historical recording time.

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

The app sends no task information, recordings, or raw signals to a server. Without prior consent, information is held only in page memory. **Remember tasks on this device** starts off in a fresh browser; enabling it writes the serialized task workbench only under local-storage key `autonomic_workbench_v1`. A valid saved task copy restores on the next visit with remembering enabled. Turning the checkbox off removes that saved copy and retains the current in-memory task board. Storage failures are reported; if the browser cannot remove a saved copy, the interface says to clear site data. Raw Muse streams, Health context, imported samples, practice ratings, and timed-practice recaps are not automatically persisted. Browser storage can be unavailable or cleared; explicit JSON export remains a separate way to keep a workspace.

Export preserves provenance, sample timestamps, null values, quality flags, markers, wearable context, the workbench, and practice workspace information. It does not include the raw Muse preview or bio-reactive animation settings. Task text, parked distractions, intentions, ratings, and recaps can contain personal information; review exports before sharing.

The synthetic session and playback controls allow reproducible review of the interface. JSON export includes the complete loaded recording, not just the portion already played. Passing software tests verifies the tested software behavior; it cannot establish clinical accuracy or validate a physiological interpretation.

## Sources and claim boundaries

- [Billman GE (2013). The LF/HF ratio does not accurately measure cardiac sympathovagal balance.](https://pmc.ncbi.nlm.nih.gov/articles/PMC3576706/) Supports caution about interpreting LF/HF; this release omits that ratio.
- [Laborde S, Mosley E, Thayer JF (2017). Heart rate variability and cardiac vagal tone in psychophysiological research.](https://pmc.ncbi.nlm.nih.gov/articles/PMC5316555/) Supports careful HRV measurement, study design, analysis, and reporting. HRV interpretation depends on recording methods and context.
- [Apple HealthKit documentation: heartRateVariabilitySDNN.](https://developer.apple.com/documentation/healthkit/hkquantitytypeidentifier/heartratevariabilitysdnn) Defines Apple's SDNN quantity; it does not define RMSSD.
- [NIMH (2024): ADHD—What You Need to Know.](https://www.nimh.nih.gov/sites/default/files/documents/health/publications/adhd-2024.pdf) General context for smaller task steps, written reminders, and short breaks. This is a design rationale, not validation of the app, EEG feedback, or a treatment claim.

These references provide context only. They do not support or validate the custom composite, its weights, thresholds, novelty metric, event detector, or any clinical use.
