#!/bin/bash
# Double-click to start the JTH assistant. Keep this window open (minimise it).
cd "$(dirname "$0")/.."
# Stop the Mac from sleeping while the assistant runs
caffeinate -dimsu &
while true; do
  node src/cli.js start
  echo "Assistant stopped or crashed. Restarting in 15 seconds... (close this window to stop)"
  sleep 15
done
