# Contributing to Switkobo Remote

This project aims to provide a dependable TV remote without advertisements, subscriptions, cloud accounts, or a computer required during use. The first implementation targets iPhone/iPad and Samsung Tizen TVs, with the Q65B as the first requested hardware target.

Before changing behavior, read the README, the design decisions, and the device test plan. Open an issue for a new TV protocol or major workflow change so its scope and device-testing approach are clear.

For a pull request:

- Keep protocol behavior in `Sources/RemoteCore` and native networking/UI in `App`.
- Add focused tests for protocol, validation, connection, or lifecycle changes. On a Mac run `swift test`, then generate and build the Xcode project. The GitHub workflow runs native smoke tests and packages an unsigned device build.
- Describe what was actually tested, with TV model, firmware, and iOS version where relevant. Mark untested device features explicitly.
- Include screenshots for UI changes at a small phone size and with large text. Support VoiceOver and retain button alternatives to gestures.
- Do not log pairing tokens, dictated text, passwords, or other personal information. Remove tokens and local addresses from public logs and issue attachments.
- Do not add advertising, analytics, paid feature gates, or cloud dependencies to the core remote flow.

Hardware reports are welcome even without a code change. Include the model, software versions, action attempted, expected result, actual result, and whether other controls work. Never post your Apple credentials or a raw pairing URL.

Contributions are provided under the project's MIT license. Third-party reference images linked in the design board retain their original owners' rights and are not part of the app's asset license.
