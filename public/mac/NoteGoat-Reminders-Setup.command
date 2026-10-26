#!/bin/bash
# NoteGoat text reminders: one-click iMac setup.
# Double-click in Finder (first time: right-click > Open). Runs in Terminal.
RAW="https://raw.githubusercontent.com/mitqlabs/mynotegoat/main/tools/mac-reminders"
DIR="$HOME/notegoat-reminders"

finish() {
  echo
  if [ "$1" = ok ]; then
    echo "=============================================="
    echo "  ✅ All set! This Mac will send NoteGoat text reminders."
    echo "=============================================="
  else
    echo "=============================================="
    echo "  ❌ Setup did not finish: $2"
    echo "  Nothing was sent. Fix the problem and double-click this file again."
    echo "=============================================="
  fi
  echo
  read -r -p "Press Return to close." _
  exit 0
}

clear
cat <<'TXT'
NoteGoat text reminders — iMac setup
------------------------------------
This will:
  1. Download the NoteGoat reminder sender into ~/notegoat-reminders
  2. Ask for your device code (starts with ngr_). Copy it from
     NoteGoat > Settings > Text Reminders > + Add Mac.
     It is saved in your Mac's Keychain, never in a file.
  3. Test the connection to NoteGoat.
  4. Set this Mac to wake up every day at 8:45 AM (asks for your Mac password).

Before you start: open Messages and make sure it's signed in to the office Apple ID.
Nothing is texted during setup.
TXT
echo
read -r -p "Press Return to start (or close this window to cancel)." _

echo; echo "Step 1 of 4: Downloading…"
mkdir -p "$DIR" || finish fail "could not create $DIR"
for f in install.sh notegoat-reminders.sh uninstall.sh; do
  curl -fsSL "$RAW/$f" -o "$DIR/$f" || finish fail "could not download $f (check the internet connection)"
done
chmod 755 "$DIR"/*.sh
echo "✓ Downloaded."

echo; echo "Step 2–3 of 4: Paste your ngr_ code and press Return (nothing shows while pasting — that's normal)."
bash "$DIR/install.sh" || finish fail "the code was not accepted or the connection test failed"

echo; echo "Step 4 of 4: Daily wake-up at 8:45 AM."
echo "macOS will now ask for your Mac password (the one you use to log in)."
echo "Nothing shows while you type it — that's normal. Press Return when done."
if sudo pmset repeat wakeorpoweron MTWRFSU 08:45:00; then
  echo "✓ This Mac will wake every day at 8:45 AM."
else
  echo "⚠ Couldn't set the daily wake-up. Reminders still work while the Mac is awake."
fi

echo
echo "The first time it sends, macOS asks to let it control Messages — click OK."
echo "To remove later: bash ~/notegoat-reminders/uninstall.sh"
finish ok
