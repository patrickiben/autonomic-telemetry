# Local Bluetooth bridge

Start with [the iPhone setup guide](../docs/BRIDGE.md). The bridge serves a private local copy of the immersive experience, connects wearables on the Mac with Bleak, and forwards data to Safari over a same-origin event stream.

## Install and run

Python 3.10 or newer is required. From the repository root:

```sh
python3 -m venv .venv-bridge
.venv-bridge/bin/python -m pip install -r bridge/requirements.txt
.venv-bridge/bin/python -m bridge.server --open
```

Or use the executable [Mac launcher](../scripts/Start-iPhone-Bridge.command), which performs those steps. [Bleak 3.0.2](https://pypi.org/project/bleak/3.0.2/) and [qrcode 8.2](https://pypi.org/project/qrcode/8.2/) are pinned in `requirements.txt`, checked against official PyPI on October 22, 2026. QR codes use the SVG renderer without Pillow. Python's standard library handles the local HTTP server and event stream.

The server prints a fresh private path on each run. All app, control, state, and event routes are under it. The default listener is `0.0.0.0:8765`, allowing an iPhone on the same Wi-Fi to connect. HTTP traffic is cleartext; use a trusted private network, keep the printed path private, and do not forward the port to the internet.

## Adapter boundaries

- `muse.py` detects Classic versus Athena from GATT characteristics and decodes the available EEG, optical, acceleration, and telemetry packets. Athena's `0013` multiplexed stream provides eight EEG and four optical channels plus acceleration. It does not infer attention, heart rate, HRV, or breathing from those raw samples.
- `hume.py` requests current, device-reported heart rate through the FFF0 vendor service. It validates reply shape, type, checksum, and nonzero HR before accepting a reading. It uses only the narrow measurement start, 20-second renewal of that same start command, and stop; it does not change device settings or touch stored history.

A separate bridge feature processor produces explicitly valid/unavailable components. Accepted optical intervals supply pulse RMSSD and actual sample-SDNN with matching source, quality, window, and freshness metadata. These are experimental PRV estimates, not ECG HRV. The main multivariate model uses eligible HR, RMSSD, SDNN, and EEG beta/alpha; the bridge does not infer respiration. Restart a running bridge after updating to load the added SDNN feature. See [live methods](../docs/METHODS.md). Transport tests do not validate extraction or inference accuracy.

The Hume interoperability source is pinned to [`j2208-band-tools` commit 62ce483](https://github.com/brendangooden/j2208-band-tools/tree/62ce48357e25d1c68e4c3e0bfd8d2cf1bbd745e9), which reports one Hume Band V2 on firmware `0.0.3.9`. The upstream MIT notice is preserved in `hume.py`. Raw PPG was unusable and RR unsupported on that upstream firmware; a generic HRV field is not relabeled RMSSD. The owner's separate physical test on October 22, 2026 accepted 84 validated nonzero responses over 90 seconds from acquisition, with a maximum three-second gap after approximately 12–15 seconds of warm-up, followed by verified stop/unsubscribe/disconnect. The owner's firmware was not read. This is bounded transport evidence, not indefinite operation, physiological accuracy, or universal compatibility. The connection is independent interoperability, not a manufacturer SDK integration.

The Classic Muse protocol context comes from the primary [`muse-js` implementation](https://github.com/urish/muse-js/tree/4e864578c55dd7e26d85b429863f47ccabac54a0), whose MIT notice is retained. Athena framing and decoding use pinned [`muse-rs` parse.rs](https://github.com/eugenehp/muse-rs/blob/7d6a885cfbb076ec8d50e6f44935a357c65eaf80/src/parse.rs) and [muse_client.rs](https://github.com/eugenehp/muse-rs/blob/7d6a885cfbb076ec8d50e6f44935a357c65eaf80/src/muse_client.rs), with its full Apache-2.0 license in [LICENSE.muse-rs](LICENSE.muse-rs). The direct browser adapter still supports Classic only and remains physically unverified here; updated Athena devices use this bridge. One Athena headband passed a 40.3-second physical test across eight EEG channels, four optical channels, and acceleration, with no malformed packets, stale intervals, or adapter errors and clean teardown. A combined physical Muse/Hume event-stream canvas test also passed in a 390-pixel-wide desktop Chromium viewport; this does not establish physical iPhone performance. No native iPhone app is included.

## Interface

Under the private run prefix, `Autonomic_Telemetry_Console.html` is the experience with its integrated connection sheet, `api/state` exposes status, `api/events` streams events, and `api/control` accepts explicit scan/connect/disconnect actions. `pair.svg` is a private QR code for the current phone address, shown in the Mac connection sheet. The viewer adapts messages into the live visual API; it keeps source labels and per-signal freshness separate from packet arrival at the phone.

`--simulate` emits explicitly labeled synthetic input for testing. It must not be presented as a live Muse or Hume stream. Restart the server without that option for Bluetooth use. Run the adapter and bridge checks described in the repository's validation notes before changing protocol or freshness behavior.
