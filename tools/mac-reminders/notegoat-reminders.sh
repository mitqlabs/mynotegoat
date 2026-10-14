#!/bin/bash
# NoteGoat day-before text reminders, sent from this Mac's Messages app.
# Run by launchd at 8:00 every day. NoteGoat decides whether today is a run
# day; this script only sends when the server says send=true.
#
# Usage: notegoat-reminders.sh [--dry-run] [--preview]
#   --dry-run  log what would be sent, send nothing (reports "dry-run")
#   --preview  fetch the list even on a non-run day; implies --dry-run
set -u

BASE_URL="${NG_BASE_URL:-https://www.mynotegoat.com}"
KEYCHAIN_SERVICE="com.notegoat.reminders"
KEYCHAIN_ACCOUNT="notegoat-reminders"
LOG_DIR="${NG_LOG_DIR:-$HOME/Library/Logs/NoteGoat}"
LOG_FILE="$LOG_DIR/reminders.log"
LOCK_DIR="${NG_LOCK_DIR:-${TMPDIR:-/tmp}/notegoat-reminders.lock}"
CAP="${NG_CAP:-150}"                  # max texts per run
SLEEP_MIN="${NG_SLEEP_MIN:-20}"       # seconds between texts
SLEEP_MAX="${NG_SLEEP_MAX:-40}"
OSASCRIPT="${NG_OSASCRIPT:-/usr/bin/osascript}"
SECURITY="${NG_SECURITY:-/usr/bin/security}"
CURL="${NG_CURL:-curl}"

DRY_RUN=0
PREVIEW=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    --preview) PREVIEW=1; DRY_RUN=1 ;;
    -h|--help) sed -n 2,9p "$0"; exit 0 ;;
    *) echo "Unknown option: $arg" >&2; exit 2 ;;
  esac
done

mkdir -p "$LOG_DIR"
log() { printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >> "$LOG_FILE"; }

# --- JSON helpers: plutil on macOS, python3 fallback (tests / Linux) ---
json_get() { # file keypath  (e.g. items.0.text) -> raw value, empty if missing
  if command -v plutil >/dev/null 2>&1 && [ -z "${NG_FORCE_PY:-}" ]; then
    plutil -extract "$2" raw -o - "$1" 2>/dev/null
  else
    python3 - "$1" "$2" <<'PY'
import json, sys
v = json.load(open(sys.argv[1]))
for part in sys.argv[2].split("."):
    try:
        v = v[int(part)] if isinstance(v, list) else v[part]
    except Exception:
        sys.exit(0)
if isinstance(v, bool):
    print("true" if v else "false", end="")
elif isinstance(v, (int, float, str)):
    print(v, end="")
else:
    print(len(v), end="")
PY
  fi
}
json_count() { # file key -> array length
  if command -v plutil >/dev/null 2>&1 && [ -z "${NG_FORCE_PY:-}" ]; then
    plutil -extract "$2" raw -o - "$1" 2>/dev/null || echo 0
  else
    json_get "$1" "$2"
  fi
}
json_escape() { # string -> JSON string literal
  local s=$1
  s=${s//\\/\\\\}; s=${s//\"/\\\"}; s=${s//$'\n'/\\n}; s=${s//$'\r'/}; s=${s//$'\t'/\\t}
  printf '"%s"' "$s"
}

# --- single instance ---
if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  if [ -f "$LOCK_DIR/pid" ] && kill -0 "$(cat "$LOCK_DIR/pid")" 2>/dev/null; then
    log "Another run is in progress (pid $(cat "$LOCK_DIR/pid")); exiting."
    exit 0
  fi
  log "Removing stale lock."
  rm -rf "$LOCK_DIR"; mkdir "$LOCK_DIR" || exit 1
fi
echo $$ > "$LOCK_DIR/pid"
WORK=$(mktemp -d)
trap 'rm -rf "$LOCK_DIR" "$WORK"' EXIT

# --- token ---
TOKEN="${NG_TOKEN:-}"
if [ -z "$TOKEN" ]; then
  TOKEN=$("$SECURITY" find-generic-password -s "$KEYCHAIN_SERVICE" -a "$KEYCHAIN_ACCOUNT" -w 2>/dev/null)
fi
if [ -z "$TOKEN" ]; then
  log "ERROR: no device token in Keychain. Run install.sh again."
  exit 1
fi

# --- fetch queue ---
QUEUE="$WORK/queue.json"
URL="$BASE_URL/api/reminders/queue"
[ "$PREVIEW" = 1 ] && URL="$URL?preview=1"
HTTP=$("$CURL" -sS --max-time 60 -o "$QUEUE" -w '%{http_code}' -H "Authorization: Bearer $TOKEN" "$URL" 2>>"$LOG_FILE")
if [ "$HTTP" != "200" ]; then
  log "ERROR: queue request failed (HTTP $HTTP): $(head -c 300 "$QUEUE" 2>/dev/null)"
  exit 1
fi

SEND=$(json_get "$QUEUE" send)
RUN=$(json_get "$QUEUE" run)
SERVER_DRY=$(json_get "$QUEUE" dryRun)
VISIT_DATE=$(json_get "$QUEUE" visitDate)
REASON=$(json_get "$QUEUE" reason)
COUNT=$(json_count "$QUEUE" items)
COUNT=${COUNT:-0}
[ "$SERVER_DRY" = "true" ] && DRY_RUN=1

if [ "$PREVIEW" = 0 ] && [ "$RUN" != "true" ]; then
  log "Nothing to do for $VISIT_DATE: ${REASON:-not a run day}"
  exit 0
fi
# Real sending only when the server explicitly says send=true.
if [ "$SEND" != "true" ]; then DRY_RUN=1; fi

MODE=$([ "$DRY_RUN" = 1 ] && echo "DRY RUN" || echo "SENDING")
log "$MODE: $COUNT reminder(s) for $VISIT_DATE (cap $CAP)."

ack() { # id status [error]
  local body
  body="{\"visitDate\":$(json_escape "$VISIT_DATE"),\"results\":[{\"id\":$(json_escape "$1"),\"status\":$(json_escape "$2")"
  [ -n "${3:-}" ] && body="$body,\"error\":$(json_escape "$3")"
  body="$body}]}"
  "$CURL" -sS --max-time 30 -o /dev/null -w '%{http_code}' -X POST \
    -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    --data-binary "$body" "$BASE_URL/api/reminders/ack" > "$WORK/ack.code" 2>>"$LOG_FILE"
  [ "$(cat "$WORK/ack.code")" = "200" ] || log "WARN: ack failed for $1 (HTTP $(cat "$WORK/ack.code"))"
}

send_text() { # phone text -> 0 ok
  "$OSASCRIPT" - "$1" "$2" <<'APPLESCRIPT' 2>&1
on run argv
  set targetPhone to item 1 of argv
  set targetMessage to item 2 of argv
  tell application "Messages"
    try
      set svc to 1st account whose service type = iMessage
      send targetMessage to participant targetPhone of svc
    on error
      set svc to 1st account whose service type = SMS
      send targetMessage to participant targetPhone of svc
    end try
  end tell
end run
APPLESCRIPT
}

sent=0; failed=0; i=0
while [ "$i" -lt "$COUNT" ]; do
  if [ "$i" -ge "$CAP" ]; then
    log "Cap of $CAP reached; $((COUNT - i)) left unsent (they stay in tomorrow's check)."
    break
  fi
  ID=$(json_get "$QUEUE" "items.$i.id")
  PHONE=$(json_get "$QUEUE" "items.$i.phone")
  TEXT=$(json_get "$QUEUE" "items.$i.text")
  LAST4=${PHONE: -4}
  i=$((i + 1))
  if [ -z "$ID" ] || [ -z "$PHONE" ] || [ -z "$TEXT" ]; then
    log "Skipping malformed item $i."
    continue
  fi
  if [ "$DRY_RUN" = 1 ]; then
    log "dry-run ***$LAST4: $TEXT"
    [ "$PREVIEW" = 1 ] || ack "$ID" "dry-run"
    continue
  fi
  if OUT=$(send_text "$PHONE" "$TEXT"); then
    sent=$((sent + 1)); log "sent ***$LAST4"; ack "$ID" "sent"
  else
    failed=$((failed + 1)); log "FAILED ***$LAST4: $OUT"; ack "$ID" "failed" "$OUT"
  fi
  if [ "$i" -lt "$COUNT" ]; then
    span=$((SLEEP_MAX - SLEEP_MIN + 1)); [ "$span" -lt 1 ] && span=1
    sleep $((SLEEP_MIN + RANDOM % span))
  fi
done
log "Done: $sent sent, $failed failed$([ "$DRY_RUN" = 1 ] && echo " (dry run)")."
exit 0
