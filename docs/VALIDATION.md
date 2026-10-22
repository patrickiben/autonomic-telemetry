# Release verification — October 22, 2026

The v2.1.0 release passes **42 automated Chromium browser checks** with no page errors or external network requests. Run `npm ci`, `npx playwright install chromium`, and `npm test` to repeat the suite.

The original 26 checks cover synthetic provenance; elapsed-time reference formation; exclusion of poor, unknown, and high-motion samples; missing and changing channels; directional score interpretation; novelty events; timestamps and CSV; canceled or malformed imports; text injection; export/reimport; Apple Health units, dates, sources, and XML declarations; Hume entry; playback timing; reduced-motion pacer controls; gap and exclusion counts; offline operation; and guide links.

The 16 additional checks cover independent Rest and Work timers; mode and keyboard navigation; self-reported ease/focus ratings; intentions and reflections; validated workspace export/reimport and paused timer restoration; duration controls; pacer cleanup; 360- and 390-pixel layouts; 44-pixel touch controls; the fixed mobile timer bar; device-guide handoffs; unsupported Bluetooth; and a mocked Muse service with command framing, raw packet decoding, first-packet gating, stale data, and disconnection. Mode switching preserves the recording and signal model.

Both HTML files were opened directly from disk. Desktop and mobile screenshots were visually inspected. Interface copy and documents use American English. Separate evergreen/sage and midnight-blue/periwinkle palettes were checked on the main panels and all three device-guide panels; sampled text contrast exceeds 4.5:1, with no page or dialog overflow at 360 pixels. The app and field guide use inline assets and system fonts. The manual Pages workflow stages only public static files and documentation.

No physical Muse S, Hume Band, or Apple Watch was tested. The Muse adapter is an experimental raw preview, verified with mocks rather than hardware; its packets never enter the signal model. Hume and Watch use guided entry/import workflows. Software checks establish the tested behavior, not physiological validity or clinical accuracy. No personal health recording was used.
