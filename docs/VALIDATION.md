# Release verification — 2026-10-22

The v2.0.0 release passes **26 automated Chromium browser checks** with no page errors or external network requests. Run `npm ci`, `npx playwright install chromium`, and `npm test` to repeat the suite.

Checks cover deterministic synthetic provenance; elapsed-time reference formation; exclusion of poor, unknown, and high-motion samples; missing and changing channels; directional score interpretation; novelty event coincidence; input timestamps and quoted CSV; local file-picker cancellation and malformed imports; text injection; export/reimport; Apple Health units, dates, source separation and standard XML declarations; Hume daily-entry definitions, export and clearing; playback timing; reduced-motion pacer controls; gaps and exclusion counts; offline operation; guide links; and a 390-pixel viewport.

Both HTML files were opened directly from disk. Desktop and mobile screenshots were visually inspected. The app and field guide use only inline assets and system fonts. The Pages workflow stages the public HTML, examples, README, methods and review documents, and screenshots. It runs only when manually dispatched.

No Hume Band, Apple Watch, Muse, or other physical-device acquisition was tested or is claimed as a live integration. Browser checks establish software behavior in the tested browser, not physiological validity or clinical accuracy. No personal health recording was used in this release.
