#!/bin/sh
# Make the Router Home release key. Run it once, ever:
#   tools/make-key.sh
#
# Secret key: ~/router-home-keys/release.sec. Keep it private (never on GitHub)
#   and keep a copy somewhere safe: without it, routers can't update online
#   any more and need one manual install of a release signed with a new key.
# Public key: written to files/usr/share/home-ui/release.pub and install.sh,
#   which ship with Router Home and check every online update.
set -e
cd "$(dirname "$0")/.."
. tools/usign.sh
DIR="${HOME_UI_KEYDIR:-$HOME/router-home-keys}"
[ ! -e "$DIR/release.sec" ] || { echo "$DIR/release.sec already exists: keep using it." >&2; exit 1; }
mkdir -p "$DIR"; chmod 700 "$DIR"
"$USIGN" -G -s "$DIR/release.sec" -p "$DIR/release.pub" -c "Router Home release key"
chmod 600 "$DIR/release.sec"
cp "$DIR/release.pub" files/usr/share/home-ui/release.pub
B64="$(sed -n 2p "$DIR/release.pub")"
sed -i "s|^KEY='[^']*'|KEY='$B64'|" install.sh
grep -q "^KEY='$B64'" install.sh || { echo "could not write the key into install.sh" >&2; exit 1; }
echo "Secret key: $DIR/release.sec  (private: back it up, never upload it)"
echo "Public key: files/usr/share/home-ui/release.pub and install.sh"
echo "Key id:     $("$USIGN" -F -p "$DIR/release.pub")"
