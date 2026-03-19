#!/bin/zsh
set -euo pipefail
cd /Users/joshwagstaff/.openclaw/workspace/ksl-finder
if pgrep -f 'node server.js' >/dev/null 2>&1; then
  echo 'KSL Finder UI already running.'
else
  nohup node server.js >/tmp/ksl-finder.log 2>&1 &
  sleep 1
  echo 'Started KSL Finder UI.'
fi
open http://localhost:3091
