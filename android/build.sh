#!/bin/sh
# Builds RouterHome.apk on Linux (Kali, Debian, Ubuntu).
#   sh build.sh
# The first run installs what's missing (Java, the Android SDK in ~/android-sdk)
# and asks where the signing key is; later runs just build.
set -e
cd "$(dirname "$0")"
die() { echo "build: $*" >&2; exit 1; }

# Java 17 or newer
v=$(java -version 2>&1 | sed -n 's/.*version "\([0-9]*\).*/\1/p' | head -1)
if [ -z "$v" ] || [ "$v" -lt 17 ]; then
	echo "== installing Java 21"
	sudo apt-get install -y openjdk-21-jdk-headless
fi

# Android SDK
SDK="${ANDROID_HOME:-$HOME/android-sdk}"
SDKM="$SDK/cmdline-tools/latest/bin/sdkmanager"
if [ ! -x "$SDKM" ]; then
	echo "== downloading the Android SDK tools into $SDK"
	command -v unzip >/dev/null || sudo apt-get install -y unzip
	mkdir -p "$SDK/cmdline-tools"
	T=$(mktemp -d)
	wget -q --show-progress -O "$T/tools.zip" https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip
	unzip -q "$T/tools.zip" -d "$T"
	rm -rf "$SDK/cmdline-tools/latest"
	mv "$T/cmdline-tools" "$SDK/cmdline-tools/latest"
	rm -rf "$T"
fi
if [ ! -d "$SDK/platforms/android-35" ]; then
	echo "== installing Android 15 (API 35) build tools"
	yes | "$SDKM" --sdk_root="$SDK" --licenses >/dev/null
	"$SDKM" --sdk_root="$SDK" "platforms;android-35" "build-tools;35.0.0" "platform-tools"
fi
echo "sdk.dir=$SDK" > local.properties

# Signing key: phones only accept an update signed with the same key as the
# installed app, so use the existing routerhome.keystore
if [ ! -f keystore.properties ]; then
	KS=""
	for f in routerhome.keystore ../routerhome.keystore ../routerhome-android/routerhome.keystore "$HOME/router-home/android/routerhome.keystore"; do
		[ -f "$f" ] && { KS=$(readlink -f "$f"); break; }
	done
	[ -n "$KS" ] || { printf "Where is routerhome.keystore? "; read -r KS; }
	[ -f "$KS" ] || die "no keystore at $KS"
	printf "Keystore password: "; stty -echo; read -r PW; stty echo; echo
	umask 077
	printf 'storeFile=%s\nstorePassword=%s\nkeyAlias=routerhome\nkeyPassword=%s\n' "$KS" "$PW" "$PW" > keystore.properties
	echo "Saved keystore.properties (private: it's in .gitignore, never commit it)"
fi

echo "== building"
./gradlew --no-daemon assembleRelease
cp app/build/outputs/apk/release/app-release.apk RouterHome.apk
echo ""
echo "Built $(pwd)/RouterHome.apk"
echo "Install: copy it to the phone and open it, or with USB debugging: $SDK/platform-tools/adb install -r RouterHome.apk"
