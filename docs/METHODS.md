# Live multivariate inferred-arousal methods

`multivariate-1` restores the original integrated architecture beneath the main Work/Rest visual. The same engine runs in **Signal Lab → Integrated arousal model**, automatically following the recording cursor or replaying an exported live session. It combines eligible physiological features, covariance distance, temporal modifiers, and a separate causal-surprise onset detector.

This is the original experimental model structure with explicit numerical corrections. It is not the former two-feature cardiac model, and it is not a validated measure of sympathetic activity, thoughts, stress, or health. Model weights and thresholds are engineering choices inherited or explicitly adapted from the prototype.

## Inputs and fixed coverage

| Term | Original nominal weight | Current input |
| --- | ---: | --- |
| HR increase | 20 | Hume-reported HR preferred; accepted Muse optical pulse rate when Hume is absent |
| RMSSD decrease | 30 | Muse pulse-interval RMSSD; explicitly supplied RMSSD in a recording |
| Respiratory-rate increase | 15 | Explicitly supplied respiratory signal; the current bridge leaves this unavailable |
| Multivariate turbulence | 15 | Regularized covariance distance across the fixed physiological profile |
| EEG beta/alpha increase | 10 | Quality-gated Muse spectral ratio, or an explicitly supplied ratio |
| SDNN decrease | 10 | Actual sample SD of accepted Muse pulse intervals, or explicitly supplied pulse SDNN |

Motion is a quality gate, not a covariance feature or score contribution. Correlated HR, RMSSD, SDNN, and turbulence terms are retained to preserve the proposed architecture; their weights do not represent independent physiological evidence.

Calibration gathers at least 60 accepted observations spanning **120 elapsed seconds** with an unchanged eligible channel set and no gap over five seconds. Samples are admitted no faster than twice per second. Invalid motion or a missing required HR input interrupts collection. Means and sample standard deviations form the fixed reference; scale floors are 3 bpm, 5 ms RMSSD, 1 breath/min, 0.15 EEG ratio, and 5 ms SDNN.

The available profile freezes at reference completion. Original weights are normalized **once** over that profile, including turbulence when at least two physiological channels exist. A bridge session with HR, pulse RMSSD, EEG, and pulse SDNN therefore covers 85 of the original 100 nominal weight points; respiration remains visibly absent. HR alone is an explicitly limited one-channel profile. Losing a frozen channel withholds the estimate rather than changing its weights. A newly eligible channel is listed as requiring a new reference. Changes to sources in the fixed profile reset calibration. Different profiles are different models and should not be compared as one uninterrupted scale.

## Feature extraction and quality gates

The deterministic bridge processor emits feature frames at most once per second. It holds bounded raw windows in memory. Every component carries its own validity, reason, source, and supporting raw receipt time. A later computation or phone delivery does not make an old component fresh.

**Optical PRV (RMSSD and SDNN)** uses 32 seconds of nominal 64 Hz data, requiring 2,048 contiguous samples and at least 20 detected pulse intervals. It detrends the signal, applies forward/backward second-order 0.5–5 Hz Butterworth filtering, detects prominent positive maxima, and refines peak positions by parabolic interpolation. The detector excludes the first and last second of the filtered window. It rejects clipping/dropouts, flat or tiny pulses, intervals outside approximately 333–1,500 ms, intervals more than 25% from their median, inconsistent peak amplitudes, weak periodicity, and RMSSD above 250 ms. Rejected beats are not silently repaired or interpolated into intervals.

The entire optical window needs quiet, fresh acceleration coverage. Two eligible optical channels must agree in pulse rate and RMSSD, or one eligible channel must agree in pulse rate with fresh Hume HR. A selected eligible channel remains selected instead of switching on every small quality fluctuation. These software consistency checks do not prove correct pulse detection, independence, or contact quality. Thirty-two-second PRV is a short-window experimental estimate, not a standard five-minute ECG measurement.

**EEG beta/alpha** uses four seconds of nominal 256 Hz samples with a Hann periodogram. It integrates alpha 8–12 Hz and beta 13–30 Hz, then reports the median beta/alpha ratio from at least two eligible channels among indices 0–3. Gates reject flatness, large voltage or clipping, insufficient alpha/broadband power, excessive low-frequency drift or high-frequency power, and motion. Eye and muscle artifacts can still pass. The eligible ratio now supplies the original model’s bounded 10-point nominal term. That experimental weight does not establish a mental-state measurement.

Muse components expire after 1.5 seconds without supporting raw input; Hume HR expires after five seconds. Host gaps over 1.5 seconds, known packet-counter discontinuities, or protocol changes clear the affected raw window. Athena lacks verified per-channel sample timestamps/counters: sample positions use nominal cadence with host-coverage checks. Small undetected packet losses, timing error, and wavelength/placement effects remain possible.

Motion is the RMS acceleration-vector deviation about its window mean, rather than acceleration magnitude including gravity. The derived-Muse quiet gate requires mean gravity magnitude 0.75–1.25 g, RMS deviation at most 0.05 g, and maximum deviation at most 0.2 g with sufficient continuous coverage. The live estimator additionally holds when a supplied current motion value exceeds 0.12 g; absent Muse motion does not by itself prevent a Hume HR-only track. All these limits are engineering gates, not validated physiological cutoffs. The [feature implementation](https://github.com/patrickiben/autonomic-telemetry/blob/main/bridge/features.py) defines the full numerical checks.

Pulse SDNN is the sample standard deviation (N−1 denominator) of exactly the accepted optical intervals used by pulse RMSSD. It is independently calculated, not a rescaled RMSSD. Both retain the same source, window, quality decision, and supporting receipt timestamp. Neither is renamed ECG-derived HRV. The bridge does not currently estimate respiratory rate.

## Composite calculation

For a fixed-profile physiological feature j:

```text
z_j = direction_j × (current_j − reference_mean_j) / reference_scale_j
feature_term_j = effective_weight_j × clamp(z_j, 0, 4) / 4
```

Directions are positive for HR, respiration, and beta/alpha, and negative for RMSSD and SDNN. The input RMSSD is used directly, matching the original architecture; the superseded cardiac model’s logarithmic transformation and 50-centered scale are not used.

Reference covariance is scaled by the same floored feature scales. Its off-diagonal entries retain the empirical covariance structure, with unit diagonals; `0.8 R + 0.2 I` regularizes the matrix. A deterministic symmetric eigendecomposition evaluates its inverse quadratic form:

```text
distance = sqrt(z_rawᵀ × regularized_R⁻¹ × z_raw)
turbulence_term = effective_weight_turbulence × clamp((distance − 2.5) / 6, 0, 1)
base_score = sum(feature_terms) + turbulence_term
```

Unlike the directional terms, distance can respond to an excursion in either direction. It does not by itself identify arousal or cause. Motion is excluded from this covariance calculation so that artifact intensity cannot become an arousal contribution.

The original temporal modifiers are restored:

```text
fragility = 0.6 × clamp((HR_lag1_correlation − 0.2) / 0.7, 0, 1)
          + 0.4 × clamp((1.6 − RMSSD_sample_entropy) / 1.6, 0, 1)
lead = positive breath-leading-HR correlation, bounded 0–1
multiplier = 1 + 0.05 × fragility + 0.05 × lead
raw_score = clamp(base_score × multiplier, 0, 100)
displayed_score = median(raw_scores from the last five seconds)
```

Unavailable modifiers contribute no increase and remain explicitly unavailable in inspection. HR lag-one correlation is calculated over eligible adjacent pairs. Entropy uses embedding dimension 2 and tolerance 0.2 × sample SD, with self-matches excluded; undefined match ratios remain unavailable. The lead modifier requires both channels and uniform cadence. Its lag search uses the strongest positive correlation; the separate diagnostic reports the strongest absolute signed correlation. Neither establishes causation or measured RSA.

**Zero is the reference origin**, replacing the superseded model’s 50-centered convention. At the exact reference means all terms are zero. A low value means little response under these particular terms, not proof of calmness or proximity in every physiological dimension. Display tiers use the original 25/46/68 boundaries and are labeled model responses.

Inspection shows the current weighted sum, multiplier, bounded raw result, and median-filtered display separately. Current component contributions need not sum to the smoothed number.

## Causal prediction and acute onsets

Each fixed-profile channel uses an AR(1) fit on up to 60 **prior** observations, with at least 12 observations to begin. The prediction is made before adding the target observation. Its residual is standardized against past EWMA residual variance (coefficient 0.04), with a floor based on the channel’s declared scale. The mean half-squared standardized residual across available predictors is the surprise statistic. It is not full Gaussian negative log-likelihood or a calibrated probability.

The reference surprise threshold is `max(reference_mean + 1.5 × reference_SD, reference_mean + 0.5)`. An onset additionally requires at least two of HR increase, RMSSD decrease, or respiration increase to step together: the last four observations versus the preceding sixteen, scaled by the larger of the channel floor and segment SD. A 20-second refractory period prevents repeated flags. EEG and SDNN cannot independently satisfy these two votes.

Events are labeled **observed convergence**, with contributing channels and peak surprise. Their return interval ends when the transient subsides; gaps and excluded observations censor an open event. Related cardiac channels are not independent causal confirmations. No physiological/artifact cause is invented from unavailable fit, blink, or posture inputs. Quality holds clear current score encoding and reset rolling analysis before new usable data enter it.

## Live mathematical inspection

The same accepted frames also update rolling correlation/eigenvalue concentration, standardized PCA, entropy, autocorrelation, and signed cross-lags. These diagnostics are no longer confined to a manually run recording panel. The composite uses turbulence, fragility, and the breath-leading modifier; surprise drives events. PCA and eigenvalue concentration remain descriptive views, as in the original architecture, rather than extra undocumented score weights.

Windows are bounded in memory; a snapshot reads cached calculations without retraining. Source changes restart reference formation. Missing/stale/invalid data cannot contribute to predictors, covariance history, smoothing, or cue duration. Uniform cadence is required to label lags in seconds.

## Work, Rest, and the visual

Both modes consume this same model. Work offers continuous observation and an optional cue after at least 60 valid seconds at or above 68. Rest adds an independent four-second inhale/six-second exhale guide, within-profile change since entering Rest, and a recent trend. A reference/source change or interruption resets the Rest comparison.

Higher scores make the galaxy/nebula wider, brighter, and warmer. The dotted orbit now marks the zero-reference origin. Breathing has a separate outer ring and never changes the score cloud. Raw EEG/optical variation adds only minor filament texture. Waiting, stale, or held estimates remove the score encoding and show ambient clouds. Reduced motion freezes decorative drift while allowing score changes; Still freezes fresh score images but clears them on expiry.

## Replay, references, and privacy

**Export this analysis session** downloads accepted feature frames, their browser observation times, provenance, model version, and an explicit imported-reference seed when applicable. The first 20,000 frames per live/demo recording context are held in memory; reaching that limit stops recording with a visible notice while live analysis continues. No automatic file or cloud save occurs. Signal Lab’s **Open a live analysis session** replays these frames through the identical engine at their original feature and observation timestamps, preserving delivery-age quality decisions. Its cursor cannot train on future observations. The existing normalized recording format maps supplied features into the same engine with explicit source/quality labels. The older three-signal directional score and separate recording research lenses remain available as comparison tools.

**Save reference / Open reference** provide explicit local reference files. Imports validate model version, synthetic/personal provenance, feature profile, means/scales, correlation matrix, and source labels. An imported reference never restores a live score; fresh matching-source data are required. A synthetic reference cannot seed a personal session.

The standalone main page remains self-contained and offline. The Mac bridge provides same-origin local transport for supported Muse and Hume devices; public GitHub Pages does not open a Bluetooth relay. Existing freshness, session, sequence, and source checks remain in effect. The [bridge guide](BRIDGE.md) describes trusted-Wi-Fi use. Restart an existing bridge process after installing this version to load the added pulse-SDNN extractor.

The earlier `arousal-engine.js` remains in the repository only as the historical two-feature model with its own regression tests. It is no longer embedded in the main page. See [capability status](CAPABILITIES.md) for what is live, replayable, or still unavailable.

## Primary evidence and implementation sources

- [Pieper et al.: ambulatory stressful events, worry, HR, and HRV](https://pubmed.ncbi.nlm.nih.gov/20410249/) provides primary observational context for cardiac patterns around stress-related experience. Such associations do not identify an individual's current mental state or validate this composite.
- [Singstad et al.: simultaneous finger PPG/ECG at rest, mild exercise, and mild mental stress](https://pmc.ncbi.nlm.nih.gov/articles/PMC8713388/). Detection choices and artifacts materially affect PRV estimates; this is not a validation of forehead Muse PRV.
- [Bent & Dunn: wrist optical sampling-rate experiment](https://pmc.ncbi.nlm.nih.gov/articles/PMC8057382/). RMSSD differed from ECG even at the highest tested optical sampling rate; 64 Hz alone does not establish ECG equivalence.
- [Whitham et al.: scalp EEG during paralysis](https://pubmed.ncbi.nlm.nih.gov/17574912/). Muscle contamination complicates interpretation of higher-frequency scalp EEG, requiring caution about the original model’s EEG contribution.
- [Classic Muse source](https://github.com/urish/muse-js/tree/4e864578c55dd7e26d85b429863f47ccabac54a0), [Athena Muse source](https://github.com/eugenehp/muse-rs/blob/7d6a885cfbb076ec8d50e6f44935a357c65eaf80/src/parse.rs), and [Hume interoperability source](https://github.com/brendangooden/j2208-band-tools/tree/62ce48357e25d1c68e4c3e0bfd8d2cf1bbd745e9) inform transport and decoding.

These sources support measurement boundaries and implementation context. They do not validate this custom inferred-arousal model, its thresholds, or outcomes from using it.
