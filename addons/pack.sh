#!/bin/sh
# Pack every add-on folder here into <id>.tar.gz:
#   - into ../files/usr/share/home-ui/catalog/ (shipped with Router Home)
#   - and into ./dist/ (to share or install by hand)
set -e
cd "$(dirname "$0")"
CAT=../files/usr/share/home-ui/catalog
rm -rf "$CAT" dist; mkdir -p "$CAT" dist
for d in */; do
	id="${d%/}"
	[ -f "$id/addon.json" ] || continue
	tar --owner=0 --group=0 -czf "dist/$id.tar.gz" "$id"
	cp "dist/$id.tar.gz" "$CAT/"
	echo "packed $id"
done
