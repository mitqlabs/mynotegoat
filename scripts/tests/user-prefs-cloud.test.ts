import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { cloudBackingFor, isMirroredUserKey } from "../../src/lib/cloud-key-registry";
import { applyUserPrefRestore, mergePrefs, shouldRestorePref } from "../../src/lib/user-prefs-cloud";
import { SIDEBAR_ORDER_KEY } from "../../src/lib/sidebar-order";

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

const order = '["caseList","patients"]';
const same = { v: order, at: 100 };
assert.equal(shouldRestorePref(null, same, same), true, "wiped key, mirror timestamp unchanged");
assert.equal(shouldRestorePref(order, same, same), false, "stored value already matches");
assert.equal(shouldRestorePref('["patients"]', same, same), true, "stale stored value, mirror is as new");
assert.equal(shouldRestorePref('["patients"]', { v: order, at: 50 }, { v: order, at: 100 }), false, "merged older than the mirror");
assert.equal(shouldRestorePref(null, same, undefined), true, "no mirror entry yet");

const mem = new Map<string, string>();
const previous = (globalThis as { window?: unknown }).window;
(globalThis as { window?: unknown }).window = {
  localStorage: {
    getItem: (key: string) => mem.get(key) ?? null,
    setItem: (key: string, value: string) => {
      mem.set(key, value);
    },
  },
};
try {
  const mirror = { [SIDEBAR_ORDER_KEY]: same };
  applyUserPrefRestore(mirror, mirror);
  assert.equal(mem.get(SIDEBAR_ORDER_KEY), order, "missing key is written when the mirror timestamp matches");
  mem.set(SIDEBAR_ORDER_KEY, '["patients"]');
  applyUserPrefRestore({ [SIDEBAR_ORDER_KEY]: { v: order, at: 100 } }, { [SIDEBAR_ORDER_KEY]: { v: order, at: 40 } });
  assert.equal(mem.get(SIDEBAR_ORDER_KEY), '["patients"]', "an older merged value does not clobber storage");
} finally {
  if (previous === undefined) delete (globalThis as { window?: unknown }).window;
  else (globalThis as { window?: unknown }).window = previous;
}

const src = readFileSync("src/lib/user-prefs-cloud.ts", "utf8");
assert.match(src, /merged\.at >= mirror\.at/);
assert.match(src, /applyUserPrefRestore\(local, merged\)/);
assert.match(src, /inFlight/);
assert.doesNotMatch(src, /e\.at > local\[k\]\.at/);
console.log("user-prefs-cloud: ok");
