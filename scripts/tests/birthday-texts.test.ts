/**
 * Daily birthday texts: who gets one, the Feb 29 rule, once-a-year dedupe in the
 * (fake) cloud log, settings, ids, G.O.A.T. help, and the route wiring. Mock data only.
 * Run: npx tsx scripts/tests/birthday-texts.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  birthdayDobSuffixes,
  birthdayFirstName,
  birthdayPhone,
  DEFAULT_BIRTHDAY_MESSAGE,
  isBirthdayToday,
  isLeapYear,
  pickBirthdayRecipients,
  renderBirthdayText,
  type BirthdayPatient,
} from "../../src/lib/birthday-texts";
import { decodeQueueItemId, encodeBirthdayItemId } from "../../src/lib/reminder-automation";
import { ackBirthday, claimBirthdays, loadBirthdayQueue, type ReminderDevice } from "../../src/lib/reminder-server";
import { birthdayTextsHelp } from "../../src/lib/goat-reminders-help";
import { defaultSmsReminderSettings, normalizeSmsReminderSettings } from "../../src/lib/sms-reminders";

const on = { ...defaultSmsReminderSettings(), birthdayTexts: true };

// ---- dates ----
assert.equal(isLeapYear(2024), true);
assert.equal(isLeapYear(2026), false);
assert.equal(isLeapYear(1900), false);
assert.equal(isLeapYear(2000), true);
assert.equal(isBirthdayToday("1990-11-02", "2026-11-02"), true);
assert.equal(isBirthdayToday("1990-11-03", "2026-11-02"), false);
assert.equal(isBirthdayToday("1990-02-29", "2026-02-28"), true, "Feb 29 -> Feb 28 in a non-leap year");
assert.equal(isBirthdayToday("1990-02-29", "2026-03-01"), false);
assert.equal(isBirthdayToday("1990-02-29", "2028-02-28"), false, "leap year: Feb 28 is not the day");
assert.equal(isBirthdayToday("1990-02-29", "2028-02-29"), true);
assert.equal(isBirthdayToday("1990-02-28", "2026-02-28"), true);
assert.equal(isBirthdayToday("", "2026-11-02"), false);
assert.equal(isBirthdayToday("11/02/1990", "2026-11-02"), false, "only saved ISO dates");
assert.equal(isBirthdayToday("1990-02-30", "2026-02-28"), false, "not a real date");
assert.deepEqual(birthdayDobSuffixes("2026-11-02"), ["11-02"]);
assert.deepEqual(birthdayDobSuffixes("2026-02-28").sort(), ["02-28", "02-29"]);
assert.deepEqual(birthdayDobSuffixes("2028-02-28"), ["02-28"]);

// ---- message ----
assert.equal(DEFAULT_BIRTHDAY_MESSAGE, "Happy birthday, {first name}! From all of us at Prime Spine.");
assert.equal(renderBirthdayText(DEFAULT_BIRTHDAY_MESSAGE, "Sample, Ann"), "Happy birthday, Ann! From all of us at Prime Spine.");
assert.equal(renderBirthdayText("Hi {First Name}!", "Ann Sample"), "Hi Ann!");
assert.equal(renderBirthdayText("Hi {first_name} / {{FIRST_NAME}}", "ANN SAMPLE"), "Hi Ann / Ann");
assert.equal(renderBirthdayText("   ", "Ann Sample"), "Happy birthday, Ann! From all of us at Prime Spine.", "blank -> default");
assert.equal(birthdayFirstName("mary jane watson"), "Mary");
assert.equal(birthdayFirstName("McDonald, Ron"), "Ron");
assert.equal(birthdayPhone("(817) 555-0101"), "+18175550101");
assert.equal(birthdayPhone("1-817-555-0101"), "+18175550101");
assert.equal(birthdayPhone("555-0101"), "");

// ---- who gets one ----
const pt = (id: string, name: string, over: Partial<BirthdayPatient> = {}): BirthdayPatient => ({
  patientId: id, fullName: name, dob: "1985-11-02", phone: "817-555-01" + id.padStart(2, "0"), caseStatus: "Active", ...over,
});
const today = "2026-11-02";
const picks = pickBirthdayRecipients(
  [
    pt("1", "Sample, Ann"),
    pt("2", "Bob Mock", { caseStatus: "Discharged" }),
    pt("3", "Cy Stop", { optedOut: true }),
    pt("4", "Di Nophone", { phone: "" }),
    pt("5", "Ed Wrongday", { dob: "1985-11-03" }),
    pt("6", "Flo Paid", { caseStatus: "Paid" }),
    pt("7", "Gus Ready", { caseStatus: "Ready to Submit" }),
    pt("8", "Hal Nodob", { dob: "" }),
    pt("9", "Ivy Active", { caseStatus: "active" }),
    pt("1", "Sample, Ann"), // duplicate row
  ],
  today,
  on,
);
assert.deepEqual(picks.map((p) => p.patientId).sort(), ["1", "9"], "active, not opted out, birthday today, has phone");
assert.ok(picks.every((p) => /^\+1\d{10}$/.test(p.phone)));
assert.ok(picks.find((p) => p.patientId === "1")!.text.startsWith("Happy birthday, Ann! From all of us at Prime Spine."));
const noLine = pickBirthdayRecipients([pt("1", "Ann Sample")], today, { birthdayMessage: "Hi {first name}", optOutLine: false });
assert.equal(noLine[0].text, "Hi Ann");
const withLine = pickBirthdayRecipients([pt("1", "Ann Sample")], today, { birthdayMessage: "Hi {first name}", optOutLine: true, optOutText: "Reply STOP to opt out." });
assert.equal(withLine[0].text, "Hi Ann Reply STOP to opt out.");

// ---- settings ----
const d = defaultSmsReminderSettings();
assert.equal(d.birthdayTexts, false, "off by default");
assert.equal(d.birthdayMessage, DEFAULT_BIRTHDAY_MESSAGE);
assert.equal(normalizeSmsReminderSettings(null).birthdayTexts, false);
assert.equal(normalizeSmsReminderSettings({ birthdayTexts: "yes" }).birthdayTexts, false, "only true turns it on");
assert.equal(normalizeSmsReminderSettings({ birthdayTexts: true, birthdayMessage: "  Hi {first name}  " }).birthdayMessage, "Hi {first name}");
assert.equal(normalizeSmsReminderSettings({ birthdayMessage: "   " }).birthdayMessage, DEFAULT_BIRTHDAY_MESSAGE);
assert.equal(normalizeSmsReminderSettings({ birthdayMessage: "x".repeat(900) }).birthdayMessage.length, 320);

// ---- queue item ids ----
assert.equal(encodeBirthdayItemId(2026, "p-1"), "bd:2026:p-1");
assert.deepEqual(decodeQueueItemId("bd:2026:p-1", "2026-11-02"), { kind: "birthday", year: 2026, patientId: "p-1" });
assert.notEqual(decodeQueueItemId("b:abc", "2026-11-02")?.kind, "birthday");

// ---- the cloud log (in-memory fake of just what the server code touches) ----
type Row = Record<string, unknown>;
function fakeAdmin(init: { patients: Row[]; log?: Row[]; logMissing?: boolean }) {
  const tables: Record<string, Row[]> = { patients: init.patients, birthday_text_log: init.log ?? [] };
  const from = (table: string) => {
    if (table === "birthday_text_log" && init.logMissing) {
      const dead: Record<string, unknown> = {};
      const err = { data: null, error: { message: "relation does not exist" } };
      for (const k of ["select", "eq", "in", "insert", "update", "or", "limit", "maybeSingle"]) dead[k] = () => dead;
      dead.then = (res: (v: unknown) => unknown) => Promise.resolve(err).then(res);
      return dead;
    }
    const rows = tables[table];
    let mode: "read" | "insert" | "update" = "read";
    let payload: Row = {};
    let patch: Row = {};
    const filters: Array<(r: Row) => boolean> = [];
    let one = false;
    const q: Record<string, unknown> = {};
    const matches = () => rows.filter((r) => filters.every((f) => f(r)));
    const run = (): { data: unknown; error: { message: string } | null } => {
      if (mode === "insert") {
        if (rows.some((r) => r.workspace_id === payload.workspace_id && r.patient_id === payload.patient_id && r.year === payload.year)) {
          return { data: null, error: { message: "duplicate key" } };
        }
        rows.push({ id: `row${rows.length + 1}`, ...payload });
        return { data: null, error: null };
      }
      if (mode === "update") {
        const hit = matches();
        for (const r of hit) Object.assign(r, patch);
        return { data: hit.map((r) => ({ id: r.id })), error: null };
      }
      const hit = matches();
      return { data: one ? (hit[0] ?? null) : hit, error: null };
    };
    q.select = () => q;
    q.eq = (c: string, v: unknown) => { filters.push((r) => r[c] === v); return q; };
    q.in = (c: string, vs: unknown[]) => { filters.push((r) => vs.includes(r[c])); return q; };
    q.or = (expr: string) => {
      const sufs = expr.split(",").map((x) => x.replace("dob.like.*", ""));
      filters.push((r) => sufs.some((s) => String(r.dob ?? "").endsWith(s)));
      return q;
    };
    q.limit = () => q;
    q.maybeSingle = () => { one = true; return q; };
    q.insert = (p: Row) => { mode = "insert"; payload = p; return q; };
    q.update = (p: Row) => { mode = "update"; patch = p; return q; };
    q.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(run()).then(res, rej);
    return q;
  };
  return { admin: { from } as never, tables };
}

const W = "ws1";
const device: ReminderDevice = { id: "dev1", workspace_id: W, name: "Office iPhone", kind: "iphone", last_run_at: null, run_requested_until: null, is_primary: true };
const P = (id: string, name: string, over: Row = {}): Row => ({
  id, workspace_id: W, full_name: name, phone: "817-555-01" + id.padStart(2, "0"), dob: "1985-11-02", case_status: "Active", text_reminders_off: false, ...over,
});
const roster = [
  P("1", "Ann Sample"),
  P("2", "Bob Mock", { case_status: "Discharged" }),
  P("3", "Cy Stop", { text_reminders_off: true }),
  P("4", "Di Other", { dob: "1985-12-25" }),
  P("5", "Ed Elsewhere", { workspace_id: "ws2" }),
];

async function main() {
  // switch off -> nothing, and the log is never even needed
  {
    const { admin } = fakeAdmin({ patients: roster });
    assert.deepEqual(await loadBirthdayQueue(admin, device, today, defaultSmsReminderSettings(), { retryDryRun: true }), []);
  }

  // once a year: first call hands out Ann, a claim holds her, nobody gets her again
  {
    const { admin, tables } = fakeAdmin({ patients: roster });
    const q1 = await loadBirthdayQueue(admin, device, today, on, { retryDryRun: true });
    assert.deepEqual(q1.map((r) => r.patientId), ["1"], "active, not opted out, this workspace, birthday today");
    assert.equal(q1[0].year, 2026);
    const held = await claimBirthdays(admin, device, q1, new Date("2026-11-02T16:00:00Z"));
    assert.deepEqual([...held], ["1"]);
    assert.equal(tables.birthday_text_log.length, 1);
    assert.equal(tables.birthday_text_log[0].phone_last4, "0101", "only the last 4 digits are stored");
    assert.ok(!JSON.stringify(tables.birthday_text_log).includes("Happy birthday"), "no message text stored");
    // a second device claiming the same row at the same time loses
    const held2 = await claimBirthdays(admin, device, q1, new Date("2026-11-02T16:00:01Z"));
    assert.equal(held2.size, 0, "unique key: first claim wins");
    // claimed rows are never handed out again
    assert.deepEqual(await loadBirthdayQueue(admin, device, today, on, { retryDryRun: true }), []);
    // the device answers
    assert.equal(await ackBirthday(admin, device, 2026, "1", "sent", null, new Date("2026-11-02T16:00:05Z")), true);
    assert.equal(tables.birthday_text_log[0].status, "sent");
    assert.equal(await ackBirthday(admin, device, 2026, "1", "sent", null, new Date("2026-11-02T16:00:06Z")), false, "a repeat ack changes nothing");
    assert.deepEqual(await loadBirthdayQueue(admin, device, today, on, { retryDryRun: true }), []);
    // next year she is eligible again
    const next = await loadBirthdayQueue(admin, device, "2027-11-02", on, { retryDryRun: true });
    assert.deepEqual(next.map((r) => r.patientId), ["1"]);
    assert.equal(next[0].year, 2027);
  }

  // failed: retried, but only 3 tries in a year
  {
    const { admin, tables } = fakeAdmin({ patients: roster });
    const now = new Date("2026-11-02T16:00:00Z");
    for (let attempt = 1; attempt <= 3; attempt++) {
      const q = await loadBirthdayQueue(admin, device, today, on, { retryDryRun: true });
      assert.equal(q.length, 1, `attempt ${attempt} is handed out`);
      assert.equal((await claimBirthdays(admin, device, q, now)).size, 1);
      assert.equal(tables.birthday_text_log[0].attempts, attempt);
      assert.equal(await ackBirthday(admin, device, 2026, "1", "failed", "Messages error", now), true);
    }
    assert.deepEqual(await loadBirthdayQueue(admin, device, today, on, { retryDryRun: true }), [], "3 failures: stop for the year");
  }

  // test mode: logs dry-run rows once; a real send replaces them; a failed ack can't touch an unclaimed row
  {
    const { admin, tables } = fakeAdmin({ patients: roster });
    const now = new Date("2026-11-02T16:00:00Z");
    const q = await loadBirthdayQueue(admin, device, today, on, { retryDryRun: false });
    assert.equal(q.length, 1);
    assert.equal(await ackBirthday(admin, device, 2026, "1", "dry-run", null, now), true);
    assert.equal(tables.birthday_text_log[0].status, "dry-run");
    assert.equal(tables.birthday_text_log[0].phone_last4, "0101");
    assert.deepEqual(await loadBirthdayQueue(admin, device, today, on, { retryDryRun: false }), [], "test mode doesn't log the same test again");
    assert.equal(await ackBirthday(admin, device, 2026, "1", "sent", null, now), false, "cannot mark sent without a claim");
    const real = await loadBirthdayQueue(admin, device, today, on, { retryDryRun: true });
    assert.equal(real[0]?.prior, "dry-run", "a real send picks up where a test left off");
    assert.equal((await claimBirthdays(admin, device, real, now)).size, 1);
    assert.equal(tables.birthday_text_log[0].status, "claimed");
    // ack for a patient from another workspace or a wild year is ignored
    assert.equal(await ackBirthday(admin, device, 2026, "5", "dry-run", null, now), false, "other workspace's patient");
    assert.equal(await ackBirthday(admin, device, 2031, "1", "failed", null, now), false, "year far from now");
  }

  // missing table (migration not applied): no birthday texts at all
  {
    const { admin } = fakeAdmin({ patients: roster, logMissing: true });
    assert.deepEqual(await loadBirthdayQueue(admin, device, today, on, { retryDryRun: true }), []);
  }

  // Feb 29 patient on Feb 28 of a non-leap year, and not on Mar 1
  {
    const leapling = [P("9", "Lee Leap", { dob: "1992-02-29" }), P("8", "Ray Regular", { dob: "1990-02-28" })];
    const { admin } = fakeAdmin({ patients: leapling });
    const q = await loadBirthdayQueue(admin, device, "2026-02-28", on, { retryDryRun: true });
    assert.deepEqual(q.map((r) => r.patientId).sort(), ["8", "9"]);
    assert.deepEqual(await loadBirthdayQueue(admin, device, "2026-03-01", on, { retryDryRun: true }), []);
    const leap = await loadBirthdayQueue(admin, device, "2028-02-29", on, { retryDryRun: true });
    assert.deepEqual(leap.map((r) => r.patientId), ["9"]);
  }

  // ---- G.O.A.T. help (explains only) ----
  const help = birthdayTextsHelp("do we text patients happy birthday?", { sendHour: 8 });
  assert.ok(help && /Birthday texts/.test(help.text) && /8:00 AM/.test(help.text));
  assert.ok(birthdayTextsHelp("how do I turn on birthday texts"));
  assert.equal(birthdayTextsHelp("text john happy birthday"), null, "a request to send is not a question");
  assert.equal(birthdayTextsHelp("whose birthday is today"), null, "lookups belong to the rest of G.O.A.T.");
  assert.equal(birthdayTextsHelp("what's john smith's dob"), null);

  // ---- wiring (source checks) ----
  const queueRoute = readFileSync("src/app/api/reminders/queue/route.ts", "utf8");
  const ackRoute = readFileSync("src/app/api/reminders/ack/route.ts", "utf8");
  assert.ok(/loadBirthdayQueue/.test(queueRoute) && /claimBirthdays/.test(queueRoute) && /encodeBirthdayItemId/.test(queueRoute));
  assert.ok(/ackBirthday/.test(ackRoute) && /kind === "birthday"/.test(ackRoute));
  const panel = readFileSync("src/components/text-reminders-settings-panel.tsx", "utf8");
  assert.ok(/birthday-toggle/.test(panel) && /birthdayMessage/.test(panel));
  const handbook = readFileSync("src/lib/handbook-content.ts", "utf8");
  const goat = readFileSync("src/lib/handbook-goat.ts", "utf8");
  assert.ok(/Birthday texts/.test(handbook) && /Birthday texts/.test(goat));
  const sql = readFileSync("supabase/migrations/20261102090000_birthday_text_log.sql", "utf8");
  assert.ok(/unique \(workspace_id, patient_id, year\)/.test(sql) && /enable row level security/i.test(sql));

  console.log("birthday-texts: all checks passed");
}

main().catch((e) => { console.error(e); process.exit(1); });
