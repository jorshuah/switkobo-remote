# Switkobo Remote

An open-source native iPhone/iPad remote designed to connect directly to a Samsung Q65B over the home network. No runtime computer, cloud relay, account, ads, analytics, purchases, or subscription is implemented.

**Status: preview with successful native builds and simulator smoke tests; actual Samsung Q65B compatibility is still unverified.** The Windows development workspace uses GitHub-hosted macOS for compilation and simulator tests. The initial target is iOS/iPadOS 17+. Android, Windows, and Mac clients are not implemented in this iteration.

## Included behavior

- Direct TLS WebSocket pairing on port 8002, TV approval, connection timeout, heartbeat, explicit retry, and reconnection when returning to the foreground
- Pairing token and first-approved TV certificate saved in device-only Keychain storage; changed certificates fail closed
- Saved TVs with names, local IPv4 addresses, optional MAC addresses, and editable app shortcuts
- Navigation pad, swipe navigation, home/back/input, volume/mute, playback, channel digits, guide, menu, and colored keys
- Text entry with Unicode support, draft preservation while the app remains open, and explicit Send/Enter actions
- On-device speech dictation into a reviewable draft, with permission, unavailable-language, interruption, cancellation, and microphone cleanup paths
- Best-effort Bonjour discovery, app list retrieval, configurable app shortcuts, and unicast Wake-on-LAN requests
- Native sheets, light/dark/system appearance, Dynamic Type, VoiceOver labels/actions, and persistent haptic preferences

The touchpad sends directional navigation commands; it does not claim mouse-pointer support. Dictation does not stream audio to Bixby. Keyboard input, app launching, discovery, and standby wake remain firmware/app/network-dependent and unverified on the user's Q65B. Remote command submission is not proof that the TV performed the action.

## Build without owning a Mac

The repository includes `.github/workflows/ios.yml` for a GitHub-hosted macOS runner. It tests the Swift core, generates the Xcode project, builds the simulator app, runs UI smoke tests, and then packages an **unsigned** iPhone IPA. No Apple signing secrets are needed for that workflow. The source is uploaded to [jorshuah/switkobo-remote](https://github.com/jorshuah/switkobo-remote). The public repository uses a standard macOS runner. Native builds, six core tests, and three UI smoke tests have passed, and an unsigned IPA has been produced. See the [verification record](docs/verification.md) for build evidence and remaining hardware checks.

1. Put the source in a GitHub repository you control, preserving `.github/workflows/ios.yml`.
2. Run **iOS build and tests** in the repository's Actions tab. Check your GitHub Actions allowance before enabling hosted builds.
3. Only after the job succeeds, download the `SwitkoboRemote-unsigned` artifact and extract the IPA.
4. Sign and install it with your own Apple account using a supported Windows sideloading tool. [AltStore Classic's official Windows instructions](https://faq.altstore.io/altstore-classic/how-to-install-altstore-windows) explain its installation requirements; import the IPA using AltStore's My Apps screen.

The unsigned IPA cannot be installed directly. **Free-account sideloading requires recurring signing refreshes.** AltStore documents a seven-day expiry and uses AltServer on a computer for refreshes. That computer is for installation/renewal, not TV control. See [AltStore's refresh explanation](https://faq.altstore.io/altstore-classic/your-altstore) and [AltServer](https://faq.altstore.io/altstore-classic/altserver). App Store/TestFlight distribution is a separate signing and release process, not included here. Do not share Apple passwords in source, CI configuration, or chat.

## Build on a Mac if one becomes available

Use Xcode 16.2 or later with an iOS 17+ SDK/device and [XcodeGen](https://github.com/yonaskolb/XcodeGen).

```sh
swift test
xcodegen generate
xcodebuild -project SwitkoboRemote.xcodeproj -scheme SwitkoboRemote \
  -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO build
open SwitkoboRemote.xcodeproj
```

In Xcode, select a unique bundle identifier and your signing team, choose the iPhone, and run. No pairing secrets belong in build settings. The generated project is derived from `project.yml`; keep that file as the source of project configuration.

## First connection

1. Turn on the TV and connect it and the iPhone to the same reachable local network. Guest isolation can prevent communication.
2. Tap **Connect a TV**. Try **Find nearby TVs**, or enter the TV's address from Network Status / IP Settings. Nearby discovery can include non-Samsung AirPlay devices; choose the actual Samsung TV.
3. Tap **Save and connect**, allow iOS Local Network access, and approve **Switkobo Remote** on the TV.
4. Test navigation and volume before testing text entry or shortcuts. A successfully opened socket is not considered paired until the TV returns its authorization event.
5. For wake requests, add the TV's MAC address and enable Power On with Mobile where supported. This implementation sends unicast UDP wake packets; it does not use restricted multicast entitlements. Router ARP behavior and TV standby behavior can prevent wake-up. Use the physical remote if needed.

First-use TLS trust is limited to the selected literal local address and port. The certificate is pinned only after authorization; this is trust on first use, not a manufacturer-backed identity verification. If it changes, verify the address and TV before using **Forget pairing**. This app does not scan public networks or accept arbitrary URLs as TV addresses.

## Verification

`Tests/RemoteCoreTests` covers address restrictions, token URL encoding, Unicode input, authorization parsing, malformed app lists, and Wake-on-LAN packet structure. `Tests/UITests` covers the initial unpaired state, connection form, settings access at accessibility text sizes, and disabled controls before TV authorization. Six core tests and three UI tests passed on the macOS runner. Simulator screenshots were inspected; they do not demonstrate a live TV connection.

Windows source checks:

```powershell
python -m pip install --target .tools -r requirements-dev.txt
python scripts/generate_assets.py
python scripts/validate_source.py
```

These checks parse Swift syntax and validate configuration/assets. They are not a compiler or a substitute for native UI and device tests. See [device test plan](docs/device-testing.md) for the remaining release checks.

## Design and implementation notes

[Reference board](design/moodboard.html) · [design decisions](docs/design-decisions.md)

The app uses SwiftUI and Apple frameworks; its core is a local Swift package with no third-party runtime dependencies. Protocol behavior was researched using the [samsung-tv-ws-api project](https://github.com/xchwarze/samsung-tv-ws-api), [Home Assistant's Samsung integration](https://www.home-assistant.io/integrations/samsungtv/), and [Samsung's input documentation](https://developer.samsung.com/smarttv/design/input-methods.html). This is an independent implementation and is not affiliated with Samsung or Apple. No vendor artwork is included in the app.

## License and contributions

The app source and original assets use the [MIT license](LICENSE). See [CONTRIBUTING.md](CONTRIBUTING.md) for development and hardware-testing guidance. Linked reference images retain their publishers' rights; they are not bundled in the application.
