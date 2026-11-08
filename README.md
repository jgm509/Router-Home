# Router Home

A simple, phone-friendly web interface for OpenWrt routers, installed next to LuCI at `http://<router>/home`.

Everyday tasks without the expert screens: internet status and live speed, connected devices (rename, pause, bedtime schedule, fixed address), WiFi and QR sharing, internet connections (including joining another WiFi network), data usage, DNS, VPN (WireGuard, Tailscale, Proton VPN), AdGuard Home, 4G/5G modem and eSIM profiles, Thread, Bluetooth LE and Zigbee on routers with a smart-home radio, fan and status light, firmware updates, and full backups that bring your apps back after an update.

LuCI stays available for everything else.

## Install

On the router, over SSH (`ssh root@192.168.1.1`):

```sh
wget -O- https://github.com/jgm509/router-home/releases/latest/download/install.sh | sh
```

It installs what Router Home needs, checks the download's signature and sets everything up. Then open `http://192.168.1.1/home` and sign in with the router's root password.

- **Updates:** Router Home checks GitHub once a day and shows a banner when a new version is out. System → Software → **Update Router Home** installs it in one tap. Settings are kept. You can turn the check off on that same screen.
- **Signed releases:** since 3.2.2, online updates install only if they're signed with the Router Home release key. The router checks them against the key it already has. A `home-ui.tar.gz` you pick yourself on that screen isn't checked, so only use files you trust.
- **In your own firmware build:** copy `home-ui/` to `package/home-ui` and select it in `make menuconfig` (Administration → home-ui).
- **Android app:** download it from the [Releases](https://github.com/jgm509/router-home/releases) page.

More details: [home-ui/README.md](home-ui/README.md#install).

## What's here

| Folder | What it is |
|---|---|
| [`home-ui/`](home-ui/) | The OpenWrt package: web pages, router-side scripts, settings ([README](home-ui/README.md)) |
| [`home-ui/addons/`](home-ui/addons/) | Add-ons for router-specific lights, fans and modems ([how to write one](home-ui/ADDONS.md)) |
| [`home-ui/tools/`](home-ui/tools/) | Release tools: set the version, sign and pack a release ([how](home-ui/README.md#making-a-release)) |
| [`dev/`](dev/) | A simulated router to try and develop the pages on a computer ([README](dev/README.md)) |
| [`android/`](android/) | A small Android app that opens Router Home in its own window ([README](android/README.md)) |

## Works on

Any OpenWrt router (23.05 or newer, with apk or opkg). It needs `luci-base` but not the full LuCI; the installer adds what's missing. Pages for hardware a router doesn't have hide themselves. Tested on the Askey CBE1V1K and SBE1V1K (IPQ9574) and the Spectrum SAX1V1K (IPQ8074). Reports from other routers are welcome; please open an issue with your model and what worked.

## Disclaimer

Router Home is an independent project. It is not affiliated with or endorsed by OpenWrt, Proton AG, Tailscale, AdGuard, Silicon Labs, Askey, Spectrum or any router maker. Use it at your own risk; LuCI remains installed as the fallback.

## License

MIT, see [home-ui/LICENSE](home-ui/LICENSE). Includes the QR code generator by Kazuhiko Arase (MIT).
