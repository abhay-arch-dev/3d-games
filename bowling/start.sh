#!/usr/bin/env bash
# Run this inside Termux on the phone:
#   bash start.sh             camera mode (phone on a stand, facing you)
#   bash start.sh controller  motion mode (phone in your hand)
cd "$(dirname "$0")"

# Keep the server alive while the screen is off or Termux is in the background.
command -v termux-wake-lock >/dev/null && termux-wake-lock

if ! command -v node >/dev/null; then
  echo "Installing Node.js (one time only)..."
  pkg install -y nodejs || exit 1
fi

# Open the controller page in the phone's browser once the server is up.
( sleep 2; command -v termux-open-url >/dev/null && termux-open-url "http://localhost:3000/${1:-camera}" ) &

node server.js
