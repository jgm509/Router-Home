# Router Home add-ons

Router Home works on any OpenWrt router. For the parts that depend on the hardware, it first tries to find things on its own:

| Part | Found automatically when… |
|---|---|
| **Fan** | the firmware has a `pwm-fan` or `gpio-fan` driver (shows in `/sys/class/hwmon`) |
| **Status light** | the device tree marks the status LEDs (`led-running`, `led-failsafe` aliases), or LEDs are named like `green:status`, `red:power` |
| **Modem** | ModemManager manages the modem (most USB/PCIe 4G/5G modems) |

When that isn't enough (a light behind a special chip, a fan the firmware doesn't describe, a modem without ModemManager), an **add-on** fills the gap. Add-ons are small folders, installed from **System → Add-ons** in Router Home. Add-ons made for a router model are set up automatically on that model.

> Add-ons run with full control of the router. Only install add-ons from people you trust, and read the files of one you get from somewhere else.

---

## The folder

```
my-router-light/            folder name = add-on id (a-z, 0-9, . _ -)
├── addon.json              required
├── handler                 answers Router Home (needed for led, fan, modem)
├── detect                  optional: exit 0 only on routers it fits
├── files/                  optional: copied to / when installed
├── install.sh              optional: runs after the files are copied
└── remove.sh               optional: runs before the add-on is removed
```

Pack it with the folder at the top of the archive:

```
tar -czf my-router-light.tar.gz my-router-light
```

### addon.json

```json
{
	"id": "my-router-light",
	"name": "My Router front light",
	"version": "1.0.0",
	"author": "your name or handle",
	"description": "One or two sentences shown in Router Home.",
	"boards": ["vendor,model"],
	"provides": { "led": true }
}
```

- **boards**: the router models it's for, as in `/tmp/sysinfo/board_name` (`cat /tmp/sysinfo/board_name` on the router). Use `["*"]` for an add-on that can work on any router; then add a `detect` script so it only turns on where it fits.
- **provides**: any of `led`, `fan`, `modem`. Each one needs the `handler`.
- **fan_gpio** (instead of a handler, for a fan on a plain GPIO pin):
  `"fan_gpio": { "pin": 27, "tach": 29 }`. Router Home then runs the fan with software PWM and reads the speed sensor (needs `gpiod-tools`). `tach` is optional.

### files/

Everything in `files/` is copied to the router at the same path: `files/usr/bin/my-led` becomes `/usr/bin/my-led`. Files in `files/etc/config/` are only copied when the router doesn't have them yet, so updating an add-on keeps the user's settings. Removing the add-on deletes its files but keeps settings.

No links, no paths with `..`.

---

## The handler

Router Home runs:

```
handler <capability> <action>
```

with the arguments as JSON on standard input, and reads one JSON object from standard output. Answer `{"error":"message"}` when something fails; the message is shown to the user. Keep it quick (a few seconds at most). Start long work in the background.

The shell library `jshn` makes reading the input easy:

```sh
#!/bin/sh
. /usr/share/libubox/jshn.sh
json_load "$(cat)"
case "$1 $2" in
"led info") ... ;;
esac
```

### led

| Action | Input | Output |
|---|---|---|
| `info` | `{}` | `{"enabled":true, "brightness":96 or null, "description":"Blue: online · red: no internet", "colors":[{"id":"blue","label":"Online","css":"#3b7cff"}, …]}` |
| `set` | `{"enabled":true, "brightness":96 or null}` | `{"ok":true}` |
| `test` | `{"color":"<one of the ids from info>"}` | `{"ok":true}`; show that color for about 4 seconds, then go back to the real status |

`brightness: null` hides the brightness slider. `css` is any CSS background (a color or a gradient) for the swatch in Router Home.

The add-on is responsible for actually showing the status, usually with a small service in `files/etc/init.d/` that `install.sh` enables.

### fan

| Action | Input | Output |
|---|---|---|
| `status` | `{}` | `{"available":true, "kind":"pwm" or "onoff", "mode":"auto" or "manual", "speed":50, "pwm":0-255, "rpm":2400, "safety_temp":85, "temps":[{"name":"cpu-thermal","temp":52000}]}` |
| `set` | `{"mode":"auto" or "manual", "speed":0-100}` | `{"ok":true}` |

`kind: "onoff"` shows Automatic / Always on / Off instead of a speed slider. Temperatures are in millidegrees, like `/sys/class/thermal`. In manual mode, run the fan at full speed above `safety_temp`.

### modem

| Action | Input | Output |
|---|---|---|
| `status` | `{}` | `{"simple":{…}}` (below) or `{"error":"No modem found"}` |

```json
{"simple": {
	"carrier": "Example Mobile",
	"state": "connected",
	"tech": "lte",
	"quality": 72,
	"registration": "home",
	"lte": {"rsrp": -95, "rsrq": -11, "sinr": 12},
	"nr":  {"rsrp": -98, "rsrq": -12, "sinr": 9},
	"ip": "10.20.30.40",
	"imei": "…",
	"model": "…"
}}
```

- `tech`: `5gnr`, `lte`, `umts` or `gsm`
- `quality`: 0–100
- `registration`: `home`, `roaming`, `searching`, `denied` or `idle`
- Leave out whatever the modem can't tell (`nr`, `ip`, …)

The connection itself (APN and so on) stays a normal OpenWrt network interface, edited in Router Home's Internet page.

---

## Examples

These come with Router Home (in `addons/` of the source):

| Add-on | Shows how to |
|---|---|
| `askey-cbe1v1k-light` | drive an LED behind an I2C chip: `files/` with a program and a service, a handler for `led`, install/remove scripts |
| `spectrum-sax1v1k-fan` | describe a fan on a GPIO pin with no code at all (`fan_gpio`) |
| `qmi-modem` | report modem status from `uqmi`, for any router (`"boards": ["*"]` plus `detect`) |

## Testing on the router

```
cat /tmp/sysinfo/board_name                                  # your board name
echo '{}' | /usr/share/home-ui/addons/<id>/handler led info  # call the handler by hand
logread -e home-ui                                           # install messages
```

Install your add-on from System → Add-ons → Install from file, then open the matching page (System → Front light, the fan, or Internet → Mobile).

## Sharing

Share the `.tar.gz`. If you'd like it shipped with Router Home, send the folder; add-ons whose `boards` list a specific model are then set up automatically on that model.
