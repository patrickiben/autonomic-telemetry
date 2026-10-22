# Signal visuals alongside your work

The optional **A living view of the signal** panel can sit beside the work board or resting workspace. It gives raw signals a visual form without claiming to measure focus, ADHD symptoms, calmness, or task completion. Task progress comes from your own actions on the work board.

## Choose the source explicitly

| Source | What drives the visual | Display |
| --- | --- | --- |
| Muse S | Validated-shape raw packets from the experimental Bluetooth preview | **LIVE RAW** only while the selected stream is fresh |
| Synthetic demo | A deterministic generated waveform independent of the recording and your body | **SYNTHETIC DEMO** |
| Ambient | Independent decorative geometry, with no sensor mapping | **AMBIENT · NO DEVICE** |

Muse is the default. Without a connected device and fresh data, it waits quietly. Disconnection, stale packets, or a missing selected sensor never silently switch the source to synthetic or ambient animation. You must choose those sources yourself.

**LIVE RAW** means the device adapter reports a connected streaming state and the particular signal shown has received a decoded packet within five seconds. For example, fresh PPG packets cannot keep an old EEG waveform labeled live. The implementation checks both adapter state and the selected channel's packet arrival time. This is a transport-freshness rule, not a claim of physiological quality.

When data become stale, the last plotted raw trace freezes and dims with a **RETAINED · NOT LIVE** badge. Packet histories expire after 60 seconds; the last displayed trace may remain as a clearly labeled retained illustration until the source or visual changes. No reconnection or fabricated continuation is attempted.

## Four raw-signal mappings

- **Signal bloom (default):** a layered, petal-like contour shaped by the latest raw EEG window. Its radius uses centered RMS amplitude relative to the retained range; its petal depth uses mean absolute sample-to-sample change relative to that range. Averaged sample bins add gentle contour detail. These arithmetic descriptors control an artistic shape, not EEG bands, focus, calmness, or a health state. Fixed six-petal geometry supplies the visual structure. No clock-driven breathing, heartbeat, rotation, or autonomous movement is added to live or stale data.
- **Signal tide:** raw EEG voltage values, plotted in sample order. This is a waveform, not alpha/beta power, a contact-quality estimate, cortical arousal, or an attention classifier. The first available EEG channel is used, preferring TP9 when available.
- **Pulse ribbon:** raw PPG ADC values, plotted in sample order. The name describes the optical signal's visual form; no peaks, pulse rate, beat timing, HRV, or respiratory coupling are computed. Channel 2 is preferred when available, otherwise the first available channel. Channels remain numbered because the upstream Muse S optical identities are uncertain.
- **Motion field:** the most recent acceleration magnitude controls the size of a set of quiet rings, with a small trace beneath. Magnitude is calculated from the raw XYZ values and includes gravity. It is not a movement classifier, a quality judgment, or the session's gravity-removed motion feature.

Bloom descriptors, waveforms, and ring size are **auto-scaled** using the minimum and maximum of retained samples for the selected channel. Small variations can therefore look visually large. The range and units remain visible. A bigger bloom, wave, or ring is not better, worse, healthier, calmer, or more focused. A constant trace has no inferred significance. Both EEG options use the first available channel, preferring TP9.

The bloom and waveform use the latest 512 retained samples for their shape; their normalization uses the retained window, up to 60 seconds. A 32-bin averaging step softens bloom contour detail; it is a visual mapping rather than an EEG filter or validated feature extractor. Each channel retains at most 1,600 decoded packets. Packets contain arrays of raw values; the component does not invent synchronized sample timestamps. Horizontal waveform spacing is sample order, not a calibrated time axis. Rendering may skip intermediate frames while reception continues.

## Motion is optional

**Gentle** is the default, with rendering limited to roughly 12 frames per second; **Flowing** permits roughly 24. **Quiet view** hides the visual while leaving its source, status, and controls available. Showing it again does not reset the recording, tasks, or device.

With the operating system's reduced-motion preference, synthetic and ambient images stay still. Real device data are shown as snapshots at most once per second. Source and connection-state changes remain visible. The [reduced-motion media feature](https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion) supplies that preference; the visible hide control follows the intent of [WCAG's Pause, Stop, Hide guidance](https://www.w3.org/WAI/WCAG22/Understanding/pause-stop-hide.html). No whole-application accessibility certification is implied.

Visual preferences are held only in the current page. They are not automatically persisted or included in session JSON. Source selection and visualization never alter imported samples, recording provenance, reference calibration, pattern-shift scores, task state, or the breathing pacer. This component makes no therapeutic or productivity-effectiveness claim.

## Device boundary and implementation

The inline component listens for `telemetry:raw` events from the Muse adapter. Each event contains `type`, `channel`, device sequence `index`, decoded `samples`, and browser `receivedAt`. It rejects unsupported event shapes, nonfinite values, invalid channel numbers, and packets whose supplied receipt time is not recent. It also polls `TelemetryDevices.getState()` for connection state. These are software input checks, not artifact detection or medical validation.

The page makes no remote request for these visuals. Histories are held in memory and cleared on page exit. See [device setup and limits](DEVICES.md) for Bluetooth requirements, packet decoding, and transport cleanup. Physical Muse S hardware is still unverified for this release.

Protocol context comes from the primary [`muse-js` implementation](https://github.com/urish/muse-js/tree/4e864578c55dd7e26d85b429863f47ccabac54a0), whose supported packet streams inform the raw adapter. It does not validate these visual mappings or any inference about task success.
