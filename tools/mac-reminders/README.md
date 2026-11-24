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
Every run day from 8:00 the Mac writes what it *would* send to
`~/Library/Logs/NoteGoat/reminders.log`, and NoteGoat shows it under
**Recent sends** as "dry-run". When it looks right, turn **Dry run** off in
Settings. Nothing else changes on the Mac.

## iPhone primary, Mac backup
If the office iPhone is set up too (Settings → Text Reminders → iPhone
setup), mark it **Primary** there. The Mac then waits until 8:30 and only
sends what the iPhone hasn't. Each device "claims" the reminders it is
handed for 15 minutes, so the two never text the same patient.

## Send Now
**Send Reminders Now** in Settings asks every device to send tomorrow's
reminders within the next 2 hours. The Mac checks every 10 minutes
(8 AM–6 PM). Anyone already texted is skipped. From the Mac itself:
`… notegoat-reminders.sh --force`.

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

## Opt-out replies (STOP)

Each check (every 10 minutes, any hour) the script reads new incoming
messages from `~/Library/Messages/chat.db` (read-only), newer than the last
ROWID it saw (`~/Library/Logs/NoteGoat/.inbound-rowid`). The first run only
records the newest ROWID, so old history is never uploaded. Only replies
that are exactly a keyword (STOP, STOPALL, UNSUBSCRIBE, END, QUIT,
START, UNSTOP; case-insensitive) are POSTed to `/api/reminders/inbound`,
which turns that patient's text reminders off (or back on). Nothing is ever
texted back. If the upload fails, the ROWID is not advanced and it retries.

Requires **Full Disk Access** for `/bin/bash` (System Settings › Privacy &
Security › Full Disk Access › +, press ⌘⇧G, type `/bin/bash`). Without it
the log says "Opt-out check skipped". On recent macOS some message bodies
are only stored in `attributedBody` (not `text`); those are skipped.
