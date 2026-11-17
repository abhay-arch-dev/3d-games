#!/usr/bin/env bash
# Builds bowling.zip: everything the phone needs (about 10 MB, mostly the body-tracking engine).
set -e
cd "$(dirname "$0")/.."
[ -f node_modules/three/build/three.module.min.js ] && [ -d node_modules/@mediapipe/tasks-vision ] || npm install --no-audit --no-fund
rm -f bowling.zip
cd ..
zip -qr bowling/bowling.zip \
  bowling/server.js bowling/start.sh bowling/package.json bowling/public \
  bowling/node_modules/three/build/three.module.min.js \
  bowling/node_modules/@mediapipe/tasks-vision/vision_bundle.mjs \
  bowling/node_modules/@mediapipe/tasks-vision/wasm/vision_wasm_internal.js \
  bowling/node_modules/@mediapipe/tasks-vision/wasm/vision_wasm_internal.wasm \
  bowling/node_modules/@mediapipe/tasks-vision/wasm/vision_wasm_nosimd_internal.js \
  bowling/node_modules/@mediapipe/tasks-vision/wasm/vision_wasm_nosimd_internal.wasm
echo "Created $(pwd)/bowling/bowling.zip ($(du -h bowling/bowling.zip | cut -f1))"
