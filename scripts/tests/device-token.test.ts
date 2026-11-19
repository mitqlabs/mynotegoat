/**
 * A new shortcut code must not invalidate the one already on the phone.
 * Run: npx tsx scripts/tests/device-token.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import {
  DEVICE_SETUP_AGAIN,
  decideDeviceToken,
  lastRunRejectedText,
  promotedTokenFields,
} from "../../src/lib/device-token";

const current = "hash-current";
const pending = "hash-pending";
const row = { token_hash: current, pending_token_hash: pending, retired_token_hash: null, revoked_at: null };

assert.deepEqual(decideDeviceToken(current, row), { ok: true, promote: false }, "the shortcut already on the phone still works");
assert.deepEqual(decideDeviceToken(pending, row), { ok: true, promote: true }, "the new code is accepted and becomes the only code");
assert.deepEqual(promotedTokenFields({ ...row, pending_token_hash: pending }), {
  token_hash: pending,
  pending_token_hash: null,
  retired_token_hash: current,
  last_rejected_at: null,
  last_rejected_reason: null,
});
const retired = decideDeviceToken(current, { token_hash: pending, pending_token_hash: null, retired_token_hash: current });
assert.equal(retired.ok, false);
if (!retired.ok) assert.equal(retired.reject, DEVICE_SETUP_AGAIN);
const removed = decideDeviceToken(current, { ...row, revoked_at: "2026-11-19T00:00:00Z" });
assert.equal(removed.ok, false);

assert.equal(lastRunRejectedText({ last_rejected_at: null, last_run_at: null }), "");
assert.match(
  lastRunRejectedText({ last_rejected_at: "2026-11-19T01:00:00Z", last_run_at: "2026-11-19T00:00:00Z", last_rejected_reason: DEVICE_SETUP_AGAIN }),
  /Last run was rejected/,
);
assert.equal(
  lastRunRejectedText({ last_rejected_at: "2026-11-19T00:00:00Z", last_run_at: "2026-11-19T01:00:00Z" }),
  "",
  "a later successful run clears the rejection line",
);

const checklist = readFileSync("src/components/reminder-setup-checklist.tsx", "utf8");
assert.match(checklist, /pending_token_hash: tokenHash/);
assert.doesNotMatch(checklist, /update\(\{ token_hash: tokenHash \}\)/, "Add to this iPhone must not replace the live code");
assert.match(checklist, /setup-last-rejected/);
assert.match(readFileSync("src/components/text-reminders-settings-panel.tsx", "utf8"), /pending_token_hash: await hashDeviceToken/);
assert.match(readFileSync("src/lib/reminder-server.ts", "utf8"), /decideDeviceToken/);
assert.match(readFileSync("src/app/api/reminders/queue/route.ts", "utf8"), /DEVICE_SETUP_AGAIN/);

const parsed = spawnSync("python3", ["-c", `
import json, plistlib, sys
p = plistlib.load(open(sys.argv[1], "rb"))
notes = []
exits = 0
for a in p["WFWorkflowActions"]:
    ident = a["WFWorkflowActionIdentifier"]
    if ident.endswith("exit"): exits += 1
    body = a.get("WFWorkflowActionParameters", {}).get("WFNotificationActionBody", {})
    text = body.get("Value", {}).get("string", "") if isinstance(body, dict) else ""
    if text: notes.append(text)
print(json.dumps({"exits": exits, "notes": notes}))
`, "src/lib/shortcuts/NoteGoat.template.shortcut"], { encoding: "utf8" });
assert.equal(parsed.status, 0, parsed.stderr);
const info = JSON.parse(parsed.stdout) as { exits: number; notes: string[] };
assert.equal(info.exits, 0, "a failed fetch must not exit with no notification");
assert.ok(info.notes.some((note) => note.includes("Add to this Device")), info.notes.join(" | "));

console.log("device-token: ok");
