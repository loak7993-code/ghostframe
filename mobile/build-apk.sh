#!/usr/bin/env bash
# Builds the GhostFrame Android APK (debug, signed with the debug keystore).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# --- environment (persistent paths; do NOT point these into /tmp, it gets cleaned)
export ANDROID_HOME="${ANDROID_HOME:-$HOME/android-sdk}"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export JAVA_HOME="${JAVA_HOME:-/tmp/jdk21}"

cd "$ROOT"

# --- tool bootstrap (skips if present)
if [ ! -x "$ANDROID_HOME/platform-tools/adb" ] && [ ! -d "$ANDROID_HOME/platforms/android-35" ]; then
  echo "[*] installing Android SDK cmdline-tools + platforms into $ANDROID_HOME …"
  mkdir -p "$ANDROID_HOME/cmdline-tools"
  cd "$ANDROID_HOME"
  curl -sL -o cmdtools.zip https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip
  unzip -q cmdtools.zip -d cmdline-tools
  mv cmdline-tools/cmdline-tools cmdline-tools/latest || true
  rm cmdtools.zip
  yes | "$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager" --sdk_root="$ANDROID_HOME" "platform-tools" "platforms;android-35" "build-tools;35.0.0" >/dev/null
  cd "$ROOT"
fi

if [ ! -x "$JAVA_HOME/bin/java" ]; then
  echo "[*] installing portable JDK 21 into $JAVA_HOME …"
  mkdir -p "$JAVA_HOME"
  curl -sL -o /tmp/jdk21.tar.gz "https://api.adoptium.net/v3/binary/latest/21/ga/linux/x64/jdk/hotspot/normal/eclipse"
  tar -xzf /tmp/jdk21.tar.gz -C "$JAVA_HOME" --strip-components=1
fi

# --- project sync
if [ ! -d node_modules/@capacitor ]; then npm install --no-audit --no-fund; fi
if [ ! -d android ]; then npx cap add android; fi
npx cap sync android
[ -f tools/gen-icons.mjs ] && node tools/gen-icons.mjs >/dev/null 2>&1 || true

echo "sdk.dir=$ANDROID_HOME" > android/local.properties

cd android
./gradlew assembleDebug "$@"

APK="$(ls -1 app/build/outputs/apk/debug/*.apk 2>/dev/null | head -1)"
if [ -n "$APK" ]; then
  cp "$APK" "$ROOT/ghostframe.apk"
  echo
  echo "✔ APK: $(du -h "$ROOT/ghostframe.apk" | cut -f1)  $ROOT/ghostframe.apk"
else
  echo "✘ no APK produced"
  exit 1
fi
