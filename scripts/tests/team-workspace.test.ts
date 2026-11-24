/**
 * Team changes attach to the office owner, not to an admin's own account.
 * Run: npx tsx scripts/tests/team-workspace.test.ts
 */
import assert from "node:assert/strict";
import { resolveTeamWorkspace } from "../../src/lib/team-workspace";

assert.deepEqual(resolveTeamWorkspace("owner-1", null), { ownerId: "owner-1" });
assert.deepEqual(
  resolveTeamWorkspace("admin-2", { workspace_owner_id: "owner-1", permissions: { officeAdmin: true } }),
  { ownerId: "owner-1" },
);
assert.deepEqual(
  resolveTeamWorkspace("admin-2", { workspace_owner_id: "owner-1", permissions: { roleTier: "admin" } }),
  { ownerId: "owner-1" },
);
const staff = resolveTeamWorkspace("staff-3", { workspace_owner_id: "owner-1", permissions: { roleTier: "staff" } });
assert.equal("error" in staff, true);

console.log("team workspace ok");
