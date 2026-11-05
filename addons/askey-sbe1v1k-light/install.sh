#!/bin/sh
# only one service may drive the front light: turn the others off
for s in sbe-led status-led home-ui-light; do
	[ -x /etc/init.d/$s ] || continue
	/etc/init.d/$s stop >/dev/null 2>&1
	/etc/init.d/$s disable >/dev/null 2>&1
done
/etc/init.d/sbe-rgb-led enable
/etc/init.d/sbe-rgb-led restart
