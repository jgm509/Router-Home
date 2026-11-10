#!/bin/sh
# Router Home installer: installs or updates Router Home on an OpenWrt router.
#
#   wget -O- https://raw.githubusercontent.com/jgm509/router-home/main/home-ui/install.sh | sh
#
# or, with a home-ui.tar.gz you already copied to the router:
#
#   sh install.sh /tmp/home-ui.tar.gz
#
# Settings are kept on an update. Then open http://<router>/home and sign in
# with the router's root password.

REPO=${HOME_UI_REPO:-jgm509/router-home}
URL=$HOME_UI_URL	# a direct link to a home-ui.tar.gz, instead of the latest release
TMP=/tmp/home-ui-install
# The Router Home release key (public half; tools/make-key.sh writes it here).
# A downloaded release must carry a signature made with it.
KEY='RWTOoFjNJn+QW24Rfhp2T5Xl6Wr/tz6n057P49tkvdQ0Bx/R+R6ng6xL'
DEPS="rpcd rpcd-mod-file rpcd-mod-iwinfo rpcd-mod-luci rpcd-mod-ucode uhttpd uhttpd-mod-ubus cgi-io jsonfilter luci-base usign"

say() { printf '%s\n' "$*"; }
# get <url> <file> [json]: curl if there is one, else OpenWrt's wget
get() {
	local acc="application/octet-stream"
	[ "$3" = json ] && acc="application/vnd.github+json"
	if command -v curl >/dev/null 2>&1; then
		curl -fsSL -m 300 -A "RouterHome-installer" -H "Accept: $acc" -o "$2" "$1"
	else
		wget -q -T 30 -U "RouterHome-installer" --header "Accept: $acc" -O "$2" "$1"
	fi
}
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
	if [ -z "$URL" ]; then
		# Through GitHub's API: OpenWrt's wget stalls on the github.com web pages
		# (a header line longer than its 4 KB buffer), the API is fine.
		get "https://api.github.com/repos/$REPO/releases/latest" "$TMP/release.json" json ||
			die "could not reach GitHub (is the router online? does it have HTTPS support: ca-bundle and libustream?)."
		URL=$(jsonfilter -i "$TMP/release.json" -e '@.assets[@.name="home-ui.tar.gz"].url' 2>/dev/null)
		SIGURL=$(jsonfilter -i "$TMP/release.json" -e '@.assets[@.name="home-ui.tar.gz.sig"].url' 2>/dev/null)
		[ -n "$URL" ] || die "the latest release has no home-ui.tar.gz."
	else
		SIGURL="$URL.sig"
	fi
	get "$URL" "$TMP/home-ui.tar.gz" || die "the download failed (is the router online?)."
	if [ -n "$KEY" ]; then
		[ -n "$SIGURL" ] || die "the latest release isn't signed (no home-ui.tar.gz.sig): not installed."
		get "$SIGURL" "$TMP/home-ui.tar.gz.sig" || die "the signature download failed (home-ui.tar.gz.sig)."
		printf 'untrusted comment: Router Home release key\n%s\n' "$KEY" > "$TMP/release.pub"
		usign -V -q -m "$TMP/home-ui.tar.gz" -p "$TMP/release.pub" -x "$TMP/home-ui.tar.gz.sig" ||
			die "the download isn't signed with the Router Home release key: not installed."
		say "Signature checked."
	fi
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
say "Already open in a browser or the app? Reload it to use the new version."
