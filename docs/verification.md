# Verification record

The repository is public under the MIT license. A standard GitHub-hosted macOS runner successfully compiled the simulator and unsigned iPhone device app, ran six core tests and three native UI smoke tests, and packaged an IPA in [run 41144107353](https://github.com/jorshuah/switkobo-remote/actions/runs/41144107353) at commit 82fd5ac383a4002aae91b82406f9a0af75d68443.

Simulator screenshots were inspected for first connection, the connection form, saved-but-disconnected remote controls, and accessibility-size settings on iPhone 16 Pro. The large-text review exposed a cramped appearance selector; it was changed to a separate native selection page. The follow-up [run 41145138670](https://github.com/jorshuah/switkobo-remote/actions/runs/41145138670) confirmed the repaired layout but failed a test query that incorrectly treated an inline picker button as static text. After correcting the query, [run 41145925355](https://github.com/jorshuah/switkobo-remote/actions/runs/41145925355) at commit d1a1dd37555bd1efa22cc04fcde286a9677ba106 passed all six core tests, all three UI tests, simulator and device compilation, and unsigned IPA packaging. The final screenshot also confirms selecting Dark updates the appearance at the largest accessibility text size.

Windows source checks parsed all 12 Swift files and validated asset catalogs, the privacy manifest, XcodeGen source paths and permission declarations, the app icon dimensions/mode, and GitHub workflow structure. The original app icon was visually inspected. These syntax/configuration checks are separate from the native build and XCTest results.

The mobile skill's generic audit reported zero applicable files because it does not inspect this Swift implementation. Its zero-check result is not counted as a passing native audit. The local HTML reference board could not be browser-previewed because the browser tool rejected local-file URLs.

The initial private-repository build was blocked by account billing/spending restrictions before any steps executed. After the owner authorized public visibility, public macOS builds succeeded. No paid build service, signing service, or subscription was activated.

Remaining: real Q65B authorization and command compatibility; real-device microphone lifecycle and Keychain/settings persistence; VoiceOver, external keyboard, smaller phones, iPad, landscape, and broader light/dark layouts. Follow [device-testing.md](device-testing.md). Simulator screenshots show offline states and do not establish TV compatibility or on-device performance.

The IPA is unsigned. It still needs personal signing and installation before hardware testing. Free-account sideloading has recurring signing limitations; a Windows computer is needed for installation/refresh, not for TV control.

The downloaded version 0.1.0 IPA passed ZIP integrity checks and contains the iPhoneOS executable and MIT license. Its bundle identifier is `com.switkobo.remote`; archive size is 403800 bytes and SHA-256 is `5bb9d3e4c20aee12aa5263a192ed83aa4e04b375e4654aaaf362e4aba5a334ea`. These checks do not verify signing or installation.
