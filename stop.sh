#!/bin/zsh
set -euo pipefail
pkill -f 'node server.js' || true
echo 'Stopped KSL Finder UI if running.'
