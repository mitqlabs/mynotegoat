/**
 * Demo office: reset cannot touch another workspace, outbound sends are
 * blocked, and the fake charts pass the app's own checks.
 * Run: npx tsx scripts/tests/demo-office.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { patientToRow } from "../../src/lib/patients-cloud";
import { noteToRow } from "../../src/lib/encounter-notes-cloud";
import {
  assertDemoResetTarget,
  DEMO_OFFICE_ID,
  isDemoWorkspaceId,
  isProductionSupabaseUrl,
  PRODUCTION_SUPABASE_PROJECT_REF,
} from "../../src/lib/demo-office";
import { demoOutboundDecision, isBlockedDemoRequest } from "../../src/lib/demo-outbound";
import { DEMO_WORKSPACE_TABLES, resetDemoWorkspace, type DemoResetDb } from "../../src/lib/demo-reset";
import { buildDemoSeed, demoSeedProblems } from "../../src/lib/demo-seed";

const DEMO = "11111111-1111-4111-8111-111111111111:demo-office";
const OTHER = "22222222-2222-4222-8222-222222222222:main-office";
const LOOKALIKE = "33333333-3333-4333-8333-333333333333:demo-office";

assert.equal(isDemoWorkspaceId(DEMO), true);
assert.equal(isDemoWorkspaceId(OTHER), false);
assert.equal(isDemoWorkspaceId("11111111-1111-4111-8111-111111111111:demo-office:extra"), false);
assert.throws(() => assertDemoResetTarget(OTHER, DEMO));
assert.throws(() => assertDemoResetTarget(LOOKALIKE, DEMO));
assert.throws(() => assertDemoResetTarget(DEMO, ""));
assert.equal(assertDemoResetTarget(DEMO, DEMO), DEMO);
assert.equal(isProductionSupabaseUrl(`https://${PRODUCTION_SUPABASE_PROJECT_REF}.supabase.co`), true);
assert.equal(isProductionSupabaseUrl("http://127.0.0.1:54321"), false);

const seed = buildDemoSeed(new Date("2026-11-23T15:00:00"));
const problems = demoSeedProblems(seed);
assert.deepEqual(problems, [], problems.join("\n"));
assert.ok(seed.patients.length >= 25);
const row = patientToRow(seed.patients[0], DEMO);
assert.equal(row.workspace_id, DEMO);
assert.equal(row.full_name, seed.patients[0].fullName);
const note = noteToRow(seed.notes[0], DEMO);
assert.equal(note.workspace_id, DEMO);
assert.equal(note.soap.subjective.length > 0, true);

for (const action of ["sms", "email", "goat-mail", "ai", "share", "device", "invite", "billing", "admin"] as const) {
  assert.equal(demoOutboundDecision(DEMO, action).blocked, true, action);
  assert.equal(demoOutboundDecision(DEMO, action).message, "Demo: not sent");
  assert.equal(demoOutboundDecision(OTHER, action).blocked, false, action);
}
assert.equal(isBlockedDemoRequest("https://api.openai.com/v1/chat/completions", "POST"), true);
assert.equal(isBlockedDemoRequest("/api/goat-mail/connect", "GET"), true);
assert.equal(isBlockedDemoRequest("/api/stripe/portal", "POST"), true);
assert.equal(isBlockedDemoRequest("/api/reminders/queue", "GET"), true);
assert.equal(isBlockedDemoRequest("/rest/v1/patients", "POST"), false);
assert.equal(isBlockedDemoRequest("/storage/v1/object/user-files/file.pdf", "POST"), false);
assert.equal(isBlockedDemoRequest("/rest/v1/reminder_broadcasts", "POST"), true);
assert.equal(isBlockedDemoRequest("/rest/v1/reminder_devices?select=id", "GET"), false);

async function main() {
const calls: string[] = [];
const db: DemoResetDb = {
  async deleteEq(table, column, value) {
    calls.push(`delete ${table} ${column}=${value}`);
  },
  async upsert(table, rows) {
    calls.push(`upsert ${table} ${rows.length} ${String(rows[0]?.workspace_id ?? "")}`);
    for (const row of rows) {
      const id = String(row.workspace_id ?? "");
      if (id && id !== DEMO) throw new Error(`upsert left the demo workspace: ${id}`);
    }
  },
  async readLock() {
    return null;
  },
  async writeLock(id) {
    if (id !== DEMO) throw new Error("lock");
    calls.push(`lock ${id}`);
  },
  async removeStoragePrefix(bucket, userId) {
    calls.push(`storage ${bucket} ${userId}`);
  },
};

await assert.rejects(() => resetDemoWorkspace(db, OTHER, DEMO), /not the demo workspace/);
await assert.rejects(() => resetDemoWorkspace(db, LOOKALIKE, DEMO), /not the demo workspace/);
assert.equal(calls.length, 0, "a refused reset must not touch the database");

await resetDemoWorkspace(db, DEMO, DEMO, new Date("2026-11-23T15:00:00"));
const userId = DEMO.split(":")[0];
for (const call of calls) {
  assert.equal(call.includes(OTHER), false);
  assert.equal(call.includes(LOOKALIKE), false);
  assert.equal(call.includes(DEMO) || call.includes(userId), true, call);
}
for (const table of DEMO_WORKSPACE_TABLES) {
  assert.ok(calls.some((call) => call.startsWith(`delete ${table} workspace_id=${DEMO}`)), table);
}
assert.ok(calls.some((call) => call === `delete workspace_members workspace_owner_id=${userId}`));
assert.ok(calls.some((call) => call === `delete workspace_members member_user_id=${userId}`));
assert.equal(calls.filter((call) => call.startsWith("storage user-files")).length, 1);

const locked = { ...db, async readLock() { return OTHER; } };
await assert.rejects(() => resetDemoWorkspace(locked, DEMO, DEMO), /different workspace/);

const sql = readFileSync("supabase/migrations/20261123120000_demo_office_guard.sql", "utf8");
assert.match(sql, /new\.workspace_id = locked/);
assert.doesNotMatch(sql, /like|ilike|similar to/i);
assert.match(sql, /:demo-office/);
assert.match(readFileSync("vercel.json", "utf8"), /\/api\/demo\/reset/);
assert.match(readFileSync("src/app/auth/login/login-client.tsx", "utf8"), /Try the Demo/);
assert.equal(DEMO_OFFICE_ID, "demo-office");

console.log("demo-office tests passed");
}

void main();
