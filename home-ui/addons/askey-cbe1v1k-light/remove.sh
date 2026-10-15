#!/bin/sh
/etc/init.d/cbe-led stop
/etc/init.d/cbe-led disable
/usr/bin/cbe-led off
exit 0
