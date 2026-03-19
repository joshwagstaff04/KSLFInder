#!/bin/zsh
set -euo pipefail
cd /Users/joshwagstaff/.openclaw/workspace/ksl-finder
if pgrep -f 'node watcher.js' >/dev/null 2>&1; then
  echo 'KSL watcher already running.'
else
  nohup node watcher.js >/tmp/ksl-watcher.log 2>&1 &
  sleep 1
  echo 'Started KSL watcher.'
fi
