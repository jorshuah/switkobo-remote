# Verification record

The Windows source checks parsed all 12 Swift files successfully and validated asset catalogs, the privacy manifest, XcodeGen source paths and permission declarations, the app icon dimensions/mode, and GitHub workflow structure. The original app icon was visually inspected.

The mobile skill's generic audit reported zero applicable files because it does not inspect this Swift implementation. Its zero-check result is not counted as a passing native audit.

The GitHub macOS run [41142981977](https://github.com/jorshuah/switkobo-remote/actions/runs/41142981977) failed before a runner executed any steps due to an account billing/spending restriction. It did not typecheck, compile, run unit tests, run UI tests, or produce an IPA. Do not interpret this as a compiler or test failure; those checks have not run.

Native rendering, VoiceOver, keyboard/sheet behavior, microphone lifecycle, Keychain persistence, TV authorization, and command compatibility still require the Apple-platform/device checks in [device-testing.md](device-testing.md). The local HTML reference board could not be browser-previewed because the browser tool rejected local-file URLs.

No paid build service, signing service, or subscription was activated. Source visibility remains a user decision. Free-account sideloading still has Apple's recurring signing limitations even if compilation uses a free cloud runner.
