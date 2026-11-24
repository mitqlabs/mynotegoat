#!/bin/bash
# Linux-friendly tests for the Mac reminder scripts. osascript, curl,
# security and launchctl are mocked; JSON goes through python3.
set -u
DIR="$(cd "$(dirname "$0")/.." && pwd)"
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
mkdir -p "$T/bin"
cat > "$T/bin/curl" <<'M'
#!/bin/bash
out=/dev/stdout; data=""; url=""
while [ $# -gt 0 ]; do case "$1" in -o) out=$2; shift;; --data-binary) data=$2; shift;; -w|-H|-X|--max-time) shift;; -*) ;; *) url=$1;; esac; shift; done
echo "$url" >> "$MOCK_DIR/urls"
if [[ "$url" == */inbound ]]; then echo "$data" >> "$MOCK_DIR/inbound"; echo '{"changed":1}' > "$out"; printf "${MOCK_INBOUND_HTTP:-200}"; exit 0; fi
if [[ "$url" == */ack ]]; then echo "$data" >> "$MOCK_DIR/acks"; : > "$out"; printf 200; exit 0; fi
cp "$MOCK_QUEUE" "$out"; printf "${MOCK_HTTP:-200}"
M
cat > "$T/bin/osascript" <<'M'
#!/bin/bash
cat > /dev/null
printf '%s\t%s\n' "$2" "$3" >> "$MOCK_DIR/sent"
[ -n "${MOCK_OSA_FAIL:-}" ] && { echo "Messages got an error"; exit 1; }
exit 0
M
cat > "$T/bin/security" <<'M'
#!/bin/bash
echo "$*" >> "$MOCK_DIR/security"
[ "$1" = find-generic-password ] && { [ -n "${MOCK_TOKEN:-}" ] && echo "$MOCK_TOKEN" || exit 44; }
exit 0
M
printf '#!/bin/bash\necho "$*" >> "$MOCK_DIR/launchctl"\n' > "$T/bin/launchctl"
cat > "$T/bin/sqlite3" <<'M'
#!/bin/bash
echo "$*" >> "$MOCK_DIR/sql"
case "$*" in *"MAX(ROWID)"*) echo "${MOCK_MAX:-0}" ;; *) [ -f "$MOCK_DIR/rows" ] && cat "$MOCK_DIR/rows" ;; esac
M
chmod +x "$T/bin/"*

pass=0; fail=0
check() { if eval "$2"; then pass=$((pass+1)); else fail=$((fail+1)); echo "FAIL: $1"; fi; }
setup() {
  export MOCK_DIR="$T/m$RANDOM"; mkdir -p "$MOCK_DIR"; : > "$MOCK_DIR/sent"; : > "$MOCK_DIR/acks"; : > "$MOCK_DIR/urls"
  export MOCK_QUEUE="$MOCK_DIR/q.json" NG_LOG_DIR="$MOCK_DIR/log" NG_LOCK_DIR="$MOCK_DIR/lock"
  export NG_CURL="$T/bin/curl" NG_OSASCRIPT="$T/bin/osascript" NG_SECURITY="$T/bin/security" NG_LAUNCHCTL="$T/bin/launchctl"
  export NG_FORCE_PY=1 NG_SLEEP_MIN=0 NG_SLEEP_MAX=0 NG_HOUR_NOW=09 MOCK_TOKEN="ngr_$(printf 'a%.0s' $(seq 64))"
  export NG_SQLITE="$T/bin/sqlite3" NG_CHAT_DB="$MOCK_DIR/none.db"
  unset NG_CAP MOCK_OSA_FAIL MOCK_HTTP NG_TOKEN MOCK_MAX MOCK_INBOUND_HTTP
}
q() { echo "$1" > "$MOCK_QUEUE"; }
ITEMS='[{"id":"a1","phone":"+15550100001","text":"Hi Jane, see you at 10:30 AM. Call \"us\" at 555-0000"},{"id":"a2","phone":"+15550100002","text":"Hi Bob,\nline two"},{"id":"a3","phone":"+15550100003","text":"Hi Ann"}]'
R="$DIR/notegoat-reminders.sh"
n() { wc -l < "$1" | tr -d ' '; }

setup; q '{"send":false,"run":false,"dryRun":false,"reason":"Mon is not a run day.","visitDate":"2026-10-20","items":[]}'
bash "$R"; check "non-run day sends nothing" '[ "$(n $MOCK_DIR/sent)" = 0 ] && [ "$(n $MOCK_DIR/acks)" = 0 ] && grep -q "not a run day" $NG_LOG_DIR/reminders.log'

setup; q "{\"send\":true,\"run\":true,\"dryRun\":false,\"reason\":\"\",\"visitDate\":\"2026-10-19\",\"items\":$ITEMS}"
bash "$R"
check "sends 3 via osascript" '[ "$(n $MOCK_DIR/sent)" = 4 ]'  # a2 text has a newline → 4 lines
check "exact text with quotes" 'grep -qF "+15550100001	Hi Jane, see you at 10:30 AM. Call \"us\" at 555-0000" $MOCK_DIR/sent'
check "3 acks status sent" '[ "$(grep -c "\"status\":\"sent\"" $MOCK_DIR/acks)" = 3 ]'
check "ack JSON valid" 'while read -r l; do echo "$l" | python3 -c "import json,sys; json.load(sys.stdin)" || exit 1; done < $MOCK_DIR/acks'
check "token sent as bearer only from keychain" 'grep -q find-generic-password $MOCK_DIR/security'
check "log masks phone" '! grep -q 5550100001 $NG_LOG_DIR/reminders.log && grep -q "sent \*\*\*0001" $NG_LOG_DIR/reminders.log'
check "lock removed" '[ ! -e $NG_LOCK_DIR ]'

setup; q "{\"send\":false,\"run\":true,\"dryRun\":true,\"reason\":\"\",\"visitDate\":\"2026-10-19\",\"items\":$ITEMS}"
bash "$R"; check "server dry run: no sends, dry-run acks" '[ "$(n $MOCK_DIR/sent)" = 0 ] && [ "$(grep -c dry-run $MOCK_DIR/acks)" = 3 ]'

setup; q "{\"send\":true,\"run\":true,\"dryRun\":false,\"reason\":\"\",\"visitDate\":\"2026-10-19\",\"items\":$ITEMS}"
bash "$R" --dry-run; check "--dry-run flag: no sends" '[ "$(n $MOCK_DIR/sent)" = 0 ] && [ "$(grep -c dry-run $MOCK_DIR/acks)" = 3 ]'

setup; q "{\"send\":true,\"run\":true,\"dryRun\":false,\"reason\":\"\",\"visitDate\":\"2026-10-19\",\"items\":$ITEMS}"
NG_CAP=1 bash "$R"; check "cap 1 → one send" '[ "$(grep -c "\"status\":\"sent\"" $MOCK_DIR/acks)" = 1 ] && grep -q "Cap of 1" $NG_LOG_DIR/reminders.log'

setup; q "{\"send\":true,\"run\":true,\"dryRun\":false,\"reason\":\"\",\"visitDate\":\"2026-10-19\",\"items\":$ITEMS}"
MOCK_OSA_FAIL=1 bash "$R"; check "osascript failure → failed acks" '[ "$(grep -c "\"status\":\"failed\"" $MOCK_DIR/acks)" = 3 ]'

setup; q '{"send":false,"run":false,"dryRun":true,"reason":"Mon is not a run day.","visitDate":"2026-10-20","items":[{"id":"a1","phone":"+15550100001","text":"x"}]}'
bash "$R" --preview; check "--preview: logs, no sends, no acks" '[ "$(n $MOCK_DIR/sent)" = 0 ] && [ "$(n $MOCK_DIR/acks)" = 0 ] && grep -q "preview=1" $MOCK_DIR/urls && grep -q "dry-run \*\*\*0001" $NG_LOG_DIR/reminders.log'

setup; q "{\"send\":true,\"run\":true,\"dryRun\":false,\"visitDate\":\"2026-10-19\",\"items\":$ITEMS}"
mkdir -p "$NG_LOCK_DIR"; sleep 30 & echo $! > "$NG_LOCK_DIR/pid"; LP=$!
bash "$R"; kill $LP 2>/dev/null
check "lock held → exits without fetching" '[ "$(n $MOCK_DIR/urls)" = 0 ] && grep -q "in progress" $NG_LOG_DIR/reminders.log'

setup; q "{\"send\":true,\"run\":true,\"dryRun\":false,\"visitDate\":\"2026-10-19\",\"items\":$ITEMS}"
mkdir -p "$NG_LOCK_DIR"; echo 999999 > "$NG_LOCK_DIR/pid"
bash "$R"; check "stale lock is cleared" '[ "$(grep -c "\"status\":\"sent\"" $MOCK_DIR/acks)" = 3 ]'

setup; unset MOCK_TOKEN; q '{}'
bash "$R"; rc=$?; check "no token → exit 1, no request" '[ $rc = 1 ] && [ "$(n $MOCK_DIR/urls)" = 0 ]'

setup; q '{"error":"Invalid or revoked device token."}'
MOCK_HTTP=401 bash "$R"; rc=$?; check "HTTP 401 → exit 1, logged" '[ $rc = 1 ] && grep -q "HTTP 401" $NG_LOG_DIR/reminders.log'

setup; q "{\"send\":true,\"run\":true,\"dryRun\":false,\"visitDate\":\"2026-10-19\",\"items\":$ITEMS}"
NG_HOUR_NOW=07 bash "$R"; check "before 8 AM: no request" '[ "$(n $MOCK_DIR/urls)" = 0 ]'
NG_HOUR_NOW=18 bash "$R"; check "6 PM or later: no request" '[ "$(n $MOCK_DIR/urls)" = 0 ]'
NG_HOUR_NOW=19 bash "$R" --force; check "--force runs any hour with force=1" 'grep -q "force=1" $MOCK_DIR/urls && [ "$(grep -c "\"status\":\"sent\"" $MOCK_DIR/acks)" = 3 ]'

setup; q '{"send":false,"run":false,"dryRun":false,"reason":"Backup device: waits until 8:30 AM.","visitDate":"2026-10-19","items":[]}'
bash "$R"; bash "$R"; check "repeated reason logged once" '[ "$(grep -c "Backup device" $NG_LOG_DIR/reminders.log)" = 1 ]'

# installer
setup; q '{"send":false,"run":false,"dryRun":true,"reason":"x","visitDate":"2026-10-20","items":[]}'
export NG_APP_DIR="$MOCK_DIR/app" NG_AGENTS_DIR="$MOCK_DIR/agents"
NG_TOKEN="$MOCK_TOKEN" bash "$DIR/install.sh" > "$MOCK_DIR/install.out" 2>&1; rc=$?
check "install ok" '[ $rc = 0 ]'
check "token stored in keychain" 'grep -q "add-generic-password -U -s com.notegoat.reminders -a notegoat-reminders -w ngr_" $MOCK_DIR/security'
check "plist valid, every 600s, points at script" 'python3 -c "import plistlib,sys; p=plistlib.load(open(\"$NG_AGENTS_DIR/com.notegoat.reminders.plist\",\"rb\")); assert p[\"StartInterval\"]==600; assert p[\"ProgramArguments\"][1].endswith(\"notegoat-reminders.sh\")"'
check "script installed" '[ -x "$NG_APP_DIR/notegoat-reminders.sh" ]'
check "launchctl bootstrap" 'grep -q "bootstrap gui/" $MOCK_DIR/launchctl'
check "no token written to disk" '! grep -rq "$MOCK_TOKEN" "$NG_APP_DIR" "$NG_AGENTS_DIR"'
NG_TOKEN="bad" bash "$DIR/install.sh" >/dev/null 2>&1; rc=$?
check "install rejects bad token" '[ $rc = 1 ]'
bash "$DIR/uninstall.sh" > /dev/null
check "uninstall removes plist + token" '[ ! -e "$NG_AGENTS_DIR/com.notegoat.reminders.plist" ] && grep -q delete-generic-password $MOCK_DIR/security'

# --- opt-out replies (chat.db) ---
US=$'\x1f'
optq() { q '{"send":false,"run":false,"dryRun":false,"reason":"Nothing to send.","visitDate":"2026-10-20","items":[]}'; : > "$MOCK_DIR/chat.db"; export NG_CHAT_DB="$MOCK_DIR/chat.db"; }
setup; optq; MOCK_MAX=500 bash "$R"
check "inbound first run: records max rowid, posts nothing" '[ "$(cat $NG_LOG_DIR/.inbound-rowid)" = 500 ] && ! grep -q inbound $MOCK_DIR/urls'

setup; optq; mkdir -p "$NG_LOG_DIR"; printf 500 > "$NG_LOG_DIR/.inbound-rowid"
printf '501%s+15550100001%s Stop \n502%s+15550100002%sCan I cancel my 3pm?\n503%s+15550100003%sunsubscribe!\n504%s%sSTOP\n' "$US" "$US" "$US" "$US" "$US" "$US" "$US" "$US" > "$MOCK_DIR/rows"
bash "$R"
check "inbound: only keyword replies posted" '[ "$(n $MOCK_DIR/inbound)" = 1 ] && grep -q 5550100001 $MOCK_DIR/inbound && grep -q 5550100003 $MOCK_DIR/inbound && ! grep -q 5550100002 $MOCK_DIR/inbound'
check "inbound: body is valid JSON with 2 messages" 'python3 -c "import json,sys; d=json.load(open(\"$MOCK_DIR/inbound\")); assert len(d[\"messages\"])==2"'
check "inbound: uses rowid > last" 'grep -q "ROWID > 500" $MOCK_DIR/sql'
check "inbound: advances rowid" '[ "$(cat $NG_LOG_DIR/.inbound-rowid)" = 504 ]'
check "inbound: never sends a text" '[ "$(n $MOCK_DIR/sent)" = 0 ]'
check "inbound: log has no phone or message text" '! grep -q 5550100001 $NG_LOG_DIR/reminders.log'

setup; optq; mkdir -p "$NG_LOG_DIR"; printf 500 > "$NG_LOG_DIR/.inbound-rowid"
printf '501%s+15550100001%sSTOP\n' "$US" "$US" > "$MOCK_DIR/rows"
MOCK_INBOUND_HTTP=500 bash "$R"
check "inbound: upload failure keeps rowid for retry" '[ "$(cat $NG_LOG_DIR/.inbound-rowid)" = 500 ]'

setup; optq; mkdir -p "$NG_LOG_DIR"; printf 500 > "$NG_LOG_DIR/.inbound-rowid"
printf '501%s+15550100001%sSTOP\n' "$US" "$US" > "$MOCK_DIR/rows"
NG_HOUR_NOW=22 bash "$R"
check "inbound: runs outside office hours, queue not fetched" '[ "$(n $MOCK_DIR/inbound)" = 1 ] && ! grep -q "/queue" $MOCK_DIR/urls'

setup; optq; mkdir -p "$NG_LOG_DIR"; printf 500 > "$NG_LOG_DIR/.inbound-rowid"
printf '501%s+15550100001%shello\n' "$US" "$US" > "$MOCK_DIR/rows"
bash "$R"
check "inbound: no keywords → no post, rowid advances" '[ ! -s $MOCK_DIR/inbound ] && [ "$(cat $NG_LOG_DIR/.inbound-rowid)" = 501 ]'

echo "mac-reminders tests: $pass passed, $fail failed"
[ "$fail" = 0 ]
