#!/bin/sh
# Build and sign Router Home for Android.
# Needs Java 17+, apktool_2.12.1.jar and uber-apk-signer-1.3.0.jar in tools/
# (both from their GitHub releases). Bump versionCode in RouterHome/apktool.yml
# for each new version; keep routerhome.keystore, or phones won't accept updates.
set -e
cd "$(dirname "$0")"
rm -rf out
java -jar tools/apktool_2.12.1.jar b RouterHome -o out/unsigned.apk
java -jar tools/uber-apk-signer-1.3.0.jar --apks out/unsigned.apk \
	--ks routerhome.keystore --ksAlias routerhome --ksPass routerhome --ksKeyPass routerhome --out out/signed
cp out/signed/unsigned-aligned-signed.apk RouterHome.apk
echo "Built RouterHome.apk"
