# Refinement review

This repository is a refined, standalone version of the original Autonomic Telemetry console and field guide. The original files remain separate. The release scope is an offline exploration tool with deterministic examples and explicit file imports.

## Changes that matter

| Original prototype issue | Refined behavior |
| --- | --- |
| The device workflow centered on a Muse headband and Apple Watch, while the primary current wearable is Hume Band 2.0. | Hume comes first in the context workflow, with dated manual notes and explicit unknown/RMSSD/SDNN definitions. Apple Health source filtering retains support for Hume-shared records and Apple Watch users. No unverified Hume export or live API is assumed. |
| Live Muse Web Bluetooth decoding and OSC bridge paths were presented alongside the demo despite incomplete acquisition and validation. | Retired unsupported device paths. The supported inputs are normalized JSON/CSV sessions and Apple Health XML context. |
| Demo values and parts of the portrait used unseeded randomness. | A deterministic synthetic session, timestamp-based playback, restart, moment presets, and scrubbing make demonstrations reproducible. |
| Calibration and saved-baseline paths could make a session's reference provenance hard to assess. | Fixed session reference, visible source labels, and no persistent baseline or automatic browser storage. |
| Apple Health SDNN and sparse retrospective records were described as a live-model reference. | Apple Health is context only. SDNN is not substituted for RMSSD and cannot seed calibration. Latest records are selected by timestamp and checked for units and age. |
| A claimed SDNN component was derived from the RMSSD standardized value, double-counting a related input. | Three explicit score channels only: HR, RMSSD, respiratory rate. EEG and model novelty do not enter the index. |
| The score mixed physiological proxies and complex model quantities, with confident tier names. | Transparent weighted standardized shifts with visible contributions, fixed channel membership, and descriptive tier names. Cutoffs are labeled heuristic. |
| “One-step NLL” and “nats” suggested a probabilistic interpretation that the display did not adequately justify. | A dimensionless first-difference novelty statistic with a stated construction and no likelihood or information-unit claim. |
| Artifact attribution named events as physiological, blink/jaw, motion, or postural without a validated classifier. | Clean-data gates suppress model output. Coincident change events carry no causal or artifact attribution. |
| “Rigidity,” “critical slowing,” causal-looking lead–lag, RSA, and approximate spectral panels invited interpretations stronger than the available summaries supported. | Simple descriptive association, persistence, dispersion, and an explicit two-axis state portrait. Unsupported physiological and predictive labels are removed. |
| The guide's pacer and simulated RSA display could imply measured biofeedback. | The pacer is an independent visual guide and never changes recording scores. |
| Empty or unavailable measurements could be obscured in presentation and export. | Missing values remain `null`; unknown quality is distinct from good quality; mismatched channel sets are not silently reweighted. |
| Import and publication expectations were embedded in a long prototype. | Versioned input schema, synthetic examples, field guide, explicit methods, development checks, and a manual static-site publishing path. |

## What remains experimental

The pattern-shift index and event detector are unvalidated heuristics. Their weights, standard-deviation floors, tiers, novelty threshold, and refractory period are implementation choices. They do not estimate the probability of a condition, detect sympathetic activity, or assign a health grade. Software verification does not provide physiological validation.

User-supplied summaries and quality flags are accepted as labeled inputs. The app cannot verify sensor accuracy, raw-signal preprocessing, recording conditions, or whether the selected reference represents rest. Motion-free samples can still contain artifacts. A missing motion channel is not proof of stillness.

The repository intentionally excludes live acquisition, raw-signal HRV analysis, LF/HF, EEG interpretation, sleep staging, causal claims, persistent personal baselines, and clinical decision support. Adding any of these requires a new methods review and appropriate data validation.

## Review before public release

- Inspect the actual repository contents and Git staging area for personal recordings, Health exports, identifiers, or sensitive marker text. Filename exclusions cannot guarantee privacy.
- Run the documented automated checks and review the console and field guide on desktop and mobile.
- Choose a license before describing the code as open source or permitting reuse.
- Treat GitHub repository creation and Pages deployment as explicit publishing actions. The prepared local directory does not imply either has occurred.

See [Methods](METHODS.md) for exact definitions, input requirements, and source boundaries. See the [README](../README.md) for local use and publishing steps.
