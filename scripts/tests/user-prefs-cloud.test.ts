import assert from "node:assert/strict";
import { cloudBackingFor, isMirroredUserKey } from "../../src/lib/cloud-key-registry";
import { mergePrefs } from "../../src/lib/user-prefs-cloud";

// Mock data only.
const a = { "casemate.contacts-sort.v1": { v: '{"key":"name"}', at: 100 }, "casemate.sidebar-collapsed": { v: "1", at: 50 } };
const b = { "casemate.contacts-sort.v1": { v: '{"key":"category"}', at: 200 }, "notegoat.sort.encounters-page": { v: "x", at: 10 } };
const m = mergePrefs(a, b);
assert.equal(m["casemate.contacts-sort.v1"].v, '{"key":"category"}', "newest wins");
assert.equal(Object.keys(m).length, 3, "nothing dropped");
assert.deepEqual(mergePrefs(b, a), m, "order-independent");
assert.deepEqual(mergePrefs({ bad: { v: 1 as unknown as string, at: 1 } }), {});

assert.equal(cloudBackingFor("casemate.cloud-sync-at.abc"), "system");
assert.equal(cloudBackingFor("notegoat.goat-chat.v1:patient-1"), "user");
assert.equal(cloudBackingFor("casemate.not-registered"), null);
assert.equal(isMirroredUserKey("casemate.contacts-sort.v1"), true);
assert.equal(isMirroredUserKey("casemate.referral-checked.v2"), false, "ticks have their own merge");
assert.equal(isMirroredUserKey("casemate.patient-billing.v1"), false, "workspace data not mirrored per user");
console.log("user-prefs-cloud: ok");
