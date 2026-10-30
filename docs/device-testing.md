# Device verification still required

No iOS binary or real Q65B connection has been tested in this Windows workspace. Run the cloud macOS workflow first and fix any compiler/test failures before installation. Native interaction and visual checks below are release gates, not completed checks.

## Pairing and recovery

- Start with the TV on and an unpaired iPhone. Verify the iOS Local Network prompt, TV approval prompt, pending state, successful authorization, and saved pairing after app restart.
- Deny TV approval; confirm a readable error and retry path. Reject iOS Local Network permission; grant it in Settings and retry.
- Ignore approval for 30 seconds. Confirm timeout and cancellation. Connect, cancel, then connect to a second saved TV; old events must not change the new session.
- Disconnect Wi-Fi or turn off the TV while sending commands. Confirm failure and that no queued volume/navigation commands replay after reconnect.
- Background the app, return, and confirm credential-based reconnect. Confirm connection is not claimed merely because TCP/TLS/WebSocket opened.
- Simulate a changed certificate in a controlled fixture; the stored pairing must fail closed until explicitly forgotten.

## Controls and optional features

- Test every directional key, Select, Home, Back, Inputs, volume/mute, playback, channel digits, guide, menu, and colored keys in appropriate TV contexts.
- Compare a short swipe with a tap. Confirm one directional command per swipe and one Select command per tap. Test VoiceOver actions and the button alternative.
- Open a TV search field; send ASCII, accented text, non-Latin text, and punctuation. Confirm whether the particular app accepts remote input. Check explicit Enter behavior and that the draft remains after sending or failure.
- Try app listing and app launch. Confirm timeout feedback when firmware does not return a list. Save, edit, relaunch, and remove shortcuts; verify persistence after restart.
- Enable supported standby settings and test a unicast wake packet using the TV's actual MAC. If unsupported on the network, retain the documented physical-remote fallback.

## Dictation and privacy

- Grant and deny microphone/speech permissions separately. Initial system permission dialogs must not prematurely cancel setup.
- Test an on-device-supported language and an unsupported language. Unsupported recognition must keep the keyboard available and never silently switch to cloud recognition.
- Dictate, stop, review, and send. Dismiss the sheet, lock the iPhone, switch apps, and interrupt with a call. Confirm the microphone stops and previous text is retained.
- Inspect traffic and logs: no typed text/token logging, no analytics, and no remote commands outside the selected local TV address.

## Settings, layout, and accessibility

- Save a TV and preferences, terminate and relaunch, and verify values persist. Simulate a failed write and unreadable settings file; confirm no silent overwrite or false save message.
- Check iPhone SE-sized screens, a larger iPhone, iPad, landscape, light/dark mode, and accessibility text sizes. Content must scroll without clipping essential actions.
- Use VoiceOver, Switch Control, and an external keyboard through connection, TV selection, settings, and sheets. Check focus return, labels, disabled states, and sheet dismissal.
- Test long device and app names, large error messages, and keyboard avoidance.
- Measure responsiveness, startup, energy, and memory on hardware. No performance figures are asserted yet.
