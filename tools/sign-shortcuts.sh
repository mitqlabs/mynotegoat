#!/bin/bash
# Run on a Mac (macOS 12+) that is signed into iCloud, from the repo root:
#   bash tools/sign-shortcuts.sh
# iPhone will not import an unsigned shortcut. `shortcuts sign` is not on Linux,
# and it is not part of the Vercel build. Filling a device code into a signed
# file breaks the signature. Share the shortcut from the Shortcuts app
# (Copy iCloud Link) and set NOTEGOAT_SHORTCUT_ICLOUD_URL to that link.
set -e
cd "$(dirname "$0")/../public/shortcuts"
for n in Send-Reminders Send-Reminders-Now; do
  shortcuts sign --mode anyone --input "$n.shortcut" --output "$n.signed.shortcut"
  echo "Signed: public/shortcuts/$n.signed.shortcut"
done
# Generic NoteGoat shortcut. The device code is an Import Question, not inside the file.
shortcuts sign --mode anyone --input NoteGoat.unsigned.shortcut --output NoteGoat.shortcut
echo "Signed: public/shortcuts/NoteGoat.shortcut"
