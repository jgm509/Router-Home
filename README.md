# Router Home

A simple, phone-friendly web interface for OpenWrt routers, installed next to LuCI at `http://<router>/home`.

Everyday tasks without the expert screens: internet status and live speed, connected devices (rename, pause, bedtime schedule, fixed address), WiFi and QR sharing, internet connections (including joining another WiFi network), data usage, DNS, VPN (WireGuard, Tailscale, Proton VPN), 4G/5G modem and eSIM profiles, fan and status light, firmware updates, and full backups that bring your apps back after an update.

LuCI stays available for everything else.

## Download

Get `home-ui.tar.gz` (and the Android app, if you want it) from the **Releases** page.

- **Router Home already installed:** System → Update Router Home → pick `home-ui.tar.gz`.
- **First install:** see [home-ui/README.md](home-ui/README.md#try-it-without-rebuilding).
- **In your own firmware build:** copy `home-ui/` to `package/home-ui` and select it in `make menuconfig` (Administration → home-ui).

## What's here

| Folder | What it is |
|---|---|
| [`home-ui/`](home-ui/) | The OpenWrt package: web pages, router-side scripts, settings ([README](home-ui/README.md)) |
| [`home-ui/addons/`](home-ui/addons/) | Add-ons for router-specific lights, fans and modems ([how to write one](home-ui/ADDONS.md)) |
| [`dev/`](dev/) | A simulated router to try and develop the pages on a computer ([README](dev/README.md)) |
| [`android/`](android/) | A small Android app that opens Router Home in its own window ([README](android/README.md)) |

## Works on

Any OpenWrt router (23.05 or newer). Pages for hardware a router doesn't have hide themselves. Tested on the Askey CBE1V1K and SBE1V1K (IPQ9574) and the Spectrum SAX1V1K (IPQ8074). Reports from other routers are welcome; please open an issue with your model and what worked.

## Disclaimer

Router Home is an independent project. It is not affiliated with or endorsed by OpenWrt, Proton AG, Tailscale, Askey, Spectrum or any router maker. Use it at your own risk; LuCI remains installed as the fallback.

## License

MIT, see [home-ui/LICENSE](home-ui/LICENSE). Includes the QR code generator by Kazuhiko Arase (MIT).
