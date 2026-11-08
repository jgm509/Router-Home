#!/bin/sh
# Set Router Home's version everywhere it appears, in one go:
#   tools/set-version.sh 3.2.1
# Makefile, usr/share/home-ui/version (shown in the app), the service worker
# cache name and the ?v= cache-busting on every file in index.html.
set -e
V="$1"
echo "$V" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+$' || { echo "usage: $0 X.Y.Z" >&2; exit 1; }
cd "$(dirname "$0")/.."
F=files
sed -i "s/^PKG_VERSION:=.*/PKG_VERSION:=$V/" Makefile
echo "$V" > $F/usr/share/home-ui/version
sed -i "s/^const VERSION = '[^']*';/const VERSION = '$V';/" $F/www/home/sw.js
sed -i "s/?v=[0-9][0-9.]*\"/?v=$V\"/g" $F/www/home/index.html
echo "Version set to $V:"
grep -n '^PKG_VERSION' Makefile
grep -n '^const VERSION' $F/www/home/sw.js
printf 'index.html: %s files now ?v=%s, %s other\n' \
	"$(grep -c "?v=$V\"" $F/www/home/index.html)" "$V" "$(grep -o '?v=[0-9.]*"' $F/www/home/index.html | grep -vc "?v=$V\"")"
