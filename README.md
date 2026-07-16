<p align="center">
  <img src="mrclod_logo.png" width="140" alt="MrClod logo" />
</p>

<h1 align="center">MrClod</h1>
<p align="center"><b>Control Claude Code from your phone — from anywhere.</b></p>

<p align="center">
  <img alt="platform" src="https://img.shields.io/badge/desktop-Windows%20%7C%20macOS%20%7C%20Linux-blue">
  <img alt="mobile" src="https://img.shields.io/badge/mobile-Android%20%7C%20iOS-green">
  <img alt="license" src="https://img.shields.io/badge/license-MIT-lightgrey">
</p>

---

## What is this?

**MrClod** is a remote control for [Claude Code](https://claude.com/claude-code).
It lets you start a coding task on your computer, walk away, and keep chatting
with Claude from your phone — over your home Wi-Fi or from anywhere in the
world via a secure tunnel.

Start a task before you leave for lunch. Get a push notification the moment
Claude finishes or needs your input. Reply from your phone. Never babysit a
terminal again.

|                                          |                                                            |
| ---------------------------------------- | ---------------------------------------------------------- |
| 🖥️ **Desktop app**                       | Lives on the machine that has Claude Code installed. Runs the actual `claude` CLI. |
| 📱 **Mobile app**                        | Thin client. Chats, gets notified, sends new prompts.       |
| 🔔 **Push notifications**                | Know instantly when Claude is done or waiting on you.       |
| 🌍 **Works from anywhere**               | LAN by default, or tunnel over the internet with an encrypted `wss://` link. |
| 🌐 **Built-in translation**              | Type in your own language — an interface for it is baked in. |
| 🔒 **Token-paired & encrypted**          | Your phone and desktop pair with a secret token; traffic can run fully encrypted end to end. |

---

## Features

- **Multiple chat sessions** — run more than one Claude Code conversation at once, switch between them from your phone.
- **Model switching** — pick which Claude model handles a session, right from the mobile UI.
- **Permission modes** — `Ask` (Claude requests approval like normal) or `Allow all` (fully autonomous — read the security note below before using this).
- **Offline message queue** — lose Wi-Fi mid-message? It sends the moment you're back online.
- **QR-code pairing** — scan a code on the desktop screen instead of typing an IP address.
- **Chat history** — stored locally on the desktop (SQLite), synced to your phone.
- **Push-style notifications** — desktop hooks fire the instant Claude stops or needs input.

---

## Supported devices

| Component | Supported on |
| --- | --- |
| **Desktop app** | Windows, macOS, Linux (anywhere Claude Code and Rust/Tauri run) |
| **Mobile app**  | Android (APK, installable today) and iOS (buildable from source) |

The mobile app needs a **custom dev/release build**, not the plain Expo Go
app — it uses native modules (`expo-blur`, `react-native-reanimated`, secure
storage, camera for QR scanning) that Expo Go doesn't support.

---

## Download (no build tools needed)

Ready-made installers are on the **[Releases page](https://github.com/Lemxy/MrClod/releases/latest)**:

| Your device | Download this |
| --- | --- |
| 🖥️ Windows | `MrClod-setup.exe` (or `.msi`) |
| 📱 Android phone | `MrClod.apk` |
| 🍎 iOS / macOS | build from source (see below) — no signed build is published yet |

## Beginner's guide — getting started in 10 minutes

### 1. Install the desktop app (Windows)

1. Go to the [Releases page](https://github.com/Lemxy/MrClod/releases/latest).
2. Download `MrClod-setup.exe`.
3. Run it and finish the install wizard (Windows may show a SmartScreen
   warning since the app isn't code-signed — click **More info → Run anyway**).
4. Launch **MrClod** from the Start menu. It opens a window showing your
   computer's local IP address, a port (`7878`), a pairing token, and a QR code.

Requires [Claude Code](https://claude.com/claude-code) already installed and
working on this computer — MrClod runs the `claude` CLI for you, it doesn't
replace it.

### 2. Install the mobile app (Android)

Android blocks installs from outside the Play Store by default, so:

1. On your phone, open the [Releases page](https://github.com/Lemxy/MrClod/releases/latest)
   in a browser (or transfer the file over by USB/cloud storage).
2. Tap `MrClod.apk` to download it.
3. Tap the downloaded file to install. If you see **"blocked by Play Protect"**
   or **"install unknown apps"**, tap **Settings** in that prompt and allow
   installs from your browser/file manager for this one file, then go back
   and install it.
4. Open the **MrClod** app on your phone.

### 3. Pair your phone with the desktop

Make sure your phone is on the **same Wi-Fi network** as the computer, then in
the mobile app either:
- **Scan the QR code** shown in the desktop app, or
- **Type in manually**: the desktop's IP address, port `7878`, and the pairing token.

That's it — you're connected. Send a message from your phone; it runs on your
computer through Claude Code, and the reply streams back to you.

### 4. Using it away from home (optional)

To control your desktop from outside your Wi-Fi network, run an encrypted
tunnel (e.g. a Cloudflare Tunnel) pointing at port `7878`, and pair the
mobile app with the tunnel's `wss://` address instead of the LAN IP.

---

## Building from source (developers / iOS)

Prefer to build it yourself, or need an iOS build? You'll need
[Node.js](https://nodejs.org) (v18+) and [Rust](https://www.rust-lang.org/tools/install).

**Run the desktop app in dev mode:**

```sh
cd desktop
npm install
npm run tauri dev
```

**Run the mobile app on a connected device/emulator:**

```sh
cd mobile
npm install
npx expo run:android   # or: npx expo run:ios (Mac only)
```

**Build your own desktop installer** (`.exe` / `.msi`):

```sh
cd desktop
npx tauri build
```

Output lands in `desktop/src-tauri/target/release/bundle/`.

**Build your own Android APK:**

```sh
cd mobile
npx expo prebuild -p android   # one-time step
cd android
./gradlew assembleRelease
```

Output: `mobile/android/app/build/outputs/apk/release/app-release.apk`. This
build is signed with Android's default debug key — fine for your own devices
or sharing directly, not for a Play Store listing.

---

## ⚠️ Security — please read

Each chat has a **Permissions** setting (mobile: Settings tab; desktop: topbar
dropdown):

- **Ask** (default, recommended) — normal Claude Code permission handling; risky tool calls need your approval.
- **Allow all** — runs Claude with `--dangerously-skip-permissions`. **Anyone who
  has your pairing token gets unattended command execution on your computer.**
  Use only on networks and tokens you fully control.

Other things worth knowing:

- The desktop's WebSocket server listens on all network interfaces — only run it on networks you trust.
- Treat the pairing token like a password.
- Plain `ws://` traffic on LAN is unencrypted. For remote access, always use an encrypted tunnel (`wss://`).

---

## Project layout

```
desktop/                          Tauri (Rust + JS) desktop app
mobile/                           Expo / React Native mobile app
demo-hooks-project/               Example Claude Code hooks that notify the desktop app
stitch_mrclod_remote_companion/   UI design mockups
```

## License

MIT — see [LICENSE](LICENSE).
