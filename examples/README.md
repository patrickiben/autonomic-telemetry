# Synthetic examples

Both examples contain invented values. Neither includes personal or clinical data.

- **[demo-session.json](demo-session.json)** contains the complete 480-sample, eight-minute synthetic recording used by the console. Its provenance explicitly declares `synthetic`. Import it to explore reference formation, a directional shift, easing, and a motion-excluded interval. Imported sessions open paused at their first sample; play or scrub forward to inspect later moments.
- **[session-template.csv](session-template.csv)** contains six synthetic rows showing the supported CSV columns and timestamp format. Their quality is intentionally `unknown`, so they are excluded from the model. Six rows cannot form a reference even if labeled good: the reference requires at least 60 eligible rows spanning 119 seconds. CSV has no provenance envelope, so an imported CSV is labeled user-supplied; this README identifies the template's invented origin.

Replace example values only with appropriately obtained, already-computed summaries. A `good` quality label should describe your source's assessment, not be added merely to make a score appear. Do not rename SDNN as RMSSD or turn daily summaries into a fabricated 1 Hz series.

Use the [Methods](../docs/METHODS.md) for the input contract, supported ranges, quality gate, fixed reference, and exact calculations. Keep personal recordings outside this directory before publishing the repository.
