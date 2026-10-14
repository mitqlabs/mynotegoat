# NoteGoat Text Reminders — Mac setup (one page)

Your office iMac sends each patient a text the day before their visit,
from its Messages app. NoteGoat decides who gets one and what it says;
the Mac just sends.

## Before you start
- The iMac stays **on, signed in, and awake at 8:00 AM** (System Settings →
  Energy: prevent automatic sleep; or schedule wake at 7:55).
- Messages on the iMac is signed in to the office Apple ID.
- For patients without iPhones: on the office iPhone, Settings → Messages →
  **Text Message Forwarding** → turn on this iMac.

## Setup (10 minutes)
1. In NoteGoat: **Settings → Templates → Text Reminders**.
   Pick or edit the reminder message and check the preview.
   Leave **Dry run** ON for now.
2. Click **+ Add device**, name it "Office iMac", and copy the token
   (it starts with `ngr_` and is shown only once).
3. On the iMac, open **Terminal**, go to this folder, and run:
   `bash install.sh` — paste the token when asked.
   It saves the token in the Keychain and tests the connection.
4. The first time it sends, macOS asks to let it control **Messages** —
   click **OK**.

## The first week (dry run)
Every run day at 8:00 the Mac writes what it *would* send to
`~/Library/Logs/NoteGoat/reminders.log`, and NoteGoat shows it under
**Recent sends** as "dry-run". When it looks right, turn **Dry run** off in
Settings. Nothing else changes on the Mac.

## Everyday
- Run days are automatic (the day before each open office day) and can
  be changed in Settings. Closed days in Key Dates are skipped.
- Patients who asked not to be texted, canceled/no-show visits, and
  patients without a phone are skipped. Nobody gets the same reminder twice.
- Texts go out a little apart (20–40 seconds) with at most 150 per run.

## Handy commands (Terminal)
- See the list now, send nothing: `bash ~/Library/Application\ Support/NoteGoat/notegoat-reminders.sh --preview`
- Run now in dry run: `… notegoat-reminders.sh --dry-run`
- Remove everything: `bash uninstall.sh`, then **Revoke** the device in Settings.

## If something goes wrong
Check `~/Library/Logs/NoteGoat/reminders.log`. "no device token" → run
install.sh again with a new token. "HTTP 401" → the device was revoked;
add a new one. Replies from patients arrive in Messages like any text —
if someone asks to stop, tick "No text reminders" on their patient file.
