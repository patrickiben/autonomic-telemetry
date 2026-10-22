# Preserved experimental research engine

The Signal Lab keeps the revised pattern-shift analysis and adds independent mathematical tools from the original prototype. These tools do not change the core pattern score, its change-rate novelty, or its HR–RMSSD portrait. Their outputs describe supplied recordings; none is a stress, focus, calm, sympathetic-activity, or clinical measurement.

The implementation is `research-math.js`, a dependency-free pure JavaScript module. It does not contact devices, make network requests, retain browser data, or replace missing observations. The original private files were inspected for capabilities; their defective physiological shortcuts were not copied into this module.

## What is restored

| Capability                                      | Current implementation                                        | Important boundary                                                                      |
| ----------------------------------------------- | ------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Online prediction error                         | Prior-observation AR(1) fit and EWMA residual variance        | Current/future samples never enter their own prediction                                 |
| Multivariate distance                           | Standardized reference covariance with identity shrinkage     | A reference is supplied data, not an established resting physiology                     |
| Coupling / absorption                           | Largest eigenvalue share of a correlation matrix              | Shared variation does not establish a shared cause                                      |
| PCA trajectory                                  | Deterministic eigendecomposition and standardized coordinates | This is additional to the core two-channel portrait                                     |
| Sample entropy                                  | Explicit embedding, tolerance, and match counts               | Undefined estimates stay unavailable; constant input returns zero                       |
| Signed cross-lags                               | Overlap-specific correlations with both signs retained        | Positive lag means the first channel precedes the second; no causality                  |
| RR statistics                                   | RMSSD, pNN50, sample SDNN, SD1, SD2                           | Requires independently supplied intervals; no PPG peak guessing                         |
| Descriptive episodes                            | Threshold onset, peak, elapsed return time, censoring         | A numerical return time is not physiological recovery                                   |
| Saved reference                                 | Validated JSON export/import                                  | Explicit file transfer; no automatic personal-baseline storage                          |
| Mind Monitor CSV                                | Parsed supplied bands and motion, explicit scale/timezone     | No fabricated heart rate, RR, respiration, or contact                                   |
| Health Auto Export JSON                         | Source/date/unit-preserving context records                   | Never inserted into session features or relabeled as RMSSD                              |
| RR spectrum / LF–HF / respiratory concentration | Explicit unavailable interface with its requirements          | The prototype's unvalidated spectral estimates are not presented as usable measurements |

The old OSC network adapter is not restored by this numerical module. The current Mac bridge supplies supported raw Muse streams, Hume-reported heart rate, and separately gated live features. Restoring additional OSC routes requires separate transport validation. This research module does not assign arousal tiers or causal spike attribution and does not fabricate missing physiological channels. The canvas's separate [live inferred-arousal estimate](METHODS.md) is not an output of these research lenses.

## Eligibility and windows

`evaluate(samples, options)` accepts 2–20,000 rows with strictly increasing epoch-millisecond `timestamp` values. Supported channels are `heart_rate_bpm`, `rmssd_ms`, `resp_rate_brpm`, `eeg_beta_alpha`, and `motion_g`. Numeric strings are not silently converted by the evaluator.

Rows need `quality: "good"`. If motion is supplied, it must be finite and between 0 and 0.25 g. Explicitly absent motion (`null` or omitted) does not independently invalidate an otherwise positively quality-labeled row. Invalid motion, unknown/poor quality, missing channels, and gaps over 10 seconds break the applicable window. Channel limits mirror the normalized recording contract: HR 25–240 bpm, RMSSD 0–500 ms, breathing 3–60/min, supplied beta/alpha 0–100, motion 0–16 g before the stricter eligibility cutoff.

The first 60 consecutive eligible rows with the same available channels form the default research reference. The count is configurable from 20 to 1,000; this research reference uses a declared sample-count criterion rather than the core model's separate duration criterion. A caller can instead pass an explicitly imported reference. No current value is compared against channels absent from that reference.

Current covariance, PCA and lag calculations use up to 120 consecutive eligible rows ending at the inspected sample; entropy uses up to 90. Nothing bridges a missing window through forward filling. A later appended observation cannot change earlier AR prediction errors. The UI should evaluate only the prefix through its inspection cursor.

## Numerical definitions

### AR(1) and EWMA

For each channel, at least 12 prior observations fit an intercept and one autoregressive coefficient using ordinary least squares over at most 60 prior observations. The coefficient is bounded to −0.98…0.98 as a declared stability heuristic. This is a model of successive observations, not a continuous-time dynamical model.

The next value is predicted **before** adding that observation to the training history. Residual variance starts from the past fit's residual mean square, with a numerical floor of `1e-8`, and then updates with EWMA coefficient 0.04 **after** the standardized residual is recorded. Missingness or gaps over 10 seconds reset training.

The reported per-channel quantity is half the squared standardized prediction residual. The aggregate is its mean across available channels, with those channels listed. It is not full Gaussian negative log-likelihood, a calibrated probability, or the core model's change-rate novelty. Cold-start variance and short-window fitting can produce large residuals; no physiological interpretation is attached.

### Reference distance and eigenstructure

Reference means and sample standard deviations standardize each nonconstant channel. The sample correlation matrix is regularized as `0.8 R + 0.2 I` by default. Mahalanobis distance is the square root of the standardized quadratic form under that matrix's inverse. The public distance function enforces shrinkage of at least `1e-6` and refuses nonpositive or nonfinite numerical results. Fixed shrinkage is explicit; it is not a fitted Ledoit–Wolf estimator. Standardization makes changing a channel's positive unit scale immaterial.

PCA uses the current complete window's standardized sample covariance. A deterministic Jacobi solver returns orthonormal eigenvectors sorted by descending eigenvalue; signs are fixed by their largest-magnitude loading. Constant channels are excluded. The leading eigenvalue divided by the sum is the absorption ratio. One nonconstant channel yields a one-dimensional trajectory with zero second coordinate, while a coupling statistic requires at least two nonconstant channels. Repeated eigenvalues can still make individual axes scientifically non-identifiable; the subspace matters more than its orientation.

### Entropy and lags

Sample entropy defaults to embedding dimension 2 and tolerance `0.2 × sample SD`, with at least 20 samples. It compares identical populations of length-m and length-(m+1) templates and excludes self-matches. Both match counts are returned. No initial matches or no extended matches produce an unavailable result with a reason, rather than a made-up finite value. Constant input has matching templates and entropy zero.

Cross-lag search defaults to ±8 samples and requires at least 20 overlapping pairs at a candidate lag. Each lag computes its own overlap-specific Pearson correlation. Selection uses the largest absolute correlation; ties favor smaller absolute lag. The correlation's sign is retained. In `crossLag(a, b)`, a positive lag means `a[t]` aligns with `b[t + lag]`. The evaluator only supplies lag seconds when cadence is uniform within 1% or 1 ms, whichever is larger. No significance test corrects for searching multiple lags; do not interpret the selected peak as an inferential result.

### RR inputs and episodes

`rrMetrics` requires at least 20 explicit intervals in milliseconds. Its declared supported range is 250–2,500 ms; out-of-range intervals reject the calculation rather than disappearing silently. It reports duration, mean interval, inverse-mean-interval rate, RMSSD, percentage of successive absolute differences greater than 50 ms, and sample SDNN. SD1 and SD2 are square roots of half the sample variances of paired differences and paired sums, respectively. This finite-pair definition avoids substituting an asymptotic SD2 identity that can fail on short records. There is no artifact correction or clinical interpretation.

`rrSpectrum` reports unavailable. Validated interval timestamps, artifact handling, interpolation, minimum duration, windowing, and spectral normalization are prerequisites for a defensible spectral implementation. Hume's reported rate and Muse's raw optical counts are not RR intervals.

Episode summaries detect excursions above a declared mathematical threshold (default 3), track their peak, and report elapsed time until the series returns below a lower threshold (default 1). Missing observations or timestamp gaps censor the episode. The default refractory interval is 20 seconds. These are numerical episodes, without causal attribution or physiological recovery claims.

## Input adapters and provenance

### Mind Monitor

`mindMonitorCSV(text, {bandScale, timezoneOffset})` and `mindMonitorRows(rows, options)` require the caller to declare `bandScale: "bel"` or `"linear"`. A Bel declaration means base-10 logarithmic power: convert with `10 ** value`, average linear powers across supplied electrodes, then form beta/alpha. The frontal alpha log ratio uses AF8/AF7 in linear power and therefore does not apply a second logarithm to already logarithmic values. This quantity is descriptive; it carries no emotional or attention label.

The adapter accepts `TimeStamp`, `Alpha_*`, `Beta_*`, `Accelerometer_X/Y/Z`, `HeadBandOn`, and `HSI_*` columns. CSV quoting is supported. Duplicate/non-increasing timestamps must be resolved explicitly upstream; no automatic resampling is hidden. Local timestamps need a declared UTC offset, such as `-04:00`; timezone/DST changes must be handled before import. No scale is inferred from plausible-looking values. Missing bands remain missing. Only explicitly supplied good fit flags can produce `quality: "good"`; raw device notifications alone do not establish fit.

The [developer's app listing](https://apps.apple.com/us/app/mind-monitor/id988527143) documents CSV recording and OSC support. The official technical-manual endpoint could not be fetched during this implementation, so parser compatibility is deliberately constrained to explicit headers and declared conventions, not asserted for every current app export.

### Health Auto Export

`healthAutoExport` accepts the documented `metrics` collection, including the common `qty` records and the heart-rate `Avg` format. It preserves units, dates, and source where supplied. Ambiguous timestamps without timezone are rejected. Generic `heart_rate_variability` remains unspecified HRV; it is not changed to RMSSD or SDNN. This matches the separation between session recordings and contextual exports. See the [official JSON metric format](https://help.healthyapps.dev/en/health-auto-export/export-format/health-metrics/) (checked October 22, 2026).

## API and integration

```js
const research = TelemetryResearch.evaluate(samplesThroughCursor, {
  referenceCount: 60,
  maxLag: 8,
  // reference: importedReference,
  // rrIntervals: independentlySuppliedRRMilliseconds,
});

research.surprise.latest; // { timestamp, value, channels } or null
research.turbulence; // { available, distance, ... } or reason
research.coupling; // absorptionRatio, eigenvalues, correlation
research.entropy; // value, m, r, matchesM, matchesM1, key
research.crosslags; // from, to, lagSamples, lagSeconds, correlation
research.manifold; // coordinates, timestamps, keys, explainedVariance
research.events; // timestamp, peak, recoveryMs, censored
research.rr; // unavailable unless intervals were supplied
research.spectrum; // explicitly unavailable pending validation

const saved = TelemetryResearch.exportReference(research.reference);
const restored = TelemetryResearch.importReference(saved.json);
```

Each mathematical component supplies `available` and, when unavailable, `reason`. Render those reasons; do not coerce missing values to zero. No method saves files automatically. Node can load the same module using `import '../research-math.js'`, then access `globalThis.TelemetryResearch`.

## Validation

Run `node scripts/research-math.test.mjs`. Fixtures cover analytic covariance/eigenvalues, matrix reconstruction, exact rank-one PCA, positive-unit invariance, singular reference regularization, forecast-target independence, historical future-append invariance, gaps/missingness, constant/no-match entropy, known positive and negative lag relationships, analytic interval statistics, finite-pair Poincaré geometry, episode censoring, malformed inputs, context separation, and declared logarithmic power conversion. These validate numerical behavior, not clinical utility or wearable measurement accuracy.
