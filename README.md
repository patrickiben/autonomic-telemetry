# Autonomic Telemetry

**[Open the live app](https://patrickiben.github.io/autonomic-telemetry/)** · [Field guide](https://patrickiben.github.io/autonomic-telemetry/Autonomic_Telemetry_Field_Guide.html)

A private-by-default browser workspace for rest and meditation, everyday work and learning, and optional exploration of wearable signals. Choose a quiet pause or keep one current task, its next small steps, and a place to park distractions in view. A companion field guide explains the tools, visuals, and their limits.

**This is an experimental visualization, not a validated measure of stress, sympathetic activity, illness, or recovery.** The custom index and event thresholds are design choices. They have no clinical validation or confidence intervals.

![Rest and meditation mode](docs/rest-mode.png)

## Start here

Open [Autonomic_Telemetry_Console.html](Autonomic_Telemetry_Console.html) directly in a current browser. The app is a self-contained HTML file with no runtime dependencies, external fonts, analytics, account, or server requirement. Its default session is explicitly labeled **synthetic**.

For a local web address:

```sh
python3 -m http.server 8090
```

Visit [localhost:8090](http://localhost:8090/Autonomic_Telemetry_Console.html). Read the [Field Guide](Autonomic_Telemetry_Field_Guide.html) for a tour or [Methods](docs/METHODS.md) for the exact calculations and data contract.

## Two spaces for different intentions

| | Rest & meditation | Work & learning |
| --- | --- | --- |
| Starting view | Quiet pause, optional breathing guide | Untimed task companion |
| Main tools | 10-minute practice, intention, optional ease check-in | One current task, small step checkoffs, queue, and distraction parking |
| Returning to it | Pause or finish whenever you choose | Break/resume and a checkpoint note for where to restart |
| Optional timer | 5, 10, or 20 minutes, or a custom duration | Closed by default; 25, 45, or 60 minutes, or a custom duration |

Rest & meditation is the default. Work & learning starts without a countdown: name one current task, make the next action small, and check off steps as you go. Put other work in the queue and stray thoughts in distraction parking. Before a break, leave a checkpoint so returning does not require reconstructing everything. Complete the task when you decide it is done; the completed history records your action, not a sensor's judgment.

This is self-directed organization, with small starts and easy returns that can suit ADHD-friendly workflows. It does not treat ADHD or determine focus, learning, or productivity from EEG. You can work without starting a timer, connecting a wearable, or chasing a physiological score.

Rest uses deep evergreen, sage, and warm neutrals; Work uses midnight blue, indigo, periwinkle, and cool accents. Each theme is consistent across backgrounds, panels, controls, dialogs, and timers. Themes change presentation; the physiological calculations are identical.

Timers remain available for rest or an optional focus block, with custom durations of 1–180 whole minutes. They follow actual elapsed time independently of the recording's playback speed and scrubber. Optional ease or focus ratings and short reflections are self-reported. Switching modes pauses a running practice and the pacer while retaining the recording, model, wearable context, and notes. It does not recalibrate or change the score.

**Export JSON** preserves the workbench, practice drafts, recaps, active mode, and signal-detail preferences with the recording. Reopened running timers restore as paused. **Remember tasks on this device** is optional and off by default; it saves only task-board and parking information locally, not raw sensor or Health data. See privacy details below.

To keep the visuals beside your work, choose **Connect a device → Muse S → Choose & connect Muse S** in a supported browser, then leave the visual source set to **Muse S**. Without fresh packets it waits quietly; synthetic and ambient visuals require your explicit choice. Work on the task board as you normally would. The progress trail responds to your step and task checkoffs, while the raw-signal visual remains a separate view.

Signal-analysis details start closed in both modes. Open **Show signal details** when you want to explore the recording. On a phone, tap the left side of the task bar to return to your current task.

![Work and learning mode](docs/work-mode.png)

## What you can explore

- A deterministic 1 Hz, eight-minute synthetic session, with a preloaded two-minute reference, accelerated playback, play/pause, restart, a timeline scrubber, and presets that jump to key moments.
- A transparent 0–100 **pattern-shift index** based on heart rate, RMSSD, and respiratory rate, with channel contributions visible.
- A descriptive novelty trace and coincident change events, with explicit quality and motion gating.
- Aligned heart-rate/respiratory-rate association, heart-rate persistence, RMSSD dispersion, and a standardized heart-rate/RMSSD portrait.
- A visual breathing pacer and separate wall-time practice timers that operate independently of the recording and its scores.
- A bio-reactive visual companion: an organic EEG signal bloom, signal tide, raw PPG ribbon, or motion field. Live Muse, demonstration, ambient, and stale input are labeled explicitly. Demonstration uses generated data and ambient is decorative. None is an attention or productivity score. See [Bio-reactive visuals](docs/BIOREACTIVITY.md).
- Normalized JSON/CSV import, user markers, and JSON export that preserves source labels and missing values.
- Hume Band 2.0 daily context notes, with an explicit HRV definition selector and date.
- Retrospective context from Apple Health `export.xml`, kept separate from the session reference and model.

Choose **Connect a device** for the guided setup, starting with Hume Band 2.0 and also offering Apple Watch and Muse S. **Muse S has an experimental raw Bluetooth preview**, with hardware behavior still unverified. It shows raw EEG, PPG, motion, packet freshness, and battery where available; it does not produce heart rate, RMSSD, breathing estimates, or a pattern-shift score. The session recording remains the labeled demo or imported data, and raw preview packets are not included in exports. Hume Band 2.0 and Apple Watch use the context workflows below. See [Device setup](docs/DEVICES.md) for the supported paths and browser limits.

Both practice modes use responsive layouts for phones, tablets, and desktops. The experimental Muse preview requires supported desktop Chromium or Chrome on Android and HTTPS or localhost; it is unavailable in iPhone/iPad browsers and Firefox. The practice, file, and context workflows do not require Bluetooth.

A phone layout keeps the current task and its **Step done**, **Return**, or **Task done** action within reach in a fixed bottom bar. The Work timer bar appears only when the optional timer is open. Touch controls are at least 44 pixels high, and mobile entry fields use readable text sizes to avoid automatic input zoom. Both modes and the device guide fit narrow screens.

## Hume Band 2.0 first; Apple Watch also welcome

For Hume Band 2.0, choose **Add Hume reading** to note the date, resting heart rate, HRV, and respiratory rate available in your Hume app. Choose the HRV definition explicitly: **Unspecified / not confirmed**, **RMSSD**, or **SDNN**. Leave it unspecified unless the source identifies the calculation. The reading is labeled Hume Band 2.0, stays in memory, and is included in your export. Daily summaries do not become a second-by-second recording or a calibration reference. Adding another context reading or Health XML replaces the current context; this release is not a daily history tracker.

Hume's [FAQ](https://humehealth.com/en-gb/pages/faq) describes Connected Apps sharing to Apple Health/Google Fit, with incomplete metric coverage, and lists native export as “Coming Soon” (checked 2026-10-22). This release therefore assumes no Hume CSV, public API, or direct Bluetooth interface. If your shared metrics appear in Apple Health, import its XML and select the relevant source. Google Fit import is not supported.

Apple Watch users can use that same XML route, selecting their Watch source. HealthKit HRV is SDNN, which stays distinct from RMSSD. Shared views remain device neutral; the available data and its provenance determine what can be shown.

## Bring a recording

Use [examples/session-template.csv](examples/session-template.csv) for a small format example, or [examples/demo-session.json](examples/demo-session.json) for a complete synthetic session. Imports contain already-computed summaries; the console does not derive HRV from raw ECG, PPG, or RR intervals.

The JSON contract is:

```json
{
  "schema_version": 2,
  "provenance": { "kind": "user-supplied", "label": "My session" },
  "samples": [
    {
      "timestamp": "2026-10-22T10:00:00-04:00",
      "heart_rate_bpm": 62,
      "rmssd_ms": 48,
      "resp_rate_brpm": 12,
      "eeg_beta_alpha": null,
      "motion_g": 0.03,
      "quality": "good"
    }
  ],
  "markers": []
}
```

The single row illustrates the schema; a reference needs at least **60 eligible samples spanning 119 seconds**. CSV uses the same sample field names as headers. Use ISO 8601 timestamps with seconds and an explicit timezone, numeric Unix epoch **milliseconds** in JSON, or 13-digit epoch milliseconds in CSV. Rows must already be ordered at least one second apart; aggregate denser data before importing. The session limit is 20,000 samples and 20 MB. Empty numeric cells become `null`; absent information is never changed to zero. CSV defaults to **user-supplied**; JSON must explicitly declare provenance. Neither is presented as a verified measurement.

Only samples marked `quality: "good"` enter the model. `poor` and `unknown` are excluded. If `motion_g` is supplied, it must be at most 0.25 to pass the motion gate. Here `motion_g` means motion magnitude after gravity removal; raw accelerometer magnitude near 1 g is not the expected input. A missing motion value does not establish stillness.

At least two of heart rate, RMSSD, and respiratory rate must be present, and a scored sample must have the same available-channel set as its reference. The optional EEG ratio is preserved in files and displayed as a supplied value in the advanced Temporal texture panel; it has no score weight or physiological interpretation. See [Methods](docs/METHODS.md) for reference formation, supported input ranges, gaps, thresholds, and interpretation.

For Apple Health, select the unzipped `export.xml`, then choose its source name to keep Hume and Apple Watch context separate. The importer checks supported record units, chooses the latest record **by timestamp** for each supported metric within that source, and shows its date and a stale label when older than 30 days. Apple Health SDNN stays SDNN; it is not converted to RMSSD. Sparse context records cannot seed calibration or enter the index. Sleep analysis is not supported.

## Privacy and sharing

The app sends no recordings or task information to a server. By default, information stays in the current page's memory and a reload clears it. If you enable **Remember tasks on this device**, only the task board and distraction parking are written to this browser's local storage; they return in that browser and do not sync across devices. Turning the option off removes the saved copy while keeping the current list in memory. If storage fails, the app reports it and lets you continue in memory. Raw Muse data, Health context, imported recordings, ratings, and practice recaps are not automatically saved there. Importing a JSON file does not enable saving; an existing choice to remember tasks remains in effect.

Exports are files under your control and may contain health information, task text, distractions, marker text, and personal reflections. Review them before sharing. Keep personal files outside the repository; `.gitignore` cannot recognize every sensitive filename. The included examples are synthetic.

Loading the app from GitHub Pages still involves a request to GitHub for the static page. The console does not send imported recordings to GitHub or another service.

## Development and checks

The application itself requires no build. Automated checks use Node.js and Playwright:

```sh
npm ci
npx playwright install --only-shell chromium
npm test
```

Run the tests after editing the model, importer, export, or controls. Test dependencies are for development only. [Review notes](docs/REVIEW.md) describe the main corrections made to the original prototype and the remaining scope limits.

## GitHub Pages

The public app is hosted at [patrickiben.github.io/autonomic-telemetry](https://patrickiben.github.io/autonomic-telemetry/). Open this HTTPS link on your phone or computer; choose Rest & meditation or Work & learning at the top. No account is required to use the app.

To publish an update after pushing reviewed changes, open **Actions → Deploy GitHub Pages (manual) → Run workflow**, choose `main`, and run it. The workflow stages the public HTML, synthetic examples, README, and documentation. Code pushes run browser checks but do not automatically deploy a new site.

For a fork, first enable **Settings → Pages → GitHub Actions**, then run the same deployment workflow. The site's entry point opens the console, with the field guide linked from it.

## Scientific context

- [Billman (2013): LF/HF does not accurately measure cardiac sympathovagal balance](https://pmc.ncbi.nlm.nih.gov/articles/PMC3576706/).
- [Laborde, Mosley & Thayer (2017): HRV research design, analysis, and reporting recommendations](https://pmc.ncbi.nlm.nih.gov/articles/PMC5316555/).
- [Apple HealthKit: heart rate variability SDNN](https://developer.apple.com/documentation/healthkit/hkquantitytypeidentifier/heartratevariabilitysdnn).
- [NIMH: ADHD—What You Need to Know](https://www.nimh.nih.gov/sites/default/files/documents/health/publications/adhd-2024.pdf). General context for smaller task steps, written reminders, and breaks; it does not validate this app or its EEG visuals.

These sources provide physiology and organization context. They do **not** validate this dashboard's index, tiers, novelty calculation, event detector, or effectiveness as a work tool. Only HR increases, RMSSD decreases, and respiratory-rate increases contribute to the index. A low score means little shift in those scored directions; large changes in the opposite directions can also score zero. The score does not establish closeness to the reference, a cause, or a health condition.

## Reuse

No license has been selected yet. Choose a license before inviting others to reuse or redistribute the code.
