# Router Home for Android

A small app that opens Router Home (http://<router>/home) in its own window, for launchers that don't support installed web apps. App id: `app.routerhome`.

- `RouterHome/`: the app in apktool form (smali code, manifest, resources, `assets/start.html` for the first-start and offline screens)
- `build.sh`: builds and signs `RouterHome.apk`. Needs Java 17+, `apktool_2.12.1.jar` and `uber-apk-signer-1.3.0.jar` in `tools/` (from their GitHub releases)
- Signing key: not included. Make your own with `keytool -genkeypair -keystore routerhome.keystore -alias routerhome -keyalg RSA -keysize 2048 -validity 10000` (build.sh expects the password `routerhome`; change it there). Phones only accept updates signed with the same key, so keep it safe and private.

Bump `versionCode` in `RouterHome/apktool.yml` for each new version.
