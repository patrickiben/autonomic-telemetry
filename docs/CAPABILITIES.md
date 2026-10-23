# Original architecture: implementation status

This matrix describes executable behavior after the multivariate restoration, not just the existence of a formula in the repository.

| Original capability | Current status | Important change or input requirement |
| --- | --- | --- |
| Multivariate weighted headline | Live and exact session replay | Original nominal 20/30/15/15/10/10 terms; fixed available profile, displayed normalized weights |
| RMSSD and SDNN | Live from accepted optical intervals | SDNN is actual sample SD, replacing the original duplicate RMSSD proxy |
| Breathing contribution | Supplied-frame/recording support | Current Mac bridge does not derive respiration; no substitute value is inserted |
| EEG beta/alpha term | Live, quality-gated | Original bounded nominal 10-point term; experimental interpretation retained |
| Mahalanobis turbulence | Live and replay | Regularized physiological covariance; motion is a gate rather than a dimension |
| Autocorrelation/entropy fragility modifier | Live and replay | Undefined entropy stays unavailable; no artificial finite fallback |
| Breath-leading-HR modifier | Live when respiration is supplied | Uniform cadence required; association is not labeled causation or measured RSA |
| AR/EWMA surprise | Live and replay | Target observation cannot train its own prediction |
| Convergent onset events and return time | Live and replay | At least two directional votes, refractory interval, gap censoring; no invented causal attribution |
| Eigenvalue concentration and PCA trajectory | Live inspection and replay | Descriptive views; no extra hidden headline weight |
| Personal references | Explicit local save/open | Validated provenance/profile/source compatibility; fresh input required after import |
| Session export | Main-page feature export and exact Lab replay | Manual download; bounded in-memory recording, explicit overflow notice |
| Actual RR pNN50 / SD1 / SD2 | Recording research tool | Requires independently supplied interval series |
| LF/HF / respiratory spectral concentration | Unavailable | Requires a suitable interval-timestamp series and defensible spectral processing; the short original shortcut is not restored |
| Respiratory–cardiac amplitude/RSA claim | Unavailable as a measured physiological quantity | Lead–lag association remains available; no invented respiration or measured-RSA claim |
| Apple Watch / Hume daily context | Retained in Signal Lab | Context remains distinct from current live feature frames |
| Original OSC listener | Not restored | Mac bridge supplies supported BLE routes; Mind Monitor CSV import remains available |

Work and Rest share the multivariate model and differ in interaction: continuous monitoring with an optional sustained cue, versus breathing guidance and a within-session settling trend. No task-management features are introduced.

The historical three-signal Lab score and two-feature cardiac engine remain explicitly separate comparison implementations. The new shared multivariate engine drives the main index and visual.
