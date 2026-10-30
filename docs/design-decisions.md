# Remote design decisions

Audience: the owner of a Samsung Q65B using an iPhone, with no runtime home computer. Primary action: navigate the TV confidently with one hand. Essential context: selected TV, actual connection state, and recovery action.

The native iPhone implementation uses SwiftUI, a single remote screen with a navigation stack for settings, and native sheets for bounded tools. A tab bar would add permanent navigation for tasks that fit naturally into sheets. A hosted web interface cannot satisfy the chosen direct native connection route reliably. Android and desktop clients remain future work rather than implied compatibility.

The mobile-design checkpoint used the iOS platform, design-thinking, touch-psychology, performance, backend, testing, and debugging references. Applied principles: 48pt or larger primary targets; explicit button alternatives to gestures; cleanup of sockets, discovery, and audio when their lifecycle ends. Avoided patterns: fixed-size text, cloud-account dependencies, silent successful-command claims, and command replay after reconnect. No user account or admin server is appropriate for this personal LAN utility. Local owner preferences persist atomically, with credentials separated into Keychain.

## Research decisions

| Reference | Decision carried forward | What is not borrowed |
| --- | --- | --- |
| [Apple TV Remote, Apple](https://support.apple.com/en-ca/108778) | Large touch area, clear selected device, native accessibility conventions | Glass styling, exact composition, or Apple TV support claims |
| [Smart TV Input Methods, Samsung Developer](https://developer.samsung.com/smarttv/design/input-methods.html) | Directional navigation, Select, and Back remain accessible foundations | Assuming every app supports remote typing or a mouse |
| [Beoremote One, Bang & Olufsen](https://www.bang-olufsen.com/en/int/accessories/beoremote-one) | Quiet tone and grouping by everyday use | Hardware silhouette, branding, or small physical-button density |

The reference board links the publishers' own images for design discussion only. The browser tool blocked local-file preview, so the board and native implementation have not had a rendered visual inspection. Screenshots were not fabricated. The board was shared before implementation; no design approval gate was requested.

## Composition and interaction

Warm graphite and soft sage distinguish the remote without adding decoration. Light mode adapts the contrast using semantic primary/secondary text. SF Pro and Dynamic Type serve readability rather than display typography. SF Symbols form the single icon family. Controls use 12pt gaps and the main content uses 24pt margins, within a 520pt maximum width on iPad.

The screen first names the device and its connection state, then presents the navigation pad. Volume and playback follow. A segmented control switches the pad between buttons and directional swipe gestures. Power sits away from repeated volume/playback taps and asks before turning off the TV. The touchpad exposes accessibility actions, with the button mode remaining available.

Keyboard drafts remain in memory across sheet dismissal; sending does not clear them or submit the TV's form automatically. Dictation is user initiated and reviewed before sending. Profile changes require Save and connect; cancellation protects unsaved profile edits. Preferences save immediately. App IDs and launch mode are configurable because they vary by region and firmware.

No network calls, timers, or animations should claim measured performance until native profiling is performed. Native Dynamic Type, sheet focus, VoiceOver, narrow screens, and landscape need device validation.
