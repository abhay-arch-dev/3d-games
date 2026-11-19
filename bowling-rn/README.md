# 🎳 Motion Bowling: React Native app (TypeScript)

The phone app runs the game server. The TV only needs a browser.

```
Phone (this app)                                         Android TV
  • HTTP + WebSocket server (TypeScript, port 3000)  ⇄ Wi-Fi ⇄  browser → http://<phone-IP>:3000/tv
  • WebView: camera mode (MediaPipe) or motion mode
```

Every source file is TypeScript (`.ts` / `.tsx`):

| Path | What it is |
|---|---|
| `App.tsx`, `src/screens/*.tsx` | RN app: home screen (TV address, mode picker) and the full-screen WebView |
| `src/server/GameServer.ts` | HTTP + WebSocket relay on raw TCP. The app and the desktop dev server both use it. |
| `src/server/startServer.ts` | Runs `GameServer` in the app (react-native-tcp-socket, files read from app assets) |
| `src/server/sha1.ts` | SHA-1, base64 and UTF-8 helpers (Hermes has no `crypto` and no `TextDecoder`) |
| `web/src/game.ts` | 3D game (three.js), physics, scoring, HUD |
| `web/src/camera.ts`, `web/src/gestures.ts` | Body tracking and gesture detection |
| `web/src/controller.ts` | Motion and swipe controller |
| `web/src/protocol.ts` | Typed messages shared by the pages and the server |
| `web/public/` | HTML pages and the pose model |
| `scripts/build-web.ts` | Bundles `web/src` with esbuild into `web/dist` and copies the result into `android/` and `ios/` |
| `scripts/dev-server.ts` | Desktop dev server (Node) that runs the same `GameServer` |

## Run in a desktop browser
```bash
npm install
npm run build:web
npm run serve          # then open http://localhost:3000/tv and http://localhost:3000/controller
```

## Run on an Android phone
Requires JDK 17 and the Android SDK (API 35).
```bash
npm run android        # builds the web game, then the app, and installs it on the connected phone
```
1. Open the app. It shows the TV address, for example `http://192.168.1.23:3000/tv`.
2. On the TV, open that address in a browser (for example TV Bro) and press **OK**.
3. Pick **Camera mode** (phone on a stand) or **Motion mode** (phone in your hand).

See [../bowling/README.md](../bowling/README.md#how-to-play-step-by-step) for how to play, with screenshots.

## iOS
Camera, motion and local-network permission strings are already in `Info.plist`. One manual step remains:
in Xcode, drag `ios/www` into the project as a **folder reference** (blue folder) so the game files are
bundled. Run `npm run build:web` first so the folder exists. Then run `cd ios && bundle exec pod install && cd .. && npm run ios`.

## Checks
```bash
npm run typecheck      # app, web pages and scripts (three tsconfigs)
```
