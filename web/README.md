# Set up TV Remote

## Connect your phone and TV

1. Install Node.js 22 or newer and double-click **Start Remote.cmd** from the repository root. On the first run, the launcher installs dependencies. It then opens [the PC connection page](http://127.0.0.1:48765/connect/).
2. Keep the phone, TV, and PC on the same trusted home network. Scan the QR under **Connect phone** using the phone’s Camera. You can also use **Copy private link** on the PC and open it on your phone.
3. In the remote, choose **Connect a TV**. Select a saved TV, use **Find TVs on my network**, or enter the TV’s IP address manually. You can find the address in the TV’s network status or IP settings.
4. Approve **TV Remote** on the television when prompted. Try navigation and volume first.

Keep the helper running and the PC awake while using the remote. To stop the helper, run **Stop Remote.cmd**. To reopen the connection page, run Start Remote again.

If the phone cannot reach the helper, check that it is on the home network and that neither device is on an isolated guest network. If Windows prompts for network access, allow Node.js on the private network. For a TV that has refused pairing, check its device connection settings and try again. Use **Connection help** for the private QR or certificate steps.

## Install on iPhone or Android

1. After running **Start Remote.cmd** once, run **Enable Secure Remote.cmd** to set up local HTTPS. Running this command restarts the helper, so finish any playback first.
2. On the PC connection page, choose **Set up a new phone**. Scan its setup QR and follow the guide on your phone. On iPhone, install the profile and enable trust for **TV Remote Local CA** under **Settings → General → About → Certificate Trust Settings**. On Android, install the downloaded certificate as a CA certificate. The exact menu varies by device. Install only the certificate from your own PC.
3. Open the secure check in the guide. Then return to **Connect phone** on the PC and scan the private QR.
4. On iPhone, open the remote in Safari and use **Share → Add to Home Screen**. Enable **Open as Web App** if offered. On Android, use Chrome’s **Install app** option or **Settings → Install app** in the remote.

If the PC’s network address changes or the server certificate expires, rerun **Enable Secure Remote.cmd** and scan the updated connection QR. Routine renewal reuses the local CA. The installed app can open its interface offline, but TV control needs a connection to the helper and television.

## Play on TV

Run **Setup Playback.cmd** on the PC to install the optional playback browser. Open **Play on TV** in the remote to search supported catalogs or use a compatible video link. Keep the PC awake until playback finishes. Only play media you’re authorized to access.

- **Now playing** includes pause, resume, seeking, available quality options, and subtitle controls. Starting playback or changing streams can take time while the helper buffers. Available resolutions depend on the source.
- **History** and **Continue watching** use checkpoints stored by the helper. The remote can resume a saved title once its source is available. History is shared by phones using the same helper.
- **Subtitles** supports source tracks, imported SRT/VTT files, and timing adjustments. For optional online search, copy `.env.example` to `.env` in `web/` and set `WYZIE_API_KEY` on the PC. One key serves all connected devices.

Catalogs, poster images, online subtitle search, and streaming sources depend on external services. Ordinary remote buttons use the local connection. If video fails while remote commands still work, try an available lower quality or another compatible source.

## Private data

The helper stores pairing, access credentials, certificates, playback history, and logs under `%LOCALAPPDATA%\SwitkoboRemote`. `SWITKOBO_DATA_DIR` can override that path. Keep the private QR, link, environment file, and helper data out of Git and public reports.

The PC connection page is available only from the PC. The default local ports are 48765 for HTTP and 48766 for HTTPS. Keep them on the home network and do not forward them to the internet. The helper pins the TV’s certificate after pairing. If a previously paired TV presents a different certificate, verify the device before resetting its pairing.

See [Contributing](../CONTRIBUTING.md) for development and tests, and [third-party notices](THIRD_PARTY.md) for bundled assets and dependencies.