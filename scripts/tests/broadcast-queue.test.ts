/**
 * G.O.A.T. /text queue (src/lib/broadcast-queue.ts) against a fake Supabase client. Mock data only.
 * Run: npx tsx scripts/tests/broadcast-queue.test.ts
 */
import assert from "node:assert/strict";
import { BROADCAST_MAX, loadTextRecipients, queueBroadcast, readMacSeen, type Db } from "../../src/lib/broadcast-queue";
import { defaultSmsReminderSettings } from "../../src/lib/sms-reminders";

type Row = Record<string, unknown>;
interface Fake { db: Db; inserts: Array<{ table: string; rows: Row[] }>; updates: Array<{ table: string; patch: Row }>; }

/** A tiny chainable stand-in for the Supabase query builder: eq / in / order / range / insert / update / select / single. */
function fake(tables: Record<string, Row[]>, opts: { failInsertOn?: string; failInsertAfter?: number; failRead?: string } = {}): Fake {
  const inserts: Fake["inserts"] = [];
  const updates: Fake["updates"] = [];
  let recipientInserts = 0;
  const from = (table: string) => {
    let rows = tables[table] ?? [];
    let mode: "read" | "insert" | "update" = "read";
    let payload: Row[] = [];
    let patch: Row = {};
    let single = false;
    let rangeArgs: [number, number] | null = null;
    const q: Record<string, unknown> = {};
    const run = (): { data: unknown; error: { message: string } | null } => {
      if (mode === "insert") {
        if (opts.failInsertOn === table) {
          recipientInserts++;
          if (recipientInserts > (opts.failInsertAfter ?? 0)) return { data: null, error: { message: "boom" } };
        }
        inserts.push({ table, rows: payload });
        return { data: single ? { id: "b1" } : payload, error: null };
      }
      if (mode === "update") { updates.push({ table, patch }); return { data: null, error: null }; }
      if (opts.failRead === table) return { data: null, error: { message: "read failed" } };
      const out = rangeArgs ? rows.slice(rangeArgs[0], rangeArgs[1] + 1) : rows;
      return { data: out, error: null };
    };
    q.select = () => q;
    q.eq = (col: string, val: unknown) => { if (mode === "read") rows = rows.filter((r) => !(col in r) || r[col] === val); return q; };
    q.in = (col: string, vals: unknown[]) => { rows = rows.filter((r) => vals.includes(r[col])); return q; };
    q.order = () => q;
    q.range = (a: number, b: number) => { rangeArgs = [a, b]; return q; };
    q.insert = (r: Row | Row[]) => { mode = "insert"; payload = Array.isArray(r) ? r : [r]; return q; };
    q.update = (p: Row) => { mode = "update"; patch = p; return q; };
    q.single = () => { single = true; return q; };
    q.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(run()).then(res, rej);
    return q;
  };
  return { db: { from } as unknown as Db, inserts, updates };
}

const W = "ws1";
const P = (id: string, name: string, phone: string, status = "Active", off = false): Row => ({ id, workspace_id: W, full_name: name, phone, case_status: status, text_reminders_off: off });
const patients = [
  P("p1", "Ann Sample", "(817) 555-0101"),
  P("p2", "Bob Mock", "817-555-0102"),
  P("p3", "Cy Dupe", "1 (817) 555-0101"), // same phone as Ann
  P("p4", "Di Stop", "817-555-0104", "Active", true),
  P("p5", "Ed Nophone", ""),
  P("p6", "Flo Paid", "817-555-0106", "Paid"),
  P("p7", "Gus Discharged", "817-555-0107", "Discharged"),
];
// 2026-10-28 is a Wednesday; noon Central = 17:00Z (CDT, UTC-5).
const noonToday = new Date("2026-10-28T17:00:00Z");
const lateNight = new Date("2026-10-29T03:30:00Z"); // 10:30 PM Central on the 28th: quiet hours
const settings = { ...defaultSmsReminderSettings(), timeZone: "America/Chicago" };

async function main() {
  // ---- all active patients: the PR #147 active rule + dedupe + skips ----
  const a = await loadTextRecipients(fake({ patients }).db, W, { kind: "active" }, settings, noonToday);
  assert.ok(a);
  assert.deepEqual(a.recipients.map((r) => r.patientId).sort(), ["p1", "p2"], "active only, one per phone, no STOP, no phone-less");
  assert.deepEqual(a.skipped, { optedOut: 1, noPhone: 1, sharedPhone: 1 });
  assert.equal(a.date, "2026-10-28");
  assert.equal(a.deferred, false);

  // quiet hours: target_date moves to the next send day and the card says it is deferred
  const night = await loadTextRecipients(fake({ patients }).db, W, { kind: "active" }, settings, lateNight);
  assert.ok(night);
  assert.equal(night.deferred, true);
  assert.equal(night.date, "2026-10-29");

  // a read error is null (never a guessed list)
  assert.equal(await loadTextRecipients(fake({ patients }, { failRead: "patients" }).db, W, { kind: "active" }, settings, noonToday), null);

  // paging: >1000 patients are all read
  const many = Array.from({ length: 2300 }, (_, i) => P(`m${i}`, `Mock ${i}`, `817-${String(100 + Math.floor(i / 10000)).padStart(3, "0")}-${String(i).padStart(4, "0")}`));
  const big = await loadTextRecipients(fake({ patients: many }).db, W, { kind: "active" }, settings, noonToday);
  assert.equal(big!.recipients.length, 2300);

  // ---- everyone scheduled a day ----
  const appts: Row[] = [
    { id: "a1", workspace_id: W, patient_id: "p1", patient_name: "Ann Sample", date: "2026-10-29", start_time: "09:00", status: "Scheduled" },
    { id: "a2", workspace_id: W, patient_id: "p2", patient_name: "Bob Mock", date: "2026-10-29", start_time: "10:00", status: "Canceled" },
    { id: "a3", workspace_id: W, patient_id: "p3", patient_name: "Cy Dupe", date: "2026-10-29", start_time: "11:00", status: "Scheduled" },
    { id: "a4", workspace_id: W, patient_id: "p4", patient_name: "Di Stop", date: "2026-10-29", start_time: "12:00", status: "Check In" },
    { id: "a5", workspace_id: W, patient_id: "p5", patient_name: "Ed Nophone", date: "2026-10-29", start_time: "13:00", status: "Scheduled" },
    { id: "a6", workspace_id: W, patient_id: "p6", patient_name: "Flo Paid", date: "2026-10-30", start_time: "09:00", status: "Scheduled" },
  ];
  const b = await loadTextRecipients(fake({ patients, schedule_appointments: appts }).db, W, { kind: "booked", date: "2026-10-29" }, settings, noonToday);
  assert.ok(b);
  assert.deepEqual(b.recipients.map((r) => r.patientId), ["p1"], "canceled visit, STOP, shared phone and no-phone are left out; other days are ignored");
  assert.equal(b.date, "2026-10-29");
  assert.equal(b.skipped.optedOut, 1);
  assert.equal(b.skipped.noPhone, 1);
  assert.equal(b.skipped.sharedPhone, 1);
  // today: visits already past are skipped
  const todayAppts: Row[] = [
    { id: "t1", workspace_id: W, patient_id: "p1", patient_name: "Ann Sample", date: "2026-10-28", start_time: "09:00", status: "Scheduled" },
    { id: "t2", workspace_id: W, patient_id: "p2", patient_name: "Bob Mock", date: "2026-10-28", start_time: "15:00", status: "Scheduled" },
  ];
  const t = await loadTextRecipients(fake({ patients, schedule_appointments: todayAppts }).db, W, { kind: "booked", date: "2026-10-28" }, settings, noonToday);
  assert.deepEqual(t!.recipients.map((r) => r.patientId), ["p2"]);

  // ---- exact patients (single patient, or the ones just canceled): same phone / STOP rules ----
  const one = await loadTextRecipients(fake({ patients }).db, W, { kind: "patients", ids: ["p1"], label: "Ann Sample" }, settings, noonToday);
  assert.deepEqual(one!.recipients.map((r) => r.patientId), ["p1"]);
  const stop = await loadTextRecipients(fake({ patients }).db, W, { kind: "patients", ids: ["p4"], label: "Di Stop" }, settings, noonToday);
  assert.equal(stop!.recipients.length, 0, "a STOP patient is never texted, even when picked by name");
  assert.equal(stop!.skipped.optedOut, 1);
  const paid = await loadTextRecipients(fake({ patients }).db, W, { kind: "patients", ids: ["p6"], label: "Flo Paid" }, settings, noonToday);
  assert.equal(paid!.recipients.length, 1, "a named patient is texted whatever their case status");
  // just-canceled patients are still reachable (canceled visits do not drop them)
  const canceled = await loadTextRecipients(fake({ patients, schedule_appointments: appts }).db, W, { kind: "patients", ids: ["p2"], label: "Bob Mock" }, settings, noonToday);
  assert.deepEqual(canceled!.recipients.map((r) => r.patientId), ["p2"]);

  // ---- queueing ----
  const recips = a.recipients;
  const f1 = fake({});
  const ok = await queueBroadcast(f1.db, W, { message: "  We're closed Friday.  ", date: "2026-10-28", recipients: recips, booked: false });
  assert.deepEqual(ok, { ok: true, broadcastId: "b1", count: 2 });
  assert.equal(f1.inserts[0].table, "reminder_broadcasts");
  assert.equal(f1.inserts[0].rows[0].message, "We're closed Friday.");
  assert.equal(f1.inserts[0].rows[0].target_date, "2026-10-28");
  assert.equal(f1.inserts[0].rows[0].workspace_id, W);
  assert.equal(f1.inserts[1].table, "reminder_broadcast_recipients");
  assert.equal(f1.inserts[1].rows.length, 2);
  assert.ok(f1.inserts[1].rows.every((r) => r.broadcast_id === "b1" && r.workspace_id === W));
  assert.ok(f1.inserts[1].rows.every((r) => /^\d{4}$/.test(String(r.phone_last4))), "only the last 4 digits are stored");
  assert.equal(f1.updates.length, 0);

  // chunks of 500
  const bigRecips = big!.recipients;
  const f2 = fake({});
  const r2 = await queueBroadcast(f2.db, W, { message: "Hi", date: "2026-10-28", recipients: bigRecips, booked: false });
  assert.equal(r2.ok && r2.count, 2300);
  assert.deepEqual(f2.inserts.filter((i) => i.table === "reminder_broadcast_recipients").map((i) => i.rows.length), [500, 500, 500, 500, 300]);

  // all-or-nothing: a failed recipient chunk cancels the broadcast
  const f3 = fake({}, { failInsertOn: "reminder_broadcast_recipients", failInsertAfter: 1 });
  const r3 = await queueBroadcast(f3.db, W, { message: "Hi", date: "2026-10-28", recipients: bigRecips, booked: false });
  assert.equal(r3.ok, false);
  assert.equal(f3.updates.length, 1);
  assert.equal(f3.updates[0].table, "reminder_broadcasts");
  assert.ok(typeof f3.updates[0].patch.canceled_at === "string");

  // guards: nothing is inserted for an empty / too-long message, nobody to text, or no workspace
  for (const [msg, rs, ws] of [["   ", recips, W], ["x".repeat(BROADCAST_MAX + 1), recips, W], ["Hi", [], W], ["Hi", recips, ""]] as const) {
    const f = fake({});
    const r = await queueBroadcast(f.db, ws, { message: msg, date: "2026-10-28", recipients: [...rs], booked: false });
    assert.equal(r.ok, false);
    assert.equal(f.inserts.length, 0);
  }
  assert.equal((await queueBroadcast(fake({}).db, W, { message: "x".repeat(BROADCAST_MAX), date: "2026-10-28", recipients: recips, booked: false })).ok, true);

  // ---- Mac seen: only a Mac that has actually checked in counts ----
  assert.equal(await readMacSeen(fake({ reminder_devices: [] }).db, W), false);
  const now = new Date().toISOString();
  assert.equal(await readMacSeen(fake({ reminder_devices: [{ workspace_id: W, kind: "iphone", revoked_at: null, last_seen_at: now, last_run_at: now }] }).db, W), false);
  assert.equal(await readMacSeen(fake({ reminder_devices: [{ workspace_id: W, kind: "mac", revoked_at: null, last_seen_at: now, last_run_at: now }] }).db, W), true);

  console.log("broadcast-queue: all passed");
}
main().catch((e) => { console.error(e); process.exit(1); });
