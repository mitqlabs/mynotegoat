#!/bin/bash
# Installs NoteGoat text reminders on this Mac (current user only).
# - asks for the device token from NoteGoat Settings → Text Reminders
# - stores it in your login Keychain (never in a file)
# - installs the sender script and a launchd job that runs daily at 8:00
set -eu
HERE="$(cd "$(dirname "$0")" && pwd)"
APP_DIR="${NG_APP_DIR:-$HOME/Library/Application Support/NoteGoat}"
AGENTS_DIR="${NG_AGENTS_DIR:-$HOME/Library/LaunchAgents}"
LOG_DIR="${NG_LOG_DIR:-$HOME/Library/Logs/NoteGoat}"
LABEL="com.notegoat.reminders"
PLIST="$AGENTS_DIR/$LABEL.plist"
SECURITY="${NG_SECURITY:-/usr/bin/security}"
LAUNCHCTL="${NG_LAUNCHCTL:-/bin/launchctl}"
HOUR="${NG_HOUR:-8}"

[ -f "$HERE/notegoat-reminders.sh" ] || { echo "notegoat-reminders.sh must be next to install.sh"; exit 1; }

TOKEN="${NG_TOKEN:-}"
if [ -z "$TOKEN" ]; then
  printf "Paste the device token from NoteGoat (Settings → Text Reminders → + Add device): "
  read -rs TOKEN; echo
fi
case "$TOKEN" in ngr_*) ;; *) echo "That doesn't look like a NoteGoat device token (it starts with ngr_)."; exit 1 ;; esac

"$SECURITY" add-generic-password -U -s "$LABEL" -a notegoat-reminders -w "$TOKEN" \
  -l "NoteGoat text reminders device token" >/dev/null
echo "✓ Token saved in your Keychain."

mkdir -p "$APP_DIR" "$AGENTS_DIR" "$LOG_DIR"
cp "$HERE/notegoat-reminders.sh" "$APP_DIR/notegoat-reminders.sh"
chmod 755 "$APP_DIR/notegoat-reminders.sh"

cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>$APP_DIR/notegoat-reminders.sh</string>
  </array>
  <key>StartCalendarInterval</key>
  <dict><key>Hour</key><integer>$HOUR</integer><key>Minute</key><integer>0</integer></dict>
  <key>StandardOutPath</key><string>$LOG_DIR/launchd.out.log</string>
  <key>StandardErrorPath</key><string>$LOG_DIR/launchd.err.log</string>
  <key>RunAtLoad</key><false/>
</dict>
</plist>
PLIST
echo "✓ Daily 8:00 job installed: $PLIST"

UID_NUM=$(id -u)
"$LAUNCHCTL" bootout "gui/$UID_NUM/$LABEL" >/dev/null 2>&1 || true
"$LAUNCHCTL" bootstrap "gui/$UID_NUM" "$PLIST"
echo "✓ Job loaded."

echo
echo "Testing the connection (preview only, nothing is sent)…"
if /bin/bash "$APP_DIR/notegoat-reminders.sh" --preview; then
  echo "✓ Connected. See the log: $LOG_DIR/reminders.log"
else
  echo "! The test didn't connect. Check the log: $LOG_DIR/reminders.log"
fi
echo
echo "First real run: macOS will ask to let Terminal/bash control Messages — click OK."
echo "To trigger that prompt now with a test text to YOUR OWN phone, run:"
echo "  osascript -e 'tell application \"Messages\" to send \"NoteGoat test\" to participant \"+1YOURNUMBER\" of (1st account whose service type = iMessage)'"
