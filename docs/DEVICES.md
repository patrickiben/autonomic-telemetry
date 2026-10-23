# Connect your wearables

Open **Connect** in the experience. The sheet contains Muse and Hume controls, nearby-device selection, connection status, and a small signal preview. The source badge on the main canvas stays visible when the sheet is closed.

## iPhone: use a nearby Mac

The [local bridge](BRIDGE.md) connects to the wearables on your Mac and relays signals to Safari on the same trusted Wi-Fi. Start it with [the Mac launcher](../scripts/Start-iPhone-Bridge.command), open Connect on the Mac, then scan its private phone QR code with the iPhone camera. The printed phone link is a fallback.

The phone uses the local app address, rather than the GitHub Pages address, for this connection. Keep the Mac awake and in Bluetooth range. If a vendor app already holds a wearable, disconnect it there when you are ready to switch. Use Disconnect to free it afterward.

## Muse S

Muse supplies raw EEG voltage, optical PPG counts, acceleration, and available telemetry. A separate experimental bridge processor extracts pulse RMSSD, actual pulse SDNN, and EEG beta/alpha under motion, continuity, and signal gates. These eligible features contribute to the restored multivariate estimate. Pulse variability is optical PRV, not ECG-derived HRV; SDNN is calculated independently from the same accepted intervals as RMSSD. Neither low motion nor accepted packets prove contact quality or a mental state. No respiratory rate is derived by the current bridge. See [live methods](METHODS.md).

The Mac adapter detects the transport from the available Bluetooth characteristics. It supports the Classic layout and the newer Athena multiplexed layout (`0013`), with eight raw EEG channels, four optical channels, and acceleration. Channel indices are preserved without assuming anatomical or wavelength roles beyond the source protocol. Hardware, permissions, firmware, and available characteristics can affect connectivity; this does not establish compatibility with every Muse variant.

Supported desktop Chromium browsers and Chrome on Android can also use direct Web Bluetooth from HTTPS or localhost for the **Classic** raw-preview layout. That browser adapter is not the Athena adapter or the new bridge feature processor. Use the Mac bridge for the current live inferred-arousal feature path, for an updated Muse S using Athena, and for iPhone or iPad. The direct browser adapter remains physically unverified here.

On October 22, 2026, one physical Athena Muse S completed a 40.3-second raw-stream test: 40,962 EEG channel packets across eight channels, 3,276 optical packets across four channels, and 658 acceleration packets, with no malformed packets, stale intervals, or adapter errors, followed by a clean stop and disconnect. This verifies bounded transport on that headband, not contact quality, clinical calibration, every variant, or indefinite operation.

Protocol context comes from pinned primary implementations: Classic [`muse-js`](https://github.com/urish/muse-js/tree/4e864578c55dd7e26d85b429863f47ccabac54a0), with its MIT notice retained, and Athena [`muse-rs`](https://github.com/eugenehp/muse-rs/blob/7d6a885cfbb076ec8d50e6f44935a357c65eaf80/src/parse.rs), with the upstream Apache-2.0 license preserved in `bridge/LICENSE.muse-rs`.

## Hume Band 2.0

The Mac adapter requests current device-reported heart rate through an independent vendor-protocol implementation. It accepts nonzero readings with valid frame type and checksum. Zero replies mean unavailable or warming up, not zero bpm. Reported rate supplies the HR term in the integrated estimate; it does not supply beat timing, RR intervals, RMSSD, SDNN, or usable raw PPG.

The pinned [upstream interoperability source](https://github.com/brendangooden/j2208-band-tools/tree/62ce48357e25d1c68e4c3e0bfd8d2cf1bbd745e9) reports one Hume Band V2 on firmware `0.0.3.9`. That is the upstream test unit, not a firmware identification of the owner's band. This is not a manufacturer SDK integration. The adapter only starts, renews, and stops the narrow current-HR measurement; it does not change monitoring settings, firmware, or stored history. Live measurement can increase battery use.

On October 22, 2026, a physical Hume Band V2 test accepted 84 checksum-valid nonzero responses during 90 seconds from the first valid reading, with a longest gap of three seconds and no stale interval after acquisition. Initial warm-up took about 12–15 seconds. Repeating the same current-HR start command every 20 seconds kept that bounded run active; stop, unsubscribe, and disconnect completed afterward. This verifies the tested transport on one band, not physiological accuracy, every firmware version, or indefinite operation. No identifiers or heart-rate values are included in the test report.

## When the stream stops

The canvas labels waiting or interrupted input and returns toward ambient rather than inventing live values. Raw-stream status, derived-feature validity, and estimate/reference availability are separate. Reconnect explicitly after a device or Wi-Fi interruption. Demo mode is a separate, synthetic source and does not establish that a wearable is connected.

A combined physical Muse/Hume run also reached the canvas through the Mac bridge's event stream in a 390-pixel-wide Chromium viewport, with both sources labeled Live and no browser errors or overflow. That was a desktop-browser mobile-layout check, not a physical iPhone performance test. No device identifiers or physiological readings are published in these test summaries.

## Apple Watch: keep it as separate Health context

Apple Watch remains useful for reviewing your own historical Health data, but it is not a live source in this experience. This web page cannot call native HealthKit or connect to the Watch as a generic Bluetooth heart sensor. A live Watch route would need a native companion; none is included here.

For your own archive, open Health on iPhone, tap your profile picture, and choose Export All Health Data. Apple's [export guide](https://support.apple.com/guide/iphone/share-your-health-data-iph5ede58c3d/ios) describes the XML format. The canvas does not import that file; the separate [Signal Lab](../Autonomic_Telemetry_Signal_Lab.html) can load it as retrospective context, separate from the model reference. HealthKit's [HRV quantity is SDNN](https://developer.apple.com/documentation/healthkit/hkquantitytypeidentifier/heartratevariabilitysdnn), which is distinct from RMSSD and is not substituted for it.
