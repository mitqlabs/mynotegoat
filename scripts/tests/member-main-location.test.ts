/**
 * Team member "Main location": saves only when the database really took it, survives reload (normalize),
 * and applies at the member's login without restricting them. Mock data only.
 * Run:  npx tsx scripts/tests/member-main-location.test.ts
 */
import assert from "node:assert/strict";
import { persistMemberPermissions, type MemberPermsClient } from "../../src/lib/member-permissions-save";
import { resolveLoginLocation } from "../../src/lib/location-view";
import { normalizePermissions } from "../../src/lib/team-permissions";

// location-view touches `window` only inside functions guarded by typeof window.

let passed = 0;
const test = async (name: string, fn: () => void | Promise<void>) => { await fn(); passed++; console.log(`ok - ${name}`); };

/** A fake workspace_members table that behaves like RLS: only the owner's updates land. */
function fakeClient(rows: Array<{ member_user_id: string; permissions: Record<string, unknown> }>, asOwner: boolean, failWith?: string): MemberPermsClient {
  return {
    from: () => ({
      update: (values) => ({
        eq: (_col, id) => ({
          select: async () => {
            if (failWith) return { data: null, error: { message: failWith } };
            const hit = asOwner ? rows.filter((r) => r.member_user_id === id) : [];
            hit.forEach((r) => { r.permissions = values.permissions as Record<string, unknown>; });
            return { data: hit.map((r) => ({ member_user_id: r.member_user_id })), error: null };
          },
        }),
      }),
    }),
  };
}
const rows = () => [{ member_user_id: "u-hannah", permissions: { roleTier: "staff", patients: "edit" } as Record<string, unknown> }];
const LOCS = ["loc-glendale", "loc-granbury"];

async function main() {
await test("owner saves main location → stored, and reload (normalize) keeps it", async () => {
  const db = rows();
  const next = { ...normalizePermissions(db[0].permissions), mainLocationId: "loc-granbury" };
  const r = await persistMemberPermissions(fakeClient(db, true), "u-hannah", next);
  assert.deepEqual(r, { ok: true });
  assert.equal(normalizePermissions(db[0].permissions).mainLocationId, "loc-granbury");
  assert.equal(normalizePermissions(db[0].permissions).roleTier, "staff"); // other access untouched
  assert.equal(normalizePermissions(db[0].permissions).patients, "edit");
});
await test("clearing it (All locations) removes the key", async () => {
  const db = rows();
  db[0].permissions.mainLocationId = "loc-granbury";
  const next = { ...normalizePermissions(db[0].permissions) };
  delete next.mainLocationId;
  await persistMemberPermissions(fakeClient(db, true), "u-hannah", next);
  assert.equal(normalizePermissions(db[0].permissions).mainLocationId, undefined);
});
await test("a save the database refuses (non-owner, 0 rows, no error) is NOT reported as saved", async () => {
  const db = rows();
  const r = await persistMemberPermissions(fakeClient(db, false), "u-hannah", { mainLocationId: "loc-granbury" });
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.error, /owner/i);
  assert.equal(db[0].permissions.mainLocationId, undefined);
});
await test("a database error is surfaced", async () => {
  const r = await persistMemberPermissions(fakeClient(rows(), true, "boom"), "u-hannah", {});
  assert.deepEqual(r, { ok: false, error: "boom" });
});

await test("login: member with no stored choice starts on their main location", () => {
  assert.equal(resolveLoginLocation({ userId: "u-hannah", main: "loc-granbury", locationIds: LOCS, stored: null, applied: null }), "loc-granbury");
});
await test("login: a member who switched to another location is NOT forced back (not a restriction)", () => {
  assert.equal(resolveLoginLocation({ userId: "u-hannah", main: "loc-granbury", locationIds: LOCS, stored: "loc-glendale", applied: "u-hannah:loc-granbury" }), null);
  assert.equal(resolveLoginLocation({ userId: "u-hannah", main: "loc-granbury", locationIds: LOCS, stored: "", applied: "u-hannah:loc-granbury" }), null); // chose "All"
});
await test("login: the owner changing the main location reaches a device that already has a stored choice", () => {
  assert.equal(resolveLoginLocation({ userId: "u-hannah", main: "loc-granbury", locationIds: LOCS, stored: "loc-glendale", applied: "u-hannah:loc-glendale" }), "loc-granbury");
  assert.equal(resolveLoginLocation({ userId: "u-hannah", main: "loc-granbury", locationIds: LOCS, stored: "loc-glendale", applied: null }), "loc-granbury");
});
await test("login: another user on the same browser doesn't inherit the marker", () => {
  assert.equal(resolveLoginLocation({ userId: "u-other", main: "loc-granbury", locationIds: LOCS, stored: "loc-glendale", applied: "u-hannah:loc-granbury" }), "loc-granbury");
});
await test("login: no main (owner / 'All locations') or a deleted location → leave the view alone", () => {
  assert.equal(resolveLoginLocation({ userId: "u", main: "", locationIds: LOCS, stored: null, applied: null }), null);
  assert.equal(resolveLoginLocation({ userId: "u", main: "loc-gone", locationIds: LOCS, stored: null, applied: null }), null);
});
console.log(`\n${passed} passed`);
}
main().catch((e) => { console.error(e); process.exit(1); });
