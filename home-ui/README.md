# Router Home (home-ui)

A simple, phone-friendly web interface for OpenWrt, served at **http://192.168.1.1/home**.
LuCI stays installed for advanced settings (System → Advanced settings, or the "Simple mode" entry in LuCI's menu to come back).

One package for any OpenWrt router (23.05 or newer, with apk or opkg). Pages for hardware a router doesn't have (modem, eSIM, fan, status light) hide themselves. Tested on the Askey CBE1V1K and SBE1V1K (IPQ9574) and the Spectrum SAX1V1K (IPQ8074).

## What it does

- **Home**: connection status (same colors as the front light), live download/upload, devices online, carrier signal.
- **Devices**: rename, fixed address, pause internet now, bedtime schedule.
- **WiFi**: network name/password/security, which bands, share with a QR code, add a network; per radio: channel, width, power, country, recommended settings.
- **Internet**: every connection with status, reconnect/stop/start, edit (DHCP, fixed, PPPoE, modem APN/roaming), priority (main/backup), add a connection (port, PPPoE, fixed, modem, or **join a WiFi network** as uplink with a scan), delete.
- **Data usage**: per connection (since start, or monthly with vnstat) and per device per period (needs nlbwmon).
- **Mobile & eSIM** (routers with a 4G/5G modem; ModemManager, or a modem add-on): carrier, 5G/LTE signal, APN, eSIM profiles (list, switch, rename, delete, download with an activation code).
- **DNS**: provider, Cloudflare, Cloudflare for families, Google, Quad9, AdGuard or custom.
- **VPN**: import a WireGuard .conf, create a WireGuard server and add devices with a QR code; Tailscale connect/sign-in, share home network, exit node, firewall setup.
- **Proton VPN** (when `protonvpn-wireguard` is installed; sign-in also needs `luci-app-protonvpn`): sign in with 2FA, connect/disconnect, choose a country or city, change server, kill switch, Proton DNS, Secure Core/Tor, automatic server changes, plan and devices in use, VPN address check.
- **Fan**: found automatically with a `pwm-fan` or `gpio-fan` driver: automatic or manual speed, live temperatures, full speed above 85 °C in manual mode. Fans on a plain GPIO pin (described by an add-on, needs `gpiod-tools`) get software PWM with RPM readout.
- **Status light**: shows whether the internet works on the router's status LED, found automatically from the device tree (`led-running` / `led-failsafe`) or LED names; off until turned on.
- **Add-ons** (System → Add-ons): small folders that add a router's light, fan or modem when Router Home can't find it alone. Add-ons made for a router model are set up automatically on it. See [ADDONS.md](ADDONS.md).
- **System**: name, time zone, admin password, front light, firmware update, backup/restore, log, restart, factory reset.
- **Full backup** (System → Back up → Back up everything): the normal OpenWrt settings backup plus the apps you installed, Router Home itself, sign-ins (Proton, Tailscale) and files you added by hand. Apps still in the OpenWrt feeds are listed and reinstalled (latest version) after a restore; apps that aren't in the feeds are saved in the file and put back only if they are newer than what the new firmware has. Restoring works from Router Home or from LuCI: a one-shot boot hook (`/etc/uci-defaults/95-home-ui-restore`) finishes the job once the router is online, then restarts once. A firmware update from Router Home with "Keep apps" does the same automatically. Log: `/etc/home-ui/restore/log`.

## Add it to your build

1. Copy the `home-ui` folder into your OpenWrt tree as `package/home-ui`.
2. Add one line to your build configuration:
   ```
   CONFIG_PACKAGE_home-ui=y
   ```
   (or `make menuconfig` → Administration → home-ui).
3. Optional extras the pages use if present:
   ```
   CONFIG_PACKAGE_wireguard-tools=y
   CONFIG_PACKAGE_kmod-wireguard=y
   CONFIG_PACKAGE_luci-proto-wireguard=y
   CONFIG_PACKAGE_tailscale=y
   CONFIG_PACKAGE_luci-mod-dashboard=y
   ```
4. `make defconfig && make -j$(nproc)`

## Install as an app (PWA)

System → More → **Install as an app**. Browsers only make a full app (own window, opens while the router restarts) from a secure address. On plain http://192.168.1.1, enable the browser setting "Insecure origins treated as secure" (chrome://flags or brave://flags) for that address first; otherwise you get a home-screen shortcut that opens in a tab.

## Updating

From version 1.3.0 on: System → Software → **Update Router Home**, pick the new `home-ui.tar.gz` (`.tgz` and `.tar` work too). Settings are kept; you sign in again afterwards.

## Try it without rebuilding

Copy `home-ui.tar.gz` to the router's `/tmp`, then:

```
umask 022
cd /tmp && tar xzf home-ui.tar.gz
cp -n home-ui/files/etc/config/* /etc/config/ ; rm -rf home-ui/files/etc/config
cp -r home-ui/files/* /
chmod -R a+rX /www/home /usr/share/home-ui
chmod +x /usr/libexec/rpcd/home-ui /usr/libexec/home-ui/* /usr/sbin/home-ui-* /etc/init.d/home-ui-*
/usr/libexec/home-ui/addon autoinstall
/etc/init.d/rpcd restart
```

## Files

| Path | What it is |
|---|---|
| `www/home/index.html`, `app.css` | Page shell and styles (light and dark) |
| `www/home/core.js` | Login, ubus calls, safe UCI apply with rollback, UI kit, navigation, PWA install |
| `www/home/data.js` | Shared loaders: WiFi radios, connections, connected devices |
| `www/home/home.js` | Home page: status light, live speed, at a glance |
| `www/home/devices.js` | Devices: rename, fixed address, pause, bedtime schedule |
| `www/home/wifi.js` | WiFi networks, radios, QR sharing |
| `www/home/network.js` | Internet connections, Mobile & eSIM, DNS, VPN (WireGuard, Tailscale) |
| `www/home/proton.js` | Proton VPN section (uses the `protonvpn` rpcd object from protonvpn-wireguard) |
| `www/home/system.js` | System: name, time zone, password, light, fan, updates, backup, log |
| `www/home/qr.js` | QR code generator (Kazuhiko Arase, MIT) |
| `www/home/sw.js`, `manifest.webmanifest`, `icons/` | Installable app (PWA) |
| `usr/libexec/rpcd/home-ui` | Backend for things UCI can't do: online check, LEDs, modem, eSIM, Tailscale, WireGuard keys, fan, WiFi info, self-update |
| `usr/libexec/home-ui/esim-job` | Runs lpac in the background (ModemManager paused meanwhile) |
| `usr/libexec/home-ui/self-update` | Installs a new home-ui.tar.gz from the app |
| `usr/sbin/home-ui-fan`, `usr/sbin/home-ui-fan-gpio`, `etc/init.d/home-ui-fan`, `etc/config/fan` | Fan control service (driver fans, GPIO fans) |
| `usr/sbin/home-ui-light`, `etc/init.d/home-ui-light`, `etc/config/home-ui-light`, `usr/share/home-ui/light.sh` | Status light for any router |
| `usr/share/home-ui/addons.sh`, `usr/libexec/home-ui/addon`, `usr/share/home-ui/addons/`, `usr/share/home-ui/catalog/` | Add-ons: helpers, installer, installed add-ons, add-ons shipped with Router Home |
| `addons/` (source only) | Add-on sources and `pack.sh`, which builds the catalog |
| `usr/share/rpcd/acl.d/home-ui.json` | Permissions |
| `usr/share/luci/menu.d/home-ui.json`, `www/luci-static/resources/view/home-ui/open.js` | "Simple mode" link in LuCI |
| `etc/config/home-ui` | Small settings file (WireGuard server public address) |
| `usr/share/home-ui/version` | Installed version |

Every change goes through UCI with rpcd's safe apply: if the router can't confirm the change within 30 seconds (for example you lost the connection), it puts the old settings back by itself.

## Developing on a computer

`dev/` (in the source bundle) has a simulated router so you can work on the pages without touching a real one:

```
node dev/mock-router.js home-ui/files/www 8088 askey,cbe1v1k   # any board name
# open http://localhost:8088/home/  (password: test)
```

`dev/test-*.js` are Playwright scripts that click through the pages and check for errors.
