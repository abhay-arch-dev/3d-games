#!/usr/bin/env bash
# Builds ../bowling.apk without Gradle, using the Android SDK build tools directly.
set -euo pipefail
cd "$(dirname "$0")"

SDK="${ANDROID_HOME:-/opt/homebrew/share/android-commandlinetools}"
BT="$SDK/build-tools/34.0.0"
JAR="$SDK/platforms/android-34/android.jar"
export JAVA_HOME="${JAVA_HOME:-/opt/homebrew/opt/openjdk@17}"
export PATH="$JAVA_HOME/bin:$PATH"
NM=../node_modules

rm -rf build
mkdir -p build/classes build/dex build/gen build/assets/www/lib/mediapipe/wasm

echo "• Copying game files"
cp -R ../public/. build/assets/www/
cp "$NM/three/build/three.module.min.js" build/assets/www/lib/
cp "$NM/@mediapipe/tasks-vision/vision_bundle.mjs" build/assets/www/lib/mediapipe/
for f in vision_wasm_internal vision_wasm_nosimd_internal; do
  cp "$NM/@mediapipe/tasks-vision/wasm/$f.js" "$NM/@mediapipe/tasks-vision/wasm/$f.wasm" build/assets/www/lib/mediapipe/wasm/
done

echo "• Resources"
"$BT/aapt2" compile --dir res -o build/res.zip
"$BT/aapt2" link -o build/base.apk -I "$JAR" --manifest AndroidManifest.xml \
  -A build/assets --java build/gen build/res.zip \
  --min-sdk-version 26 --target-sdk-version 34 --version-code 1 --version-name 1.0

echo "• Compiling Java"
javac --release 8 -cp "$JAR" -Xlint:-options -d build/classes \
  $(find src build/gen -name '*.java')
"$BT/d8" --min-api 26 --lib "$JAR" --output build/dex $(find build/classes -name '*.class')

echo "• Packaging and signing"
cp build/base.apk build/unsigned.apk
(cd build/dex && zip -q ../unsigned.apk classes.dex)
"$BT/zipalign" -f -p 4 build/unsigned.apk build/aligned.apk
if [ ! -f debug.keystore ]; then
  keytool -genkeypair -keystore debug.keystore -storepass android -keypass android -alias bowling \
    -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=Motion Bowling" >/dev/null 2>&1
fi
"$BT/apksigner" sign --ks debug.keystore --ks-pass pass:android --key-pass pass:android \
  --out ../bowling.apk build/aligned.apk
"$BT/apksigner" verify ../bowling.apk
echo "✓ Built $(cd .. && pwd)/bowling.apk ($(du -h ../bowling.apk | cut -f1))"
