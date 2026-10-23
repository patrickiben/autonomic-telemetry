# Autonomic Telemetry

**[Open the experience](https://patrickiben.github.io/autonomic-telemetry/)** · [Field guide](https://patrickiben.github.io/autonomic-telemetry/Autonomic_Telemetry_Field_Guide.html)

An immersive canvas with a personal, experimental **inferred arousal estimate**. The restored multivariate model combines heart rate, pulse RMSSD, actual pulse SDNN, supplied respiration, EEG beta/alpha, and regularized covariance distance, with temporal modifiers and causal prediction-error event detection. Available channels form a fixed two-minute personal reference; missing inputs stay explicit. The one-sided 0–100 scale starts at zero at the reference means. It is a custom physiological-pattern model, not a direct measure of sympathetic activity or a mental-state diagnosis.

Work supports continuous observation and an optional sustained-elevation cue. Rest adds paced breathing and a personal settling trend. Both use the same estimate; their different palettes and controls do not change the scoring rules. An optional timer stays secondary to the experience.

The estimate controls the galaxy or nebula's extent, brightness, and warmth against a fixed zero-reference orbit. Work uses a slow spiral; Rest uses a diffuse cloud with a separate breathing ring.

The **[Advanced Signal Lab](Autonomic_Telemetry_Signal_Lab.html)** runs the same integrated model along its recording cursor and exactly replays main-page feature exports. It also retains the earlier three-signal comparison model, recording research lenses, import/export, and Health context. Open **Reference & signals** on the main page for the weighted calculation, prediction surprise, covariance, entropy/autocorrelation, signed lags, PCA, and onset events.

![Rest mode with explicitly labeled synthetic signals](docs/rest-mode.png)

Screenshots use the labeled synthetic demo, not recorded personal signals.

Use an explicitly labeled demonstration to explore the visuals, or connect a Muse S and Hume Band 2.0 through the local Mac bridge. Muse supplies raw EEG, optical PPG, and motion; Hume supplies device-reported heart rate. Source and freshness labels distinguish live, waiting, paused, and demonstration input.

The estimate shows source, reference progress, fixed feature coverage, and contributions. A typical eligible Muse/Hume profile covers 85/100 original nominal weight points; the current bridge supplies no respiratory estimate. HR-only use is explicitly limited. New channels require a new reference; losing a required channel holds the score. The [capability matrix](docs/CAPABILITIES.md) identifies what is live, replayable, or still unavailable. Device support is experimental. Bounded physical transport tests passed with one Athena Muse S and one Hume Band V2; those tests establish transport behavior, not the accuracy of this inference. See the [device guide](docs/DEVICES.md).

Apple Watch information is retained in the [device guide](docs/DEVICES.md#apple-watch-keep-it-as-separate-health-context); the current canvas does not supply a live Watch feed or Health XML import.

![Work mode](docs/work-mode.png)

## Live on an iPhone

A nearby Mac handles Bluetooth. Safari on your iPhone receives the visuals over the same trusted Wi-Fi:

1. Download or clone this repository onto the Mac and install Python 3.10 or newer.
2. Open [Start-iPhone-Bridge.command](scripts/Start-iPhone-Bridge.command) in Terminal. Its first run installs the pinned bridge dependencies.
3. Keep the Mac awake. In its Connect sheet, scan the phone QR code with your iPhone camera and open the link in Safari. The private address printed in Terminal is a fallback.
4. Choose **Connect**, scan, select the actual wearables, and connect. If a vendor app holds a device, disconnect it there when you are ready to switch.

[The bridge guide](docs/BRIDGE.md) covers setup, permissions, source limits, and troubleshooting. The local connection uses **unencrypted HTTP**; use a trusted private Wi-Fi network, keep the private address private, and do not expose the port to the internet. The public GitHub Pages site cannot run the Bluetooth bridge.

## Open locally

[Autonomic_Telemetry_Console.html](Autonomic_Telemetry_Console.html) is a self-contained page with inline assets and system fonts. Open it directly, or serve the directory:

```sh
python3 -m http.server 8090
```

Then open [localhost:8090](http://localhost:8090/Autonomic_Telemetry_Console.html). Serving static files alone does not start the Bluetooth bridge; use the launcher for the iPhone connection.

## How it works

- [Field Guide](Autonomic_Telemetry_Field_Guide.html): a short tour of the experience.
- [Devices](docs/DEVICES.md): Muse and Hume input boundaries.
- [Visual mappings](docs/BIOREACTIVITY.md): what drives the canvas and what the labels mean.
- [Methods](docs/METHODS.md): the shared multivariate formula, personal reference, event detection, and transport.
- [Capability status](docs/CAPABILITIES.md): the original architecture, restored behavior, and remaining input requirements.
- [Advanced Signal Lab methods](docs/SIGNAL_LAB_METHODS.md): recording schema, fixed reference, index, novelty, and context.
- [Research engine methods](docs/RESEARCH_ENGINE.md): the additional audited mathematical lenses and their input requirements.
- [Bridge](docs/BRIDGE.md): the runnable Mac-to-iPhone route.
- [Review](docs/REVIEW.md) and [validation](docs/VALIDATION.md): release scope and verification.

![Integrated multivariate analysis with synthetic recording](docs/multivariate-analysis.png)

Raw signals are handled in memory. **Export this analysis session** and **Save reference / Open reference** provide explicit local files; no automatic browser or cloud saving occurs. The bridge does not need an account, cloud relay, Health uploads, or a recording database. Demonstration input is labeled and is not a substitute for missing live data. Restart an existing bridge process after updating to load the added pulse-SDNN extractor.

## Development

The checked-in pages open without a build. After changing the shared model or analysis view, refresh their inline copies with `python3 scripts/embed-arousal.py` and `python3 scripts/embed-multivariate-panel.py`. Browser checks use Node.js and Playwright:

```sh
npm ci
npx playwright install chromium
npm test
```

The local bridge uses Python with pinned [Bleak](https://pypi.org/project/bleak/3.0.2/) and [qrcode](https://pypi.org/project/qrcode/8.2/) dependencies:

```sh
python3 -m venv .venv-bridge
.venv-bridge/bin/python -m pip install -r bridge/requirements.txt
.venv-bridge/bin/python -m bridge.server --simulate --open
```

`--simulate` tests the local transport with explicitly synthetic input. It does not read Bluetooth or establish hardware compatibility. See [bridge development notes](bridge/README.md).

## GitHub Pages

The public experience is hosted at [patrickiben.github.io/autonomic-telemetry](https://patrickiben.github.io/autonomic-telemetry/). To publish reviewed changes after pushing, use **Actions → Deploy GitHub Pages (manual) → Run workflow**. For a fork, enable **Settings → Pages → GitHub Actions** first. The Python bridge runs on your Mac, not on Pages.

## Reuse

Original project code is available under the [MIT License](LICENSE). Protocol adapters preserve applicable upstream notices.

## Code license and third-party material

Original project code is licensed under [MIT](LICENSE), copyright 2026 Patrick Iben.
Third-party code, fonts, data, model assets and outputs retain their respective licenses and terms;
they are not relicensed by this file.
