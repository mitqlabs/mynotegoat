import assert from "node:assert/strict";
import {
  ROLE_ACTIONS,
  ROLE_SETTINGS_KEY,
  actionAllowedFor,
  canEditRoleSettings,
  canSeeDashboardSection,
  defaultAdminAccess,
  deleteRuleFor,
  memberOverrideSummary,
  mergeStoredAccess,
  normalizeAdminAccess,
  pageAccessFor,
  permissionsWithoutOverrides,
  roleDefinitionsOf,
  roleTierOf,
  type AdminAccessSettings,
} from "../../src/lib/admin-access";
import { CLOUD_KEY_REGISTRY } from "../../src/lib/cloud-key-registry";
import { settingsSearchCatalog } from "../../src/lib/settings-catalog";

const defaults = defaultAdminAccess();

// ---- Defaults: today's behaviour, except Managers may edit Contacts -----------------------------
assert.equal(actionAllowedFor("manager", "contacts.edit", defaults), true, "manager edits contacts by default");
assert.equal(actionAllowedFor("manager", "contacts.create", defaults), true);
assert.equal(actionAllowedFor("staff", "contacts.create", defaults), true, "staff may still add");
assert.equal(actionAllowedFor("staff", "contacts.edit", defaults), false, "staff may not edit by default");
for (const a of ROLE_ACTIONS) {
  assert.equal(actionAllowedFor("owner", a.key, defaults), true, `owner ${a.key}`);
  assert.equal(actionAllowedFor("admin", a.key, defaults), true, `admin ${a.key}`);
}
assert.equal(pageAccessFor("manager", "billing", defaults), "none");
assert.equal(pageAccessFor("staff", "contacts", defaults), "edit");
assert.equal(pageAccessFor("staff", "settings", defaults), "none");
assert.equal(pageAccessFor("admin", "settings", defaults), "edit");
assert.equal(deleteRuleFor("manager", "patients", defaults), "password");
assert.equal(deleteRuleFor("staff", "patients", defaults), "never");
assert.equal(canSeeDashboardSection("manager", "statistics", defaults), false);
assert.equal(canSeeDashboardSection("staff", "reviews", defaults), false);
assert.equal(defaults.adminsCanEditRoles, false);

// ---- Changing the grid ----------------------------------------------------------------------------
const tightened = normalizeAdminAccess({
  ...defaults,
  roleActions: { manager: { "contacts.create": true, "contacts.edit": false }, staff: { "contacts.create": false, "contacts.edit": true } },
});
assert.equal(actionAllowedFor("manager", "contacts.edit", tightened), false);
assert.equal(actionAllowedFor("staff", "contacts.create", tightened), false);
assert.equal(actionAllowedFor("staff", "contacts.edit", tightened), true);
// Admin/owner can never be locked out by the grid
assert.equal(actionAllowedFor("admin", "contacts.edit", tightened), true);

// Junk / old rows never turn things on by accident
const junk = normalizeAdminAccess({ roleActions: { manager: { "contacts.edit": "yes" }, staff: null } });
assert.equal(actionAllowedFor("manager", "contacts.edit", junk), defaults.roleActions.manager["contacts.edit"]);
assert.equal(actionAllowedFor("staff", "contacts.edit", junk), false);
assert.deepEqual(normalizeAdminAccess(null).roleActions, defaults.roleActions);
assert.deepEqual(normalizeAdminAccess("garbage").roleActions, defaults.roleActions);

// ---- Who may change the grid ------------------------------------------------------------------------
assert.equal(canEditRoleSettings("owner", defaults), true);
assert.equal(canEditRoleSettings("admin", defaults), false, "admin can't edit roles unless the owner allows it");
assert.equal(canEditRoleSettings("manager", defaults), false);
assert.equal(canEditRoleSettings("staff", defaults), false);
const adminsAllowed: AdminAccessSettings = { ...defaults, adminsCanEditRoles: true };
assert.equal(canEditRoleSettings("admin", adminsAllowed), true);
assert.equal(canEditRoleSettings("manager", adminsAllowed), false);
assert.equal(canEditRoleSettings("staff", adminsAllowed), false);
assert.equal(canEditRoleSettings("owner", adminsAllowed), true);

// ---- Tier from a membership (owner / admin / manager / staff scenarios) ---------------------------------
assert.equal(roleTierOf(null), "owner");
assert.equal(roleTierOf({ isMember: false, officeAdmin: false }), "owner");
assert.equal(roleTierOf({ isMember: true, officeAdmin: false, permissions: { roleTier: "manager" } }), "manager");
assert.equal(roleTierOf({ isMember: true, officeAdmin: false, permissions: { roleTier: "staff" } }), "staff");
assert.equal(roleTierOf({ isMember: true, officeAdmin: true, permissions: { roleTier: "admin" } }), "admin");
assert.equal(roleTierOf({ isMember: true, officeAdmin: true }), "admin", "pre-roles office admins stay admins");
assert.equal(roleTierOf({ isMember: true, officeAdmin: false }), "staff");

// ---- Stored rows: the new role row wins; the old Admin Access row is the fallback ----------------------------
assert.equal(ROLE_SETTINGS_KEY, "casemate.role-settings.v1");
const legacyRow = { ...defaults, roleActions: undefined, deletePasswordHash: "h", deletePasswordSalt: "s", passwordAppliesToAdmins: true };
const fromLegacy = mergeStoredAccess(legacyRow, null);
assert.equal(actionAllowedFor("manager", "contacts.edit", fromLegacy), true, "legacy row → default actions");
assert.equal(fromLegacy.deletePasswordHash, "h");
assert.equal(fromLegacy.passwordAppliesToAdmins, true);

const roleRow = { ...roleDefinitionsOf(tightened), adminsCanEditRoles: true };
const merged = mergeStoredAccess(legacyRow, roleRow);
assert.equal(actionAllowedFor("manager", "contacts.edit", merged), false, "role row wins");
assert.equal(canEditRoleSettings("admin", merged), true);
assert.equal(merged.deletePasswordHash, "h", "delete password still comes from the Admin Access row");
assert.equal(merged.passwordAppliesToAdmins, true);

// The role row never carries the delete password
const stored = roleDefinitionsOf({ ...defaults, deletePasswordHash: "SECRET", deletePasswordSalt: "SALT" });
assert.equal(JSON.stringify(stored).includes("SECRET"), false);
assert.equal(JSON.stringify(stored).includes("SALT"), false);

// Nothing at all stored → defaults
assert.deepEqual(mergeStoredAccess(undefined, undefined).roleActions, defaults.roleActions);

// ---- Per-member overrides ---------------------------------------------------------------------------------------
assert.deepEqual(memberOverrideSummary(null), []);
assert.deepEqual(memberOverrideSummary({ roleTier: "staff" }), []);
assert.deepEqual(memberOverrideSummary({ hiddenSections: [] }), []);
assert.deepEqual(memberOverrideSummary({ hiddenSections: ["billing"] }), ["1 patient-page section hidden"]);
assert.deepEqual(memberOverrideSummary({ hiddenSections: ["a", "b"] }), ["2 patient-page sections hidden"]);
assert.equal(memberOverrideSummary({ billing: "edit", contacts: "view" }).length, 1);
assert.equal(memberOverrideSummary({ billing: "none" }).length, 0);

const withOverrides = {
  roleTier: "manager",
  officeAdmin: false,
  disabled: false,
  mainLocationId: "loc-1",
  hiddenSections: ["billing"],
  billing: "edit",
};
const reset = permissionsWithoutOverrides(withOverrides) as Record<string, unknown>;
assert.equal(reset.hiddenSections, undefined);
assert.equal(reset.billing, undefined);
assert.equal(reset.roleTier, "manager", "reset keeps the role");
assert.equal(reset.mainLocationId, "loc-1", "reset keeps main location");
assert.equal(reset.disabled, false, "reset keeps on/off");
assert.deepEqual(memberOverrideSummary(reset), []);
assert.equal(withOverrides.hiddenSections.length, 1, "reset doesn't mutate the original");

// ---- Wiring: the row syncs, and the section is findable -------------------------------------------------------
assert.equal(CLOUD_KEY_REGISTRY[ROLE_SETTINGS_KEY], "workspace", "role settings key is registered for cloud sync");
const entry = settingsSearchCatalog.find((e) => e.key === "adminAccess");
assert.ok(entry, "settings catalog has the roles section");
assert.equal(entry!.title, "Roles & Permissions");
for (const word of ["role", "roles", "permissions", "role settings", "role manager", "role approval"]) {
  assert.ok((entry!.aliases ?? []).some((a) => a.toLowerCase() === word), `alias "${word}"`);
}

console.log("PASS role-settings (owner / admin / manager / staff, mock data)");
