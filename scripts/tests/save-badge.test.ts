/**
 * The corner pill no longer repeats Saving / Saved. The circular G.O.A.T.
 * button already shows those. Waiting, offline, and a real failure stay
 * on the badge, because the button does not say them.
 * Run: npx tsx scripts/tests/save-badge.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { saveBadgeView } from "../../src/components/save-badge";

const quiet = { waiting: 0, offline: false };
const idle = { status: "synced" as const, unsyncedNotes: 0, errorDismissed: false };

assert.equal(saveBadgeView({ ...idle, status: "syncing" }, quiet), null);
assert.equal(saveBadgeView(idle, quiet), null);
assert.equal(saveBadgeView({ ...idle, status: "error", errorDismissed: true }, quiet), null);

assert.deepEqual(saveBadgeView({ ...idle, status: "error" }, quiet), { kind: "error" });
assert.deepEqual(saveBadgeView({ ...idle, unsyncedNotes: 2 }, quiet), { kind: "waiting", offline: false });
assert.deepEqual(saveBadgeView(idle, { waiting: 1, offline: false }), { kind: "waiting", offline: false });
assert.deepEqual(saveBadgeView(idle, { waiting: 1, offline: true }), { kind: "waiting", offline: true });
assert.deepEqual(saveBadgeView({ ...idle, status: "error" }, { waiting: 0, offline: true }), {
  kind: "waiting",
  offline: true,
});
assert.deepEqual(saveBadgeView(idle, { waiting: 0, offline: true }), { kind: "offline" });
// Notes still waiting on a cloud check stay on the badge while a write is in flight.
assert.deepEqual(saveBadgeView({ ...idle, status: "syncing", unsyncedNotes: 1 }, quiet), {
  kind: "waiting",
  offline: false,
});

const badge = readFileSync(new URL("../../src/components/save-badge.tsx", import.meta.url), "utf8");
assert.doesNotMatch(badge, /Saved ✓/);
assert.doesNotMatch(badge, /Saving…/);
assert.doesNotMatch(badge, /savedFlash/);
assert.match(badge, /Waiting to sync/);
assert.match(badge, /Offline/);
assert.match(badge, /Couldn&apos;t save/);
assert.match(badge, /Retry/);
assert.match(badge, /data-testid="save-badge-waiting"/);

const layout = readFileSync(new URL("../../src/app/(portal)/layout.tsx", import.meta.url), "utf8");
assert.doesNotMatch(layout, /savedFlash|showSavedFlash/);
assert.match(layout, /<SaveBadge/);
assert.match(layout, /unsyncedNotes=\{unsyncedNotes\}/);

const face = readFileSync(new URL("../../src/components/global-goat-button.tsx", import.meta.url), "utf8");
assert.match(face, /Saving…/);
assert.match(face, /"Saved"/);
assert.match(face, /Retry/);

console.log("save badge ok");
