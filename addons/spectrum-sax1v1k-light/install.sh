#!/bin/sh
# Nothing here may block: every call that talks to procd is detached, so
# a wedged service can never stop the add-on from being installed.
GPIO="$(uci -q get sax-led.main.green_gpio || echo 32)"
case "$GPIO" in ''|*[!0-9]*) GPIO=32 ;; esac

# clear anything left by an older version of this add-on: stuck
# /etc/init.d/sax-led calls and a gpioset still holding the green pin
for p in /proc/[0-9]*; do
	[ -r "$p/cmdline" ] || continue
	c="$(tr '\0' ' ' < "$p/cmdline" 2>/dev/null)"
	case "$c" in
		*sax-led*|*gpioset*" $GPIO="*) kill "${p#/proc/}" 2>/dev/null ;;
	esac
done
rm -f /var/run/sax-led.hold /var/run/sax-led.green /var/run/sax-led-green.pid

# green needs gpioset while OpenWrt has no green status LED
if ! ls -d /sys/class/leds/*green*status* >/dev/null 2>&1 && ! command -v gpioset >/dev/null; then
	if command -v apk >/dev/null; then
		apk update >/dev/null 2>&1; apk add gpiod-tools >/dev/null 2>&1
	elif command -v opkg >/dev/null; then
		opkg update >/dev/null 2>&1; opkg install gpiod-tools >/dev/null 2>&1
	fi
	command -v gpioset >/dev/null || logger -t home-ui "spectrum-sax1v1k-light: could not install gpiod-tools; green will stay off"
fi

# only one service may drive the front light: turn the others off.
# "disable" only removes the rc.d link; "stop" talks to procd, so it is
# detached in case procd is busy.
for s in status-led home-ui-light; do
	[ -x /etc/init.d/$s ] || continue
	/etc/init.d/$s disable >/dev/null 2>&1
	/etc/init.d/$s stop >/dev/null 2>&1 </dev/null &
done

/etc/init.d/sax-led enable >/dev/null 2>&1
/etc/init.d/sax-led restart >/dev/null 2>&1 </dev/null &
exit 0
