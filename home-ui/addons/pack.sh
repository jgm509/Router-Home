#!/bin/sh
# Pack every add-on folder here into <id>.tar.gz, in the folder given
# (tools/make-release.sh and the OpenWrt Makefile use it to build the catalog;
# the packed files aren't kept in the source tree).
#   addons/pack.sh /tmp/catalog
set -e
OUT="$1"
[ -n "$OUT" ] || { echo "usage: $0 <output folder>" >&2; exit 1; }
mkdir -p "$OUT"; OUT="$(cd "$OUT" && pwd)"
cd "$(dirname "$0")"
for d in */; do
	id="${d%/}"
	[ -f "$id/addon.json" ] || continue
	tar --owner=0 --group=0 -czf "$OUT/$id.tar.gz" "$id"
	echo "packed $id"
done
