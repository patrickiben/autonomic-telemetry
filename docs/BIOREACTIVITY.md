# A living view, with a personal estimate

The canvas gives the experimental **inferred arousal estimate** a consistent visual meaning. Work supports continuous observation and an optional sustained-elevation cue; Rest adds paced breathing and a personal settling trend. They share the same estimate and references; Rest draws it differently, as described below.

## What the number means

The one-sided 0–100 estimate uses the restored multivariate model: HR increase, RMSSD decrease, supplied breathing increase, covariance distance, EEG beta/alpha increase, and actual pulse-SDNN decrease, plus bounded temporal modifiers. **Zero is the reference origin.** A low value means little response under those terms; covariance distance can respond to changes in either direction. The current bridge supplies eligible Muse/Hume cardiac and EEG inputs, but no respiratory estimate. Accepted Muse pulse rate can supply HR when Hume is absent. Source changes restart the reference.

The available profile freezes when the two-minute reference completes. Original nominal weights are normalized once over that profile and shown in inspection. An HR-only profile is explicitly limited. A missing required channel holds the score; newly available channels require a reference reset. Reference progress and unavailable-feature reasons remain visible. Coverage is not a probability or confidence interval. The model is an experimental personal heuristic, not a direct measurement of a mental or health state.

Open **Reference & signals** to see the reference, sources, feature contributions, weighted sum, modifiers, smoothing, surprise, covariance, eigenvalue concentration, entropy, autocorrelation, signed lags, PCA, and onset events. Save/open a reference or export the analysis session explicitly. An unavailable estimate is a dash, not zero. See [Methods](METHODS.md) for the exact formula and [Signal Lab](../Autonomic_Telemetry_Signal_Lab.html) to replay that same model from the exported features. The Lab also retains clearly labeled comparison tools.

## What shapes the light

- **The available estimate alone** sets the cloud's extent, brightness, warmth, and star-arm spread. Lower values are smaller and cooler aqua; middle values are lavender; higher values are larger, brighter, and warmer coral/peach. A fixed dotted orbit marks the zero-reference origin so the changing extent has a stable comparison.
- **Work** presents a slowly spiraling galaxy with the mapping above. **Rest** draws the session as a lattice of light strands receding in depth, one layer per 10 seconds, newest nearest. Each layer's mean estimate sets its warmth, from cool blue to amber, and how many of its strands are lit. A layer whose samples mostly lacked an estimate stays dim and unencoded, so the ambient lattice carries no score. The lattice is seen through the thin-lens deflection of a point mass, which weakens with angular distance from the mass and forms an Einstein ring, doubled images, and a dark core. The lens is decoration; it encodes no score.
- **Raw EEG and optical variation** add only minor filament texture. They do not independently enlarge or brighten the score cloud. Raw motion does not move the cloud; its role in feature quality gates is unchanged.
- **Rest's breathing guide** sets the strength of the lens and a wave of light that travels through the lattice: the Einstein ring widens on each in-breath and relaxes on each out-breath. When the guide is off and a recording supplies a respiratory rate, the same motion follows that rate instead. Breathing never changes the estimate or a layer's encoding. With reduced motion, Rest is a still, unwarped lattice and only the text cue keeps time.

The small visual key in the experience explains this mapping. Color and size encode the displayed estimate; they are not extra evidence, another physiological score, or individual heartbeat timing. A raw trace can remain visible while a derived feature is withheld.

## Keep the source in view

| Label | Meaning |
| --- | --- |
| Ambient | Decorative movement; no fresh device input is shaping it |
| Live · Muse / Hume | Accepted recent raw packets from the named source |
| Demo | Explicitly synthetic input, including bridge simulation |
| Ambient · waiting for device | Connection or first data is pending |
| Ambient · signal paused | The device stream is stale or interrupted |

Live raw input and a usable estimate are different states. A connected device can lack an eligible derived feature or completed reference. Waiting, held, and stale states remove the score-encoded halo and show a distinct ambient sky. An unavailable estimate is never presented as a return to the reference. Continuing ambient movement does not manufacture samples or extend a valid estimate. The Connect sheet holds nearby-device selection, status, feature details, and a recent raw preview.

## Work and Rest

Work's optional sustained-elevation cue is off initially; when enabled, it gives a gentle message after an estimate of at least 68 persists for 60 seconds of valid data. It does not identify a cause or predict an outcome. Rest's four-second inhale/six-second exhale guide starts on and can be turned off; it provides timing, not measured respiration. Rest shows change since entering that mode and a 60-second trend within the same track; interruptions or source/reference changes reset the comparison. A lower estimate is an observation, not proof of recovery. Breathing itself can change pulse variability.

Space provides less copy, gentler movement, a still image, Soft/Vivid color, and full screen where supported. Vivid is the default. Gentler movement and the system's reduced-motion preference freeze decorative drift while allowing static redraws for updated estimates. Still image freezes canvas updates for fresh values. If the estimate becomes stale, held, or unavailable, its score encoding clears once even while Still image remains on. The number and status continue updating. Timer remains optional and does not control feature extraction, reference formation, or the estimate.

Raw packets, derived features, references, and visual settings stay in memory unless you explicitly export a session or reference file. The [Mac bridge](BRIDGE.md) drives the iPhone experience over unencrypted HTTP on trusted private Wi-Fi; the public standalone page does not start that server or a cloud connection.
