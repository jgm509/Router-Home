#!/bin/sh
/etc/init.d/sax-led disable >/dev/null 2>&1
/etc/init.d/sax-led stop >/dev/null 2>&1 </dev/null &
for p in /proc/[0-9]*; do
	[ -r "$p/cmdline" ] || continue
	c="$(tr '\0' ' ' < "$p/cmdline" 2>/dev/null)"
	case "$c" in *sax-led-status*|*gpioset*" 32="*) kill "${p#/proc/}" 2>/dev/null ;; esac
done
/usr/bin/sax-led off >/dev/null 2>&1
rm -f /var/run/sax-led.hold /var/run/sax-led.green
# give the light back to the older status service, if it is there
[ -x /etc/init.d/status-led ] && {
	/etc/init.d/status-led enable >/dev/null 2>&1
	/etc/init.d/status-led start >/dev/null 2>&1 </dev/null &
}
exit 0
