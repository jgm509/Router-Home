# Router Home for Android

An Android app for Router Home. App id `app.routerhome`, Android 10 or newer.

- **Router Home's look.** The app uses the theme and accent color you picked in Router Home (Settings → Appearance), and the bars around the screen match.
- **Several routers.** Add each router with a name, its address, and the user and password you sign in with. Tap a router to open its Router Home, already signed in. A router without a root password can be saved as having none, so the app stops asking. Signing out takes you back to the router list.
- **SSH.** Each router has an **SSH** button that opens a terminal on it. The terminal is Termux's: touch and hold to select and copy, pinch to change the text size. There's a key bar for Esc, Tab, Ctrl, the arrow keys and Paste. While you're connected, an "SSH connection open" notification keeps the connection alive when you switch to other apps; tap it to come back.
- **One SSH key per router.** The app remembers each router's SSH host key with the router itself, not with its address. Routers that share an address, like several at 192.168.1.1, don't conflict, and there's no known_hosts file to clean up. After a reflash, the app shows the new key once and asks whether to replace the old one.
- **Deleting a router** also deletes its saved password and SSH key.

## Where things are kept

Everything stays in the app's private storage on the phone:

- **Passwords** are encrypted with a key in the Android keystore. That key never leaves the phone, and app backup is turned off.
- **The router list and SSH keys** don't contain secrets, but they stay private as well.

## Building

### On GitHub

`.github/workflows/android.yml` builds the app whenever something in `android/` changes. You can also start it by hand from **Actions → Android app → Run workflow**. Download `RouterHome-apk` from the run's page. When a release is published, the workflow also attaches `RouterHome.apk` to it.

The workflow signs the app with the key from two repository secrets. Add them once under **Settings → Secrets and variables → Actions → New repository secret**:

- `ANDROID_KEYSTORE`: the keystore file as base64. Run `base64 -w0 routerhome.keystore` and paste what it prints.
- `ANDROID_KEYSTORE_PASSWORD`: its password.

GitHub keeps secrets encrypted. They don't show in logs, and builds triggered by pull requests from forks don't get them.

### On Linux

```sh
sh build.sh
```

The first run installs anything that's missing: Java 21, and the Android SDK in `~/android-sdk`. It then asks where the signing key is. The result is `RouterHome.apk`.

### Version

Raise `appVersionCode` in `app/build.gradle` by one for each release. The version name follows it: 10 is 1.0, 11 is 1.1, 23 is 2.3.

### Signing

A phone only installs an update if it's signed with the same key as the app already on it. Keep using `routerhome.keystore`. **Never commit the keystore or `keystore.properties`.** `.gitignore` already leaves them out.

If you publish your own build, make your own key. Phones with the official app then need to uninstall it before installing yours.

## Inside

| File | What it does |
|---|---|
| `RoutersActivity` + `assets/routers.html` | The router list and the add/edit form. Only this page can change the saved routers. |
| `RouterActivity` | One router's Router Home in a web view. It signs in with the saved password, saves backups to Downloads, and handles file uploads. |
| `TerminalActivity` + `Sheet` | The SSH terminal: [JSch](https://github.com/mwiede/jsch) for the connection, Termux's terminal view for the screen, and Router Home-style sheets for its questions |
| `terminal-emulator/`, `terminal-view/` | Termux's terminal libraries (Apache 2.0) from [termux-app](https://github.com/termux/termux-app). `TerminalSession` is changed to talk to SSH instead of a local shell; see each folder's NOTICE |
| `SshService` | Keeps the app running (foreground service) while an SSH terminal is connected |
| `HostKeys` | SSH host keys kept per router |
| `Routers` | Storage: the router list, encrypted passwords and host keys |

Libraries: JSch (BSD), Bouncy Castle (MIT), Termux terminal-emulator and terminal-view (Apache 2.0), AndroidX WebKit (Apache 2.0).
