# Bring your device

The **Connect a device** button opens a short guide for Hume Band 2.0, Muse S, and Apple Watch. Hume is the first option. No account credentials are requested. Opening the guide alone does not access Bluetooth or health data.

| Device | Easiest supported route | What appears |
| --- | --- | --- |
| Hume Band 2.0 | Copy a daily reading from the Hume app | Self-reported daily context |
| Hume on iPhone | Export Apple Health data containing Hume-shared metrics | Dated daily context, separated by original source |
| Apple Watch | Apple Health XML export | Dated SDNN, resting HR, respiratory rate, and oxygen saturation when present |
| Muse S | Browser Bluetooth chooser on a supported platform | Experimental raw sensor preview, separate from the recording |

Daily context never substitutes for a dense recording, fills missing session channels, or enters the pattern-shift score. The Muse preview does not populate those channels either.

## Hume Band 2.0

For the shortest path, sync the band in the Hume app, choose **Add a Hume reading**, enter the date and available values, and keep HRV's definition as **Unspecified** unless the source confirms RMSSD or SDNN. The entry remains in the page's memory until it is replaced, the page closes, or it is included in a session export.

On iPhone, Hume's FAQ describes **Me / Profile → Connected Apps → Apple Health**, enabling permitted categories, and synchronizing the app. Not every metric is shared, and categories and availability may change. If the expected measurement is missing from Health, manual entry remains available. This console does not connect directly to the Hume account or implement an undocumented Bluetooth protocol.

As checked October 22, 2026, Hume's FAQ lists native app data export as **Coming Soon**. No Hume-specific CSV format is assumed. On Android, use manual daily context; Google Fit import is not implemented.

## Apple Health export, on your phone or computer

1. Let the Watch or Hume app synchronize with Health.
2. On iPhone, open **Health → Summary → your picture / initials → Export All Health Data**.
3. Save the ZIP archive to Files. Tap it to unpack it.
4. Locate **apple_health_export/export.xml**. Choose **Open Health XML** in the console and select that XML file, not the ZIP.
5. In the context panel, choose the original source—Hume, your Watch, or another writer. The latest supported value within each source is displayed with its own date. The values need not represent the same moment.

This can be done using the mobile file picker. You can also transfer the XML privately to a computer. Large exports may take time and significant browser memory; the local XML limit is 100 MB. Nothing is uploaded by the console.

Apple Health's HRV quantity is SDNN. It is not converted to RMSSD. A web page cannot directly call the native HealthKit API; this release supplies no companion Watch app, live Watch stream, or Watch Bluetooth adapter. The XML path is retrospective context.

## Muse S: experimental direct raw preview

**Physical Muse S hardware has not been verified for this release.** The implementation follows the primary `muse-js` source, but firmware differences, device support, GATT permissions, and packet formats can still prevent a connection. Software and mock-device checks do not establish hardware compatibility or physiological accuracy.

### Pair with one browser action

1. Open the console on HTTPS, including GitHub Pages, or `http://localhost` in a supported browser.
2. Turn on your Muse S. Disconnect it in other Muse apps so it is available to the browser.
3. Choose **Connect a device → Muse S → Choose & connect Muse S**, then select the headband in the browser's picker.

Use a Web Bluetooth capable desktop browser, such as Chrome or Edge on an operating system with supported Bluetooth hardware, or Chrome on Android. iPhone and iPad browsers do not expose the standard Web Bluetooth path used here; use a supported computer for Muse. Safari and Firefox do not supply this path. Context entry, file import, and demo playback remain available on mobile browsers without Bluetooth.

For a local copy, run this from the repository folder:

```sh
python3 -m http.server 8090
```

Then open `http://localhost:8090/`. A plain HTTP LAN address is not the same as localhost. Use HTTPS to access the console from another device.

### What the preview shows

- Raw EEG samples decoded from 12-bit values, using the `muse-js` scale of `0.48828125 × (value − 2048)` µV. The displayed swing is the peak-to-peak range within the latest packet, not alpha/beta power or arousal.
- Raw PPG channel values decoded as unsigned 24-bit ADC counts. Channels are labeled by number because Muse S optical channel meanings are not established in the upstream README. No heart rate, beat intervals, or HRV is inferred.
- Acceleration in g, including gravity, decoded as signed 16-bit XYZ values divided by 16384. The displayed magnitude is not the session schema's gravity-removed motion feature.
- Reported battery percent, when telemetry is supplied, using `uint16 / 512`.
- Decoded packet counts, rejected malformed packets, unavailable optional streams, and the age of the most recent sensor packet.

EEG and PPG accept payload lengths comprising complete 3-byte groups after the two-byte sequence index; this accommodates complete sample-group packet variants. Acceleration accepts complete XYZ groups after its index. Unknown or incomplete packet shapes are rejected. Device arrival times are browser times; no synchronized cross-channel acquisition clock is claimed.

The Bluetooth connection alone is labeled **Waiting for data**. Only a decoded EEG, PPG, or acceleration packet changes it to **Receiving raw data**. Battery telemetry alone cannot establish an active sensor stream. After more than five seconds without a decoded sensor packet, the preview reports stale data. Disconnection retains labeled last values for inspection and stops processing.

The persistent preview banner states that the recording underneath remains its original demo or imported recording. There is **no path from raw preview packets into session signals, the reference, score, or session JSON export**. No heart rate, RMSSD, breathing, EEG bands, artifact classifier, or contact-quality estimate is synthesized from these streams.

### Protocol and cleanup

The adapter requests advertised Muse service **0xfe8d**, then obtains its control characteristic `273e0001-4c4d-454d-96be-f03bac821358`. Four EEG characteristics end in `0003`–`0006`; optional PPG characteristics end in `000f`, `0010`, and `0011`; acceleration ends in `000a`; telemetry ends in `000b` (with the shared Muse UUID suffix).

Commands use a length byte, ASCII command, and newline: the buffer length is command length plus two, and its first byte is command length plus one. Start order is `h`, `p50` when any PPG subscription is available (otherwise `p21`), `s`, then `d`, matching `muse-js`. This is an open-source protocol implementation, not an official manufacturer SDK or a compatibility certification.

Raw decoded packets are held only in memory for at most 60 seconds with a cap of 10,000 packets; they are not written to browser storage or session exports. **Disconnect**, changing to another device type, and page exit stop processing, remove notification listeners, clear the freshness timer and raw history, and disconnect GATT. Closing the guide after a connection succeeds leaves its visible preview running; closing during selection/setup cancels that attempt. Reconnection is explicit; there is no automatic pairing or background account connection.

## Sources checked October 22, 2026

- [Hume's official FAQ](https://humehealth.com/en-gb/pages/faq): Connected Apps settings, incomplete metric sharing, and native export status. Its general device claims do not validate this console.
- [Apple: share Health data in XML format](https://support.apple.com/guide/iphone/share-your-health-data-iph5ede58c3d/ios): export workflow.
- [Apple HealthKit: heartRateVariabilitySDNN](https://developer.apple.com/documentation/healthkit/hkquantitytypeidentifier/heartratevariabilitysdnn): SDNN definition.
- [`muse-js` README](https://github.com/urish/muse-js/blob/4e864578c55dd7e26d85b429863f47ccabac54a0/README.md): Muse S support and uncertainty about PPG channel identities.
- [`muse-js` connection and start sequence](https://github.com/urish/muse-js/blob/4e864578c55dd7e26d85b429863f47ccabac54a0/src/muse.ts), [command framing](https://github.com/urish/muse-js/blob/4e864578c55dd7e26d85b429863f47ccabac54a0/src/lib/muse-utils.ts), and [sample/telemetry decoding](https://github.com/urish/muse-js/blob/4e864578c55dd7e26d85b429863f47ccabac54a0/src/lib/muse-parse.ts): pinned primary implementation references.
- [Web Bluetooth specification](https://webbluetoothcg.github.io/web-bluetooth/): permission, secure-context, and device-picker requirements. [Browser compatibility reference](https://developer.mozilla.org/en-US/docs/Web/API/Web_Bluetooth_API#browser_compatibility).

`muse-js` is MIT licensed. This release uses a small independent protocol implementation rather than importing its runtime or dependencies. If upstream code is copied or vendored in a later revision, retain the required license notice.
