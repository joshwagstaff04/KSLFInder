#!/bin/zsh
set -euo pipefail
pkill -f 'node watcher.js' || true
echo 'Stopped KSL watcher if running.'
