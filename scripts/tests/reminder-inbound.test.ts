/**
 * STOP replies: a phone number, a unique name, no match, and a test that
 * does not change a patient. Mock data only.
 * Run: npx tsx scripts/tests/reminder-inbound.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import {
  isStopTest,
  matchPatientByName,
  stopReplyChoices,
} from "../../src/lib/reminder-automation";
import { applyInboundReplies, type ReminderDevice } from "../../src/lib/reminder-server";
import { iphoneSetupSteps, setupTestReport } from "../../src/lib/iphone-setup";
import { openDeviceToken, sealDeviceToken } from "../../src/lib/shortcut-ticket";
import { SHORTCUT_TOKEN_SLOT, shortcutWithToken } from "../../src/lib/shortcut-file";

assert.equal(isStopTest("STOP TEST"), true);
assert.equal(isStopTest("  stop   test. "), true);
assert.equal(isStopTest("STOP"), false);
assert.equal(matchPatientByName([{ id: "a", fullName: "Doe, Jane" }, { id: "b", fullName: "Roe, John" }], "Jane Doe"), "a");
assert.equal(matchPatientByName([{ id: "a", fullName: "Doe, Jane" }, { id: "b", fullName: "Doe, Janet" }], "Jane"), "a");
assert.equal(matchPatientByName([{ id: "a", fullName: "Doe, Jane" }, { id: "b", fullName: "Smith, Jane" }], "Jane"), null, "two Janes");
assert.equal(matchPatientByName([{ id: "a", fullName: "Doe, Jane" }], "5550100001"), null);
assert.equal(stopReplyChoices([{ id: "a", fullName: "Doe, Jane" }, { id: "b", fullName: "Smith, Jane" }], "Jane Doe").length, 2);

const steps = iphoneSetupSteps(8).map((step) => step.text.replace(/\*\*/g, ""));
assert.equal(steps[0], "Tap Add to this Device.");
assert.equal(steps[1], "Tap Add Shortcut.");
assert.match(steps[3], /8:00 AM/);
assert.match(steps[5], /8:30 AM/);
assert.match(steps[6], /9:00 AM/);
assert.match(steps[7], /Type STOP/);
assert.match(steps[9], /tap Test/);
assert.equal(steps.length, 10);

const green = setupTestReport({ stopReportAt: "2026-11-17T21:06:00Z", lastSeenAt: null, unmatched: 0, timeZone: "America/Los_Angeles", sendHour: 8 });
assert.equal(green.ok, true);
assert.equal(green.title, "STOP catcher working ✓");
assert.match(green.fix, /1:06 PM/);
assert.equal(setupTestReport({ stopReportAt: null, lastSeenAt: "2026-11-17T16:00:00Z", unmatched: 0, timeZone: "America/Los_Angeles", sendHour: 8 }).ok, false);

const secret = "test-secret";
const token = `ngr_${"ab".repeat(32)}`;
const ticket = sealDeviceToken(token, secret, 1_000);
assert.equal(openDeviceToken(ticket, secret, 1_000), token);
assert.equal(openDeviceToken(ticket, secret, 1_000 + 16 * 60 * 1000), null);
assert.equal(openDeviceToken(ticket, "other", 1_000), null);

type Row = Record<string, unknown>;
function fakeAdmin(patients: Row[]) {
  const tables: Record<string, Row[]> = { patients, reminder_opt_outs: [] };
  const from = (table: string) => {
    const rows = tables[table];
    let mode: "read" | "insert" | "update" = "read";
    let payload: Row = {};
    const filters: Array<(row: Row) => boolean> = [];
    const q: Record<string, unknown> = {};
    const run = () => {
      if (mode === "insert") {
        rows.push({ id: `row${rows.length + 1}`, ...payload });
        return { data: null, error: null };
      }
      const hit = rows.filter((row) => filters.every((ok) => ok(row)));
      if (mode === "update") {
        for (const row of hit) Object.assign(row, payload);
        return { data: hit.map((row) => ({ id: row.id })), error: null };
      }
      return { data: hit, error: null };
    };
    q.select = () => q;
    q.eq = (column: string, value: unknown) => { filters.push((row) => row[column] === value); return q; };
    q.insert = (row: Row) => { mode = "insert"; payload = row; return q; };
    q.update = (row: Row) => { mode = "update"; payload = row; return q; };
    q.then = (resolve: (value: unknown) => unknown) => Promise.resolve(run()).then(resolve);
    return q;
  };
  return { admin: { from } as never, tables };
}

const device: ReminderDevice = { id: "dev1", workspace_id: "ws1", name: "Office iPhone", kind: "iphone", last_run_at: null, run_requested_until: null, is_primary: true };
const people = [
  { id: "p1", workspace_id: "ws1", full_name: "Doe, Jane", phone: "8175550101", text_reminders_off: false },
  { id: "p2", workspace_id: "ws1", full_name: "Roe, John", phone: "8175550102", text_reminders_off: false },
  { id: "p3", workspace_id: "ws1", full_name: "Smith, Jane", phone: "8175550103", text_reminders_off: false },
];

async function main() {
  {
    const { admin, tables } = fakeAdmin(people.map((p) => ({ ...p })));
    const result = await applyInboundReplies(admin, device, [{ from: "+1 817-555-0101", text: "STOP" }], "iphone");
    assert.equal(result.changed, 1);
    assert.equal(result.unmatched, 0);
    assert.equal(tables.patients.find((p) => p.id === "p1")?.text_reminders_off, true);
    assert.equal(tables.patients.find((p) => p.id === "p2")?.text_reminders_off, false);
    assert.equal(tables.reminder_opt_outs[0].patient_id, "p1");
    assert.equal(tables.reminder_opt_outs[0].phone_last4, "0101");
  }
  {
    const { admin, tables } = fakeAdmin(people.map((p) => ({ ...p })));
    const result = await applyInboundReplies(admin, device, [{ from: "John Roe", text: "STOP" }], "iphone");
    assert.equal(result.changed, 1, "unique name");
    assert.equal(tables.patients.find((p) => p.id === "p2")?.text_reminders_off, true);
  }
  {
    const { admin, tables } = fakeAdmin(people.map((p) => ({ ...p })));
    const result = await applyInboundReplies(admin, device, [{ from: "Jane", text: "STOP" }], "iphone");
    assert.equal(result.changed, 0);
    assert.equal(result.unmatched, 1);
    assert.deepEqual(result.unmatchedLabels, ["Jane"]);
    assert.equal(tables.patients.every((p) => p.text_reminders_off === false), true);
    assert.match(String(tables.reminder_opt_outs[0].patient_id), /^unmatched:Jane$/);
  }
  {
    const { admin, tables } = fakeAdmin(people.map((p) => ({ ...p, text_reminders_off: false })));
    const result = await applyInboundReplies(admin, device, [{ from: "8175550101", text: "STOP TEST" }], "iphone");
    assert.equal(result.tested, 1);
    assert.equal(result.changed, 0);
    assert.equal(tables.patients.every((p) => p.text_reminders_off === false), true, "a test never changes a patient");
    assert.equal(tables.reminder_opt_outs[0].patient_id, "test");
    assert.equal(tables.reminder_opt_outs[0].phone_last4, "TEST");
  }
  {
    const { admin, tables } = fakeAdmin(people.map((p) => ({ ...p })));
    const result = await applyInboundReplies(admin, device, [{ from: "8175550101", text: "see you tomorrow" }], "iphone");
    assert.equal(result.ignored, 1);
    assert.equal(tables.reminder_opt_outs.length, 0);
  }

  const built = spawnSync("python3", ["tools/build-shortcuts.py", "notegoat"], { encoding: "utf8" });
  assert.equal(built.status, 0, built.stderr || built.stdout);
  const template = readFileSync("src/lib/shortcuts/NoteGoat.template.shortcut");
  const slot = Buffer.from(SHORTCUT_TOKEN_SLOT);
  assert.equal(template.indexOf(slot) >= 0, true);
  assert.equal(template.indexOf(slot, template.indexOf(slot) + 1), -1, "the code slot appears once");
  const filled = shortcutWithToken(token);
  assert.equal(filled.includes(slot), false);
  assert.equal(filled.includes(token), true);
  const parsed = spawnSync("python3", ["-c", `
import json, plistlib, sys
p = plistlib.load(open(sys.argv[1], "rb"))
ids = [a["WFWorkflowActionIdentifier"] for a in p["WFWorkflowActions"]]
urls = []
for a in p["WFWorkflowActions"]:
    url = a.get("WFWorkflowActionParameters", {}).get("WFURL")
    if url: urls.append(url)
text = p["WFWorkflowActions"][0]["WFWorkflowActionParameters"].get("WFTextActionText")
print(json.dumps({"name": p["WFWorkflowName"], "text": text, "urls": urls, "inbound": sum("inbound" in i for i in ids), "questions": p.get("WFWorkflowImportQuestions")}))
`, "src/lib/shortcuts/NoteGoat.template.shortcut"], { encoding: "utf8" });
  assert.equal(parsed.status, 0, parsed.stderr);
  const info = JSON.parse(parsed.stdout) as { name: string; text: string; urls: string[]; questions: unknown[] };
  assert.equal(info.name, "NoteGoat");
  assert.equal(info.text, SHORTCUT_TOKEN_SLOT);
  assert.deepEqual(info.questions, []);
  assert.ok(info.urls.some((url) => url.includes("/api/reminders/inbound")));
  assert.ok(info.urls.some((url) => url.includes("batch=5") && url.includes("force=1")));
  console.log("reminder-inbound: all checks passed");
}

main().catch((error) => { console.error(error); process.exit(1); });
