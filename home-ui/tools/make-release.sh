#!/bin/sh
# Build a Router Home release, ready to attach to a GitHub release:
#   tools/make-release.sh 3.2.2
# Sets the version everywhere, then writes to ./release/:
#   home-ui.tar.gz      the release (with the add-on catalog packed in)
#   home-ui.tar.gz.sig  its signature (made with ~/router-home-keys/release.sec)
#   install.sh          the one-line installer
set -e
V="$1"
cd "$(dirname "$0")/.."
. tools/usign.sh
SEC="${HOME_UI_KEY:-$HOME/router-home-keys/release.sec}"
PUB=files/usr/share/home-ui/release.pub
die() { echo "make-release: $*" >&2; exit 1; }
[ -s "$SEC" ] || die "no secret key at $SEC (first time? run tools/make-key.sh)"
[ -s "$PUB" ] || die "no $PUB (run tools/make-key.sh)"
grep -q "^KEY='$(sed -n 2p "$PUB")'" install.sh || die "install.sh has a different key than $PUB"

sh tools/set-version.sh "$V"

OUT=release; rm -rf "$OUT"; mkdir "$OUT"
STAGE="$(mktemp -d)"; trap 'rm -rf "$STAGE"' EXIT
mkdir "$STAGE/home-ui"
tar --exclude=./release --exclude=./.git --exclude=./addons/dist -cf - . | tar -xf - -C "$STAGE/home-ui"
rm -rf "$STAGE/home-ui/files/usr/share/home-ui/catalog"
sh addons/pack.sh "$STAGE/home-ui/files/usr/share/home-ui/catalog" >/dev/null
tar --owner=0 --group=0 -C "$STAGE" -czf "$OUT/home-ui.tar.gz" home-ui
! tar tzf "$OUT/home-ui.tar.gz" | grep -qE '\.sec$|keystore|\.jks$' || die "a private key ended up in the release: stopped"

"$USIGN" -S -m "$OUT/home-ui.tar.gz" -s "$SEC" -x "$OUT/home-ui.tar.gz.sig"
"$USIGN" -V -q -m "$OUT/home-ui.tar.gz" -p "$PUB" -x "$OUT/home-ui.tar.gz.sig" || die "the signature doesn't verify"
cp install.sh "$OUT/"

echo ""
echo "Router Home $V is ready in $(pwd)/$OUT:"
ls -l "$OUT" | sed 1d
echo "sha256 $(sha256sum "$OUT/home-ui.tar.gz" | cut -d' ' -f1)"
echo "Attach all three files to the v$V release on GitHub."
