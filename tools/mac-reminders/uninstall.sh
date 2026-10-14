#!/bin/bash
# Removes NoteGoat text reminders from this Mac. Logs are kept.
set -u
LABEL="com.notegoat.reminders"
APP_DIR="${NG_APP_DIR:-$HOME/Library/Application Support/NoteGoat}"
AGENTS_DIR="${NG_AGENTS_DIR:-$HOME/Library/LaunchAgents}"
SECURITY="${NG_SECURITY:-/usr/bin/security}"
LAUNCHCTL="${NG_LAUNCHCTL:-/bin/launchctl}"
"$LAUNCHCTL" bootout "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || true
rm -f "$AGENTS_DIR/$LABEL.plist" "$APP_DIR/notegoat-reminders.sh"
"$SECURITY" delete-generic-password -s "$LABEL" -a notegoat-reminders >/dev/null 2>&1 || true
echo "✓ NoteGoat text reminders removed (job, script and Keychain token)."
echo "  Also revoke the device in NoteGoat: Settings → Text Reminders → Revoke."
echo "  Logs kept in ~/Library/Logs/NoteGoat/"
