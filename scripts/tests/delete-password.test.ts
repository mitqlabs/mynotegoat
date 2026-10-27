/**
 * One delete password for the office: saved as a hash in the cloud Admin Access
 * settings, read by the patient-delete window for owner AND team members.
 * Mock passwords only.
 * Run:  npx tsx scripts/tests/delete-password.test.ts
 */
import assert from "node:assert/strict";
import {
  checkDeletePassword,
  defaultAdminAccess,
  hashDeletePassword,
  normalizeAdminAccess,
  deleteRuleFor,
} from "../../src/lib/admin-access";

async function main() {
  // Nothing set anywhere -> "none" (modal shows the 'set one first' message).
  assert.equal(await checkDeletePassword(defaultAdminAccess(), "", "anything"), "none");
  assert.equal(await checkDeletePassword(defaultAdminAccess(), "   ", ""), "none");

  // Owner sets a password: hash goes to the cloud blob (JSON round-trip like workspace_kv).
  const { salt, hash } = await hashDeletePassword("mock-pass-1");
  assert.notEqual(hash, "mock-pass-1");
  const cloudBlob = JSON.parse(JSON.stringify({ ...defaultAdminAccess(), deletePasswordSalt: salt, deletePasswordHash: hash }));

  // Another device / a team member reads only the cloud blob (no local office password) -> works.
  const asMember = normalizeAdminAccess(cloudBlob);
  assert.equal(await checkDeletePassword(asMember, "", "mock-pass-1"), "ok");
  assert.equal(await checkDeletePassword(asMember, "", "wrong"), "wrong");
  assert.equal(await checkDeletePassword(asMember, "", ""), "wrong");

  // Offices from before the change still have the plaintext Office password: it keeps working.
  assert.equal(await checkDeletePassword(defaultAdminAccess(), "legacy-pw", "legacy-pw"), "ok");
  assert.equal(await checkDeletePassword(defaultAdminAccess(), "legacy-pw", "nope"), "wrong");

  // Same password hashed twice gets different salts, both verify.
  const second = await hashDeletePassword("mock-pass-1");
  assert.notEqual(second.salt, salt);
  assert.equal(
    await checkDeletePassword({ ...asMember, deletePasswordSalt: second.salt, deletePasswordHash: second.hash }, "", "mock-pass-1"),
    "ok",
  );

  // Removing it (empty hash) goes back to "none".
  assert.equal(await checkDeletePassword({ ...asMember, deletePasswordSalt: "", deletePasswordHash: "" }, "", "mock-pass-1"), "none");

  // Role gate: a manager set to "With password" is satisfied by the modal's own password box.
  const access = defaultAdminAccess();
  access.roleDeletes.manager.patients = "password";
  assert.equal(deleteRuleFor("manager", "patients", access), "password");
  assert.equal(deleteRuleFor("owner", "patients", access), "allowed");

  console.log("delete-password tests passed");
}
void main();
