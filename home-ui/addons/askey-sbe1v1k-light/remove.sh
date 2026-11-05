#!/bin/sh
/etc/init.d/sbe-rgb-led stop
/etc/init.d/sbe-rgb-led disable
/usr/bin/sbe-rgb-led off
# give the light back to the firmware's own service, if it has one
for s in sbe-led status-led; do
	[ -x /etc/init.d/$s ] && { /etc/init.d/$s enable; /etc/init.d/$s start; break; }
done
exit 0
