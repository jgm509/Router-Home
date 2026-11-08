# Finds usign for the tools here (sourced, sets $USIGN). An OpenWrt build tree
# already has one: <tree>/staging_dir/host/bin/usign.
USIGN="${USIGN:-$(command -v usign 2>/dev/null || true)}"
if [ -z "$USIGN" ]; then
	for u in "$HOME"/openwrt*/staging_dir/host/bin/usign; do
		[ -x "$u" ] && { USIGN="$u"; break; }
	done
fi
[ -n "$USIGN" ] || { echo "usign not found: build OpenWrt once, or set USIGN=/path/to/usign" >&2; exit 1; }
