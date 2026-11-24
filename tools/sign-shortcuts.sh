#!/bin/bash
# Run on a Mac (macOS 12+) from the repo root: bash tools/sign-shortcuts.sh
set -e
cd "$(dirname "$0")/../public/shortcuts"
for n in Send-Reminders Send-Reminders-Now; do
  shortcuts sign --mode anyone --input "$n.shortcut" --output "$n.signed.shortcut"
  echo "Signed: public/shortcuts/$n.signed.shortcut"
done
