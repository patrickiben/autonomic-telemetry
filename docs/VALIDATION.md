# Release verification

## Version 2.4.0: integrated multivariate restoration — October 23, 2026

The main page and Signal Lab now run the shared `multivariate-1` model. The original nominal weighted features, covariance term, bounded temporal modifiers, and causal-surprise onset detector are integrated into the live calculation. Actual pulse SDNN replaces the prototype's scaled-RMSSD proxy. The scale returns to a zero-reference origin. [Methods](METHODS.md) defines the numerical changes; [capability status](CAPABILITIES.md) identifies remaining input requirements.

All **219 automated checks** pass locally: 68 Chromium browser checks, 29 multivariate-engine checks, 33 research-math checks, 19 historical two-feature engine checks, and 70 Python bridge checks. The historical engine is retained for regression comparison and is no longer embedded in the main page.

The new model checks cover original weights and modifiers, covariance-only excursions, independent SDNN and EEG contributions, fixed full/partial profiles, missing and late channels, source changes, motion/freshness holds, causal prediction and onset convergence, plateau suppression, signed lead–lag, gap censoring, strict reference imports, and snapshot isolation. Browser checks exercise the actual main-page ingress and visual, not a duplicate score implementation.

Session checks download the main page's actual JSON and reproduce the value, history, prediction errors, weights, events, and full mathematical snapshot in Signal Lab. They cover Live → Demo → Live continuity, background live frames, future-reference and invalid-source rejection without replacing a working replay, nonfinite-motion serialization, browser observation times for delayed input, and Rest comparison resets after an unrendered signal gap. Rewinding and appending future data preserve causal-prefix results. An additional 20,000-frame replay probe remained finite and bounded.

Seventeen feature-extractor tests include actual sample SDNN from the same accepted optical intervals as RMSSD, matched quality/provenance/freshness metadata, and stale/reset behavior. No respiratory feature is fabricated. Existing transport, private-route, SSE, cancellation, and teardown tests remain in the 70-check Python suite.

Desktop and phone renders were inspected, including the live mathematical detail and integrated recording panel. Both fit 320, 390, 768, and 1440-pixel widths. The six visual-feedback checks retain image-based extent, brightness, and warmth comparisons across zero-reference, moderate, and high values in both modes, plus reduced-motion, Still, stale/held clearing, and breathing separation. Repository images use the explicitly labeled synthetic demo. No external runtime requests or browser page errors occurred.

This release was tested with deterministic software and transport fixtures. No new physical-device or iPhone test was performed, and these checks do not validate physiological accuracy. Restart an existing Mac bridge after updating to load the pulse-SDNN extractor. Saved references and session files remain explicit local downloads.

Repeat with:

```sh
npm ci
npx playwright install --only-shell chromium
npm test
python3 -m unittest discover -s bridge -p 'test_*.py' -v
```

After changing shared model/view sources, regenerate the self-contained pages with `python3 scripts/embed-arousal.py` and `python3 scripts/embed-multivariate-panel.py`. The generated copies were checked for reproducibility.

The entries below document earlier releases and their then-current models.

## Arousal visualization update — October 23, 2026

The main page now maps the available estimate to cloud extent, brightness, and warmth around a fixed reference orbit. Work uses a spiral galaxy; Rest uses a diffuse nebula and an independent optional breathing ring. The embedded inference engine is byte-for-byte unchanged from the preceding release, as are the feature extractors and device bridge.

All **173 automated checks** pass locally: 53 Chromium browser checks, 33 research-math checks, 19 arousal-engine checks, and 68 Python bridge checks. Six new browser checks exercise the actual inference and rendering paths using invented feature frames. They verify image-derived expansion, brightness, and warmth across low/reference/high values in both modes; intermediate transitions; independent waiting/stale/held animation; reduced motion; Still image and signal expiry; and separation of the breathing guide from score extent. No browser errors or external runtime requests occurred.

Desktop and 390-pixel phone previews were reviewed at synthetic estimates of 25, 50, and 75. The production demo supplies the updated repository screenshots. This checks presentation and software behavior, not physiological validity or performance on a physical iPhone.

## Signal Lab appearance update — October 23, 2026

The Lab now shares the main page's midnight palette, serif title, and rounded controls. Aqua, lavender, coral, mint, and pale gold distinguish signals and research views. The breathing guide is more compact on desktop; the analytical models, recordings, device adapters, and import/export behavior are unchanged.

All 26 Signal Lab browser checks and 5 research-interface checks pass after the update. Rendered layouts were reviewed at desktop and phone sizes, with additional overflow checks at 320, 390, 768, and 1440 pixels. The pattern-shift gauge and timeline use the same color, individual signal colors remain distinct, and print retains a white background. No browser errors or external runtime requests occurred. Updated screenshots use the built-in synthetic recording.

## Version 2.3.0 — October 22, 2026

Version 2.3.0 passes **167 automated checks**: 47 Chromium browser checks, 33 pure research-math checks, 19 personal-arousal engine checks, and 68 Python bridge checks. Repeat with:

```sh
npm ci
npx playwright install --only-shell chromium
npm test
python3 -m unittest discover -s bridge -p 'test_*.py' -v
```

The browser checks cover the immersive Work and Rest spaces, explicit ambient/demo/live labeling, source expiry, malformed and stale packet rejection, optional wall-clock timers, breathing controls, quiet/still/color settings, keyboard dialogs, 360-pixel and short-landscape layouts, and the actual HTTP/SSE relay with synthetic device fixtures. The standalone app makes no external runtime requests.

The preserved Signal Lab checks cover reference formation and quality gates, missing channels and timestamps, score and novelty definitions, import/export, injection resistance, Apple Health source/units/date handling, Hume context, playback, the independent pacer, offline operation, and guide links. Research-panel checks cover cursor-bounded analysis, reference files, supplied RR intervals, Mind Monitor and Health Auto Export adapters, stale-result invalidation after a recording change, and mobile layout.

The pure-math checks use analytic fixtures for covariance, eigenvalues, PCA, regularized Mahalanobis distance, AR prediction without target leakage, sample entropy, signed cross-lags, exact finite-pair RR statistics, quality/missingness, timestamp validity, and strict CSV parsing. An independent eigensolver review also checked 180 symmetric matrices. The research lenses remain experimental descriptors; software verification does not validate physiological interpretations.

The personal-arousal checks cover elapsed-time reference requirements, signed directional shifts, fixed references, explicit HR-only coverage, source isolation, motion rejection without smoothing leakage, invalid motion values, signal gaps, per-component freshness, and sustained-cue continuity. These verify implementation rules, not physiological validity.

Fifteen analytic/lifecycle feature checks cover known EEG power ratios, actual synthetic pulse intervals and their PRV statistics, noise/clipping, motion over the full window, timing/counter/source resets, stale support timestamps, and optical/Hume source selection. The new live derived-feature path and arousal estimate have not been validated against ECG or an independent arousal reference.

The Python checks cover Muse Classic and Athena parsing, command framing, discovery-independent transport, bounded queues, first-packet gating, staleness, cancellation, and teardown; Hume checks include checksum/type/zero handling and safe measurement renewal; server checks cover private paths, origin validation, static-file isolation, synthetic provenance, queue bounds, SSE, and serialized device control. No physical-device access is required by these automated suites.

## Physical device checks

The owner's Hume Band V2 supplied valid current heart-rate responses over Bluetooth. A 90-second run after the first valid reading received 84 valid responses, with a longest gap of approximately three seconds and no stale phase after warm-up. Renewing the same measurement-start request every 20 seconds prevented the observed approximately 30-second cutoff. Stop, unsubscribe, and disconnect completed. The band firmware version was not read; the upstream project's version is not assumed to match it.

The owner's Muse S exposes the Athena multiplexed `0013` characteristic. Its corrected adapter streamed for 40.3 seconds across all eight EEG channels, four raw optical channels, and acceleration, with no malformed packets, stale periods, or errors. Teardown completed. The older Classic protocol retains mock/fixture coverage; the standalone browser's Classic-only fallback has not been physically validated on a Classic headband.

These are bounded checks on one pair of devices, not compatibility guarantees for all units or firmware. No real sensor values were printed, saved as fixtures, or committed. Source identity, protocol acceptance, and freshness are verified separately from physiological accuracy. The local Wi-Fi bridge uses HTTP and requires a trusted private network.
