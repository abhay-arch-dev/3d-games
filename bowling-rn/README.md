# Motion Games: React Native app (TypeScript)

The phone app runs the game server. The TV only needs a browser. For how to play, see the [main README](../README.md).

```
Phone (this app)                                              TV
  • HTTP + WebSocket server (port 3000)       ⇄ Wi-Fi ⇄     browser → http://<phone-IP>:3000/tv
  • WebView: camera page (MediaPipe pose) or controller page
```

## How it fits together
- **Picking a game:** the app opens `/camera?game=runner` or `/controller?game=runner` in a WebView. That page sends `{type:'launch', game}`, and whichever TV page is open goes to `/runner`. TV pages announce `{type:'game'}` back, so the phone page adapts, for example by turning the pad into a swipe pad for Track Runner.
- **Camera mode:** the phone runs MediaPipe Pose and streams a mirrored 13-point skeleton to the TV (`{type:'pose'}`, 15–30 per second). Bowling and Paper Toss also receive `pos` and `throw` messages from the phone's arm-swing detector ([gestures.ts](web/src/gestures.ts)). Track Runner and Dance work out lanes, jumps, ducks and limb vectors themselves on the TV from the skeleton ([pose.ts](web/src/pose.ts)).
- **Server:** [GameServer.ts](src/server/GameServer.ts) is a small HTTP + WebSocket relay that passes messages between `tv` and `controller` clients. The same code runs inside the app (react-native-tcp-socket) and on a desktop (Node).

| Path | What it is |
|---|---|
| `App.tsx`, `src/screens/*.tsx` | RN app: game selection, mode picker, full-screen WebView. Landscape only. |
| `src/server/` | `GameServer` (HTTP + WebSocket relay), `startServer` (in-app runner), `sha1` helpers for Hermes |
| `web/src/protocol.ts` | Typed messages, game list (`GAMES`) and URLs |
| `web/src/net.ts` | WebSocket client with reconnect, launch/redirect logic, Back key returns to the game list |
| `web/src/hub.ts` | TV game picker (`/tv`) |
| `web/src/game.ts` | 🎳 Bowling: three.js lane, physics, scoring, 2-player turns (`/bowling`) |
| `web/src/paper.ts` | 🗑️ Paper Toss: projectile with drag and wind, bin rim collisions (`/paper`) |
| `web/src/runner.ts` | 🏃 Track Runner: lanes, obstacles, coins, pose-based jump/duck/lane detection (`/runner`) |
| `web/src/dance.ts` | 💃 Dance: poses built from 8 limb angles, cosine scoring, generated music (`/dance`) |
| `web/src/pose.ts` | Shared skeleton helpers: limb vectors, stick-figure drawing, poses from angles |
| `web/src/camera.ts`, `gestures.ts` | Body tracking on the phone, arm-swing throw detection |
| `web/src/controller.ts` | Motion/swipe controller (phone in hand) |
| `web/public/` | HTML pages, shared `tv.css`, pose model |
| `scripts/build-web.ts` | Bundles `web/src` with esbuild into `web/dist` and copies the result into `android/` and `ios/` |
| `scripts/dev-server.ts` | Desktop dev server running the same `GameServer` |

## Run in a desktop browser
```bash
npm install
npm run build:web
npm run serve
```
Open `http://localhost:3000/tv` (the TV) and `http://localhost:3000/controller?game=paper` (a phone) in two windows.
Every TV page can also be played with the keyboard: arrow keys, Enter, and Escape to return to the game list.
The camera page needs a secure origin, so on a desktop only `localhost` works.

## Build and install on your phone
Requirements: **JDK 17** and the **Android SDK** (platform 35, build-tools 35, NDK 26.1). On macOS with Homebrew:
```bash
brew install openjdk@17 && brew install --cask android-commandlinetools android-platform-tools
export JAVA_HOME=/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home
export ANDROID_HOME=~/Library/Android/sdk
yes | sdkmanager --sdk_root=$ANDROID_HOME --licenses
sdkmanager --sdk_root=$ANDROID_HOME "platform-tools" "platforms;android-35" "build-tools;35.0.0" "ndk;26.1.10909125"
echo "sdk.dir=$ANDROID_HOME" > android/local.properties
```
Then, with the phone connected over USB and **USB debugging** turned on (accept the prompt on the phone):
```bash
npm run build:web -- --minify
cd android && ./gradlew assembleRelease
adb install -r app/build/outputs/apk/release/app-release.apk
```
The release build bundles the JavaScript, so it runs without a computer. `npm run android` builds a *debug* app instead, which needs Metro (`npm start`) running on your computer.

> **Signing:** release builds are currently signed with the React Native template's shared `debug.keystore`. That's fine for sideloading on your own devices. Before publishing anywhere public, create your own keystore (see [docs/ROADMAP.md](../docs/ROADMAP.md)). Android only accepts updates signed with the same key, so switching keys later means users have to uninstall first.

## iOS
Camera, motion and local-network permission strings are already in `Info.plist`, and the app is landscape only. One manual step remains:
in Xcode, drag `ios/www` into the project as a **folder reference** (blue folder) so the game files are
bundled. Run `npm run build:web` first so the folder exists. Then run `cd ios && bundle exec pod install && cd .. && npm run ios`.

## Checks
```bash
npm run typecheck      # app, web pages and scripts (three tsconfigs)
```
Each TV page exposes a small test hook in the browser console (`window.__bowling`, `__paper`, `__runner`, `__dance`) for driving the game without a phone.
