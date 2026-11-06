# Third-party runtime notices

TV Remote's original source remains under the repository MIT license. Dependencies and their downloaded executables retain their own licenses.

- [Playwright](https://github.com/microsoft/playwright): Apache-2.0. Browser distributions downloaded by Playwright have separate bundled notices.
- [ffmpeg-static](https://github.com/eugeneware/ffmpeg-static): GPL-3.0-or-later. Its installation downloads a platform-specific FFmpeg executable; preserve its license notices and corresponding source/build information when redistributing it. See the package's ffmpeg.LICENSE and ffmpeg.README files and [FFmpeg's legal and licensing page](https://ffmpeg.org/legal.html).
- [qrcode](https://github.com/soldair/node-qrcode): MIT.
- [ws](https://github.com/websockets/ws): MIT.
- [web-push](https://github.com/web-push-libs/web-push): MPL-2.0.
- Lucide SVG assets: ISC, included in public/icons/LICENSE.
- jsQR: Apache-2.0, included in public/vendor/jsQR.LICENSE.
- App wordmarks and TMDB artwork attribution are documented in [public/brands](public/brands/README.md).

The repository does not check in Chromium or FFmpeg binaries. Runtime downloads are installed by npm/Playwright on the user's PC. No movie artwork, media bytes, subtitle files, source cookies or credentials are bundled with the project.
