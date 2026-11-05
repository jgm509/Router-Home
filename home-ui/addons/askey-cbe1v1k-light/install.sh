#!/bin/sh
# The light chip is driven over I2C with i2cset (package i2c-tools).
if ! command -v i2cset >/dev/null; then
	if command -v apk >/dev/null; then
		apk update >/dev/null 2>&1; apk add i2c-tools >/dev/null 2>&1
	elif command -v opkg >/dev/null; then
		opkg update >/dev/null 2>&1; opkg install i2c-tools >/dev/null 2>&1
	fi
	command -v i2cset >/dev/null || logger -t home-ui "askey-cbe1v1k-light: could not install i2c-tools; install it by hand for the light to work"
fi
# only one service may drive the front light: turn the others off
for s in home-ui-light status-led; do
	[ -x /etc/init.d/$s ] || continue
	/etc/init.d/$s stop >/dev/null 2>&1
	/etc/init.d/$s disable >/dev/null 2>&1
done
/etc/init.d/cbe-led enable
/etc/init.d/cbe-led restart
