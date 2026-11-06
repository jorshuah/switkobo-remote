# Contributing to TV Remote

The project is a local web remote with a Windows helper for Samsung TVs. The browser UI lives in `web/public/`. The Node.js helper, protocol, and playback modules live in `web/`. Keep TV control usable without an account, ads, or a subscription.

From the repository root, run the following commands with Node.js 22 or newer.

```sh
cd web
npm ci
npx playwright install chromium webkit
npm test
npm run test:ui
```

The tests use simulated TVs and temporary data. The GitHub workflow runs these checks on Linux. Browser tests cover desktop Chromium and simulated iPhone and Android layouts.

If you change the app shell or its offline assets, run `node scripts/pwa-assets.mjs` from `web/` and include the updated build marker and service worker. Use `npm run build:pwa` when changing the app icon exports as well.

In a pull request, describe the user-visible change and the checks you ran. For UI changes, include a narrow-screen screenshot using test data. Preserve keyboard access and alternatives to gestures.

Hardware reports are welcome. Include the TV model and firmware, phone and browser, action attempted, and what happened. Remove private QR codes, access links, local IP addresses, source URLs with credentials, and API keys from attachments and logs.

Contributions use the [MIT license](LICENSE). Bundled third-party assets and dependencies retain their [own notices](web/THIRD_PARTY.md).
