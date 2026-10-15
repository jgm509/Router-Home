# Router Home add-ons: shared helpers (sourced by the backend and services).
#
# An add-on lives in /usr/share/home-ui/addons/<id>/ and has an addon.json:
#   { "id": "...", "name": "...", "version": "1.0.0",
#     "boards": ["vendor,model"] or ["*"],
#     "provides": { "led": true, "fan": true, "modem": true },
#     "fan_gpio": { "pin": 27, "tach": 29 } }       (optional, no code needed)
# and, for anything in "provides", an executable "handler":
#   handler <led|fan|modem> <action>   (JSON arguments on stdin, JSON out)
# An optional executable "detect" can refuse to run on routers it doesn't fit.
# See ADDONS.md for the full description.

ADDONS_DIR=/usr/share/home-ui/addons

addon_board() { cat /tmp/sysinfo/board_name 2>/dev/null; }

# does the add-on in $1 apply to this router?
addon_applies() {
	local d="$1" board
	[ -f "$d/addon.json" ] || return 1
	board="$(addon_board)"
	# read the list line by line: an unquoted "*" would match file names
	jsonfilter -i "$d/addon.json" -e '@.boards[*]' 2>/dev/null | grep -qxF -e '*' -e "$board" || return 1
	if [ -x "$d/detect" ]; then "$d/detect" >/dev/null 2>&1 || return 1; fi
	return 0
}

# first add-on for this router that provides capability $1 (led|fan|modem)
addon_for() {
	local d
	for d in "$ADDONS_DIR"/*/; do
		d="${d%/}"
		[ "$(jsonfilter -i "$d/addon.json" -e "@.provides.$1" 2>/dev/null)" = true ] || continue
		[ -x "$d/handler" ] || continue
		addon_applies "$d" && { echo "$d"; return 0; }
	done
	return 1
}

# a value from the first applying add-on that sets it, e.g. addon_value fan_gpio.pin
addon_value() {
	local d v
	for d in "$ADDONS_DIR"/*/; do
		d="${d%/}"
		v="$(jsonfilter -i "$d/addon.json" -e "@.$1" 2>/dev/null)"
		[ -n "$v" ] || continue
		addon_applies "$d" && { echo "$v"; return 0; }
	done
	return 1
}

# addon_call <dir> <capability> <action> [json]; prints the handler's JSON
addon_call() {
	local out args="$4"
	[ -n "$args" ] || args='{}'
	out="$(printf '%s' "$args" | "$1/handler" "$2" "$3" 2>/dev/null)"
	case "$out" in
		\{*) printf '%s\n' "$out" ;;
		*) printf '{"error":"The add-on %s did not answer %s %s"}\n' "$(basename "$1")" "$2" "$3" ;;
	esac
}
