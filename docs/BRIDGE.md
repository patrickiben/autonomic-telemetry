# Live signals on your iPhone, through your Mac

The Mac connects to your Muse S and Hume Band 2.0 over Bluetooth. Safari on your iPhone opens a private local copy of the visual experience and receives the signals over the same Wi-Fi. The Mac must stay awake and within Bluetooth range of the wearables.

This is an experimental connection path. Bounded physical transport tests passed on one Athena Muse S and one Hume Band V2. Classic decoding also has software checks; its direct browser path remains physically unverified here. A successful connection is not a claim of physiological accuracy or universal firmware compatibility.

## Start the bridge

1. Download or clone the complete repository onto your Mac. Install [Python 3.10 or newer](https://www.python.org/downloads/macos/) if needed.
2. Open `scripts/Start-iPhone-Bridge.command` in Terminal. The first launch creates `.venv-bridge` and installs the pinned bridge dependencies. It needs internet access for that installation.
3. Keep the Terminal window open. The bridge opens the experience on the Mac and prints a private phone address containing a fresh random path.
4. Put your iPhone on the same trusted Wi-Fi. Open Connect on the Mac and scan its phone QR code with your iPhone camera, then open the link in Safari. The printed phone address is a fallback. Use this local bridge address, rather than the GitHub Pages address, for the live connection.
5. In the experience, choose Connect, scan and choose the actual Muse or Hume device, then connect. Allow Bluetooth access for the app running Python if macOS asks.

The Mac and phone use the same app under the printed private path. Its connection sheet contains the scan and connection controls. Do not post or share your actual private path.

Keep vendor apps connected until you are ready to switch. If one holds a device, disconnect it there or close that app before using the bridge. No factory reset, history deletion, firmware update, or monitoring-settings change is part of this workflow. Continuous live measurement can increase battery use.

## What each device supplies

| Device | Live input | Limits |
| --- | --- | --- |
| Muse S | Raw EEG voltage, optical counts, acceleration, and available telemetry; separately gated pulse RMSSD, pulse SDNN, and EEG beta/alpha | PRV is optical pulse variability, not ECG HRV; no respiratory rate is inferred |
| Hume Band 2.0 | Current device-reported heart rate | No beat timestamps, RR intervals, RMSSD, or usable raw PPG are assumed |

The restored multivariate inferred-arousal estimate uses Hume HR and eligible Muse pulse RMSSD, actual pulse SDNN, and EEG beta/alpha, plus derived covariance and temporal terms. Respiration remains absent, so the typical four-channel profile covers 85/100 original nominal weight points. Available weights freeze with the two-minute reference; missing required inputs hold the estimate. Accepted Muse pulse rate can supply HR when Hume is absent; a source change rebuilds the reference. [Methods](METHODS.md) defines the formula and its experimental limitations. Restart an existing bridge after updating to load pulse SDNN. Bounded transport tests do not validate feature accuracy or the inference.

Hume's adapter uses the FFF0 vendor service and a narrow current-heart-rate command, renewed every 20 seconds. Zero replies are treated as unavailable or warming up, not zero bpm. A physical test on October 22, 2026 accepted 84 valid nonzero responses over 90 seconds from the first valid reading, with a longest gap of three seconds after roughly 12–15 seconds of initial warm-up. Stop, unsubscribe, and disconnect completed afterward. That bounded result does not promise a universal update cadence or indefinite operation. The pinned upstream project separately reports firmware `0.0.3.9`; the owner's firmware was not read. See the [pinned protocol](https://github.com/brendangooden/j2208-band-tools/blob/62ce48357e25d1c68e4c3e0bfd8d2cf1bbd745e9/PROTOCOL.md) and [device test scope](DEVICES.md).

Newer Muse S Athena uses the Mac adapter's multiplexed transport; the direct browser adapter remains Classic-only. One Athena headband completed a 40.3-second raw EEG, optical, and acceleration run with no malformed packets, stale intervals, or adapter errors, followed by clean teardown. A combined physical Muse/Hume run also passed the event-stream canvas check in a mobile-sized desktop Chromium viewport; this was not a physical iPhone performance test. See [Muse transport details and sources](DEVICES.md#muse-s).

Source and age labels distinguish arriving device data, a stale or disconnected stream, and an explicitly selected demonstration. A stale reading must not look live merely because the phone reconnected. Simulation never establishes device connectivity or hardware compatibility.

## Local connection and privacy

The bridge uses HTTP on your local network. **That connection is not encrypted.** Use a trusted private Wi-Fi network; do not expose the bridge port through your router or use it on public Wi-Fi. The random URL path limits access to people who know it, but it does not encrypt packets or protect against someone observing that network traffic. Restarting the bridge creates a new private path.

The bridge relays in memory and does not need an account, cloud service, Health upload, or raw-signal recording. Anyone with the private address can access that run, so keep it private. The public GitHub Pages app cannot run the Python server or connect through iPhone Web Bluetooth; the local Mac is doing the Bluetooth work.

The local copy permits only same-origin connections for its event stream. The public page retains its restrictive network policy. A native iPhone companion could be a future route without a Mac, but is not supplied by this bridge.

## Stop or troubleshoot

- Use Disconnect in the connection sheet to free a device, then stop the server with Control-C in Terminal. Reconnect through the vendor app when you want to return to its usual operation.
- If Safari cannot open the address, confirm both devices use the same Wi-Fi, the Mac is awake, the displayed address is current, and the firewall permits the local server. Guest-network isolation can prevent phone-to-Mac connections.
- If scanning fails, check Bluetooth and the macOS privacy permission for Terminal or the app running Python. [Bleak's macOS troubleshooting](https://bleak.readthedocs.io/en/latest/troubleshooting.html#macos-bugs) explains permission and scanning issues.
- If a connected stream stops, check its source label and reconnect explicitly. Continued ambient movement is not a continuing device measurement.

## Command-line options

From the repository root, after the environment has been installed:

```sh
.venv-bridge/bin/python -m bridge.server --open
.venv-bridge/bin/python -m bridge.server --host 0.0.0.0 --port 8765 --open
```

`--host` defaults to `0.0.0.0` so the phone can reach the Mac; `--port` defaults to `8765`. Use `--host 127.0.0.1` for Mac-only access. `--open` opens the experience on the Mac. `--simulate` is an explicit synthetic test mode, not a device feed:

```sh
.venv-bridge/bin/python -m bridge.server --simulate --open
```

The launcher also passes command-line options through, for example `bash scripts/Start-iPhone-Bridge.command --port 8766`.
