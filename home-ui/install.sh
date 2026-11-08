#!/bin/sh
# Router Home installer: installs or updates Router Home on an OpenWrt router.
#
#   wget -O- https://github.com/jgm509/router-home/releases/latest/download/install.sh | sh
#
# or, with a home-ui.tar.gz you already copied to the router:
#
#   sh install.sh /tmp/home-ui.tar.gz
#
# Settings are kept on an update. Then open http://<router>/home and sign in
# with the router's root password.

URL=${HOME_UI_URL:-https://github.com/jgm509/router-home/releases/latest/download/home-ui.tar.gz}
TMP=/tmp/home-ui-install
DEPS="rpcd rpcd-mod-file rpcd-mod-iwinfo rpcd-mod-luci rpcd-mod-ucode uhttpd uhttpd-mod-ubus cgi-io jsonfilter luci-base"

say() { printf '%s\n' "$*"; }
die() { printf 'Router Home: %s\n' "$*" >&2; rm -rf "$TMP"; exit 1; }

[ "$(id -u)" = 0 ] || die "run this as root (log in to the router with ssh root@192.168.1.1)."
[ -f /etc/openwrt_release ] || die "this isn't an OpenWrt router."
umask 022
[ -z "$1" ] || [ -s "$1" ] || die "$1 not found."

# --- 1. what Router Home needs ------------------------------------------------
if command -v apk >/dev/null 2>&1; then
	PM=apk; have() { apk info -e "$1" >/dev/null 2>&1; }
elif command -v opkg >/dev/null 2>&1; then
	PM=opkg; have() { opkg list-installed "$1" 2>/dev/null | grep -q "^$1 "; }
else
	die "no package manager (apk or opkg) found."
fi
MISSING=""
for p in $DEPS; do have "$p" || MISSING="$MISSING $p"; done
if [ -n "$MISSING" ]; then
	say "Installing what Router Home needs:$MISSING"
	if [ "$PM" = apk ]; then
		apk update >/dev/null 2>&1; apk add $MISSING || die "could not install:$MISSING (is the router online?)"
	else
		opkg update >/dev/null 2>&1; opkg install $MISSING || die "could not install:$MISSING (is the router online?)"
	fi
fi

# --- 2. the release -----------------------------------------------------------
rm -rf "$TMP"; mkdir -p "$TMP"
if [ -n "$1" ]; then
	cp "$1" "$TMP/home-ui.tar.gz"
else
	say "Downloading Router Home…"
	wget -q -O "$TMP/home-ui.tar.gz" "$URL" || die "the download failed (is the router online? does it have HTTPS support: ca-bundle and libustream?)."
fi
tar -xzf "$TMP/home-ui.tar.gz" -C "$TMP" home-ui/files/usr/libexec/home-ui/self-update 2>/dev/null ||
	die "this file isn't a Router Home release."

# --- 3. install, the same way as an update from the app -----------------------
# (it checks the archive, keeps existing settings, sets permissions, enables the
# services and sets up the add-ons made for this router model)
OUT="$(sh "$TMP/home-ui/files/usr/libexec/home-ui/self-update" "$TMP/home-ui.tar.gz")"
case "$OUT" in
*'"ok":true'*) ;;
*) die "$(printf '%s' "$OUT" | sed -n 's/.*"error":"\([^"]*\)".*/\1/p')" ;;
esac
NEW="$(printf '%s' "$OUT" | sed -n 's/.*"new":"\([^"]*\)".*/\1/p')"
rm -rf "$TMP"

IP="$(uci -q get network.lan.ipaddr | cut -d/ -f1)"
say ""
say "Router Home $NEW is installed."
say "Open http://${IP:-192.168.1.1}/home and sign in with the router's root password."
