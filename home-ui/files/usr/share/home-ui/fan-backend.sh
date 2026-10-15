# Which kind of fan does this router have?
#   addon : an installed add-on controls the fan (its handler)
#   pwm   : a Linux fan driver (pwm-fan or gpio-fan) with speed control
#   gpio  : fan on a plain GPIO pin (pin from uci fan.main.gpio or an
#           add-on's "fan_gpio"), speed set by software PWM
#   none  : no controllable fan

. /usr/share/home-ui/addons.sh

fan_hwmon() {
	local d
	for d in ${HWMON_ROOT:-/sys/class/hwmon}/hwmon*; do
		case "$(cat "$d/name" 2>/dev/null)" in pwmfan|gpio_fan|gpiofan) [ -e "$d/pwm1" ] && { echo "$d"; return; } ;; esac
	done
}

fan_gpio() {
	local g
	g="$(uci -q get fan.main.gpio)"
	[ -n "$g" ] || g="$(addon_value fan_gpio.pin)"
	echo "$g"
}

fan_tach() {
	local g
	g="$(uci -q get fan.main.tach_gpio)"
	[ -n "$g" ] || g="$(addon_value fan_gpio.tach)"
	echo "$g"
}

fan_backend() {
	if addon_for fan >/dev/null; then echo addon
	elif [ -n "$(fan_hwmon)" ]; then echo pwm
	elif [ -n "$(fan_gpio)" ] && command -v gpioset >/dev/null 2>&1; then echo gpio
	else echo none
	fi
}
