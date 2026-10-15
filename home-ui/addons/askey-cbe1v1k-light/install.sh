#!/bin/sh
command -v i2cset >/dev/null || logger -t home-ui "askey-cbe1v1k-light: install i2c-tools for the LED to work"
/etc/init.d/cbe-led enable
/etc/init.d/cbe-led restart
