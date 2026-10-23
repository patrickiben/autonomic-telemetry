# Release verification

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
