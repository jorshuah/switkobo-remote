# TV Remote

TV Remote is an open-source web remote for Samsung smart TVs. Run the helper on a Windows PC, then use the remote in your phone’s browser or install it on the Home Screen. The PC, phone, and TV need to be on the same home network, and the PC must stay awake while you use the remote.

1. Install [Node.js 22 or newer](https://nodejs.org/).
2. Run **Start Remote.cmd** on the PC. It opens the private connection page.
3. Scan the QR under **Connect phone**, open the link on your phone, and choose **Connect a TV**. Approve the request on your TV if prompted.

See the [setup and usage guide](web/README.md) for iPhone and Android installation, optional playback, and troubleshooting.

The remote supports navigation, volume, channels, and app shortcuts. Optional Play on TV adds playback controls, subtitles, and a local viewing history for compatible sources. Pairing and playback were tested on a Samsung Q65B. Discovery, standby wake, app launching, and playback support can vary by model, firmware, and network.

[Contributing](CONTRIBUTING.md) · [MIT license](LICENSE) · [Third-party notices](web/THIRD_PARTY.md)