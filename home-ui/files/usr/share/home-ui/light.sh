# Router Home: find a router's status light without per-model setup.
#
# OpenWrt device trees mark the system LEDs with aliases: led-running (normal
# operation), led-failsafe / led-upgrade (problems), led-boot. Those point at
# LEDs in /sys/class/leds. When a device tree has no aliases, LEDs named like
# "<color>:status|power|system" are used instead.
#   light_ok   -> LED that means "online"   (green, blue or white)
#   light_bad  -> LED that means "offline"  (red, amber, orange) or empty;
#                 with no second LED, the "online" LED blinks instead

LEDS=${LEDS:-/sys/class/leds}
DT=${DT:-/proc/device-tree}

# LED name for a device-tree alias, as OpenWrt's diag.sh does it
_light_alias() {
	local a="$DT/aliases/$1" node label color fn
	[ -f "$a" ] || return 1
	node="$DT$(tr -d '\0' < "$a")"
	[ -d "$node" ] || return 1
	if [ -f "$node/label" ]; then
		label="$(tr -d '\0' < "$node/label")"
	else
		[ -f "$node/function" ] && fn="$(tr -d '\0' < "$node/function")"
		if [ -f "$node/color" ]; then
			# dt-bindings/leds/common.h colour numbers
			case "$( (hexdump -v -e '1/1 "%u."' "$node/color" 2>/dev/null || od -An -v -tu1 "$node/color" 2>/dev/null | tr -s ' \n' '..' | sed 's/^\.//') | awk -F. '{print $4}')" in
				0) color=white ;; 1) color=red ;; 2) color=green ;; 3) color=blue ;; 4) color=amber ;;
				5) color=violet ;; 6) color=yellow ;; 7) color=ir ;; 8) color=multi ;; 9) color=rgb ;;
				10) color=purple ;; 11) color=orange ;; 12) color=pink ;; 13) color=cyan ;; 14) color=lime ;;
			esac
		fi
		[ -n "$color$fn" ] && label="${color}:${fn}"
	fi
	[ -n "$label" ] && [ -d "$LEDS/$label" ] && { echo "$LEDS/$label"; return 0; }
	# label didn't match a sysfs name exactly: try a suffix match
	[ -n "$label" ] && for d in "$LEDS"/*"$label"; do [ -d "$d" ] && { echo "$d"; return 0; }; done
	return 1
}

_light_color() {	# colour word of a sysfs LED name
	case "${1##*/}" in
		*red*) echo red ;; *amber*|*orange*|*yellow*) echo amber ;;
		*green*) echo green ;; *blue*) echo blue ;; *white*) echo white ;;
		*) echo other ;;
	esac
}

_light_by_name() {	# $1 = good|bad
	local d c
	for d in "$LEDS"/*; do
		[ -d "$d" ] || continue
		case "${d##*/}" in *status*|*power*|*system*|*:sys*|*sys_led*|*:info*) ;; *) continue ;; esac
		c="$(_light_color "$d")"
		case "$1:$c" in
			good:green|good:blue|good:white|bad:red|bad:amber) echo "$d"; return 0 ;;
		esac
	done
	return 1
}

light_ok() {
	local d
	d="$(uci -q get home-ui-light.main.ok_led)"
	[ -n "$d" ] && [ -d "$LEDS/$d" ] && { echo "$LEDS/$d"; return 0; }
	_light_alias led-running || _light_alias led-boot || _light_by_name good
}

light_bad() {
	local d ok a
	d="$(uci -q get home-ui-light.main.bad_led)"
	[ -n "$d" ] && [ -d "$LEDS/$d" ] && { echo "$LEDS/$d"; return 0; }
	ok="$(light_ok)"
	for a in led-failsafe led-upgrade; do
		d="$(_light_alias $a)" && [ "$d" != "$ok" ] && { echo "$d"; return 0; }
	done
	d="$(_light_by_name bad)" && [ "$d" != "$ok" ] && { echo "$d"; return 0; }
	return 1
}

# set one LED: light_set <path> on|off|blink
light_set() {
	[ -n "$1" ] && [ -d "$1" ] || return 0
	case "$2" in
		on)    echo none > "$1/trigger" 2>/dev/null; cat "$1/max_brightness" > "$1/brightness" 2>/dev/null || echo 1 > "$1/brightness" ;;
		off)   echo none > "$1/trigger" 2>/dev/null; echo 0 > "$1/brightness" ;;
		blink) echo timer > "$1/trigger" 2>/dev/null && { echo 500 > "$1/delay_on"; echo 500 > "$1/delay_off"; } ;;
	esac
}
