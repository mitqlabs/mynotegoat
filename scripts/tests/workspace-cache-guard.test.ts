/**
 * Workspace cache guard — mock workspace ids only.
 * Run: npx tsx scripts/tests/workspace-cache-guard.test.ts
 */
import assert from "node:assert/strict";
import {
  isLocalCacheTrusted,
  canSeedEmptyCloud,
  canPushLocalToWorkspace,
  decideBootCache,
} from "../../src/lib/workspace-cache-guard";

const A = "mock-owner-a:main-office";
const B = "mock-owner-b:main-office";
const base = { tag: "", target: B, previousPointer: "", hasSyncAtForTarget: false };

// Incident replay: browser holds office A's cache, user opens office B (empty cloud).
assert.equal(decideBootCache({ ...base, tag: A, localHasData: true }), "discard-local");
assert.equal(canSeedEmptyCloud(A, B), false);
assert.equal(canPushLocalToWorkspace(A, B), false);
// Untagged cache, no pointer → can't prove origin → discard, never seed.
assert.equal(decideBootCache({ ...base, localHasData: true }), "discard-local");
assert.equal(canSeedEmptyCloud("", B), false);
// Untagged, pointer names B but never synced with B → discard.
assert.equal(decideBootCache({ ...base, previousPointer: B, localHasData: true }), "discard-local");
// Untagged, pointer names A (other office) even with sync → discard.
assert.equal(isLocalCacheTrusted({ ...base, previousPointer: A, hasSyncAtForTarget: true }), false);
// Legacy cache that provably synced with B → keep (but still can't seed an empty cloud untagged).
assert.equal(decideBootCache({ ...base, previousPointer: B, hasSyncAtForTarget: true, localHasData: true }), "keep-local");
assert.equal(canSeedEmptyCloud("", B), false);
// Tag beats pointer: tagged A with pointer B → discard.
assert.equal(isLocalCacheTrusted({ ...base, tag: A, previousPointer: B, hasSyncAtForTarget: true }), false);
// Exact match → keep, seed, push.
assert.equal(decideBootCache({ ...base, tag: B, localHasData: true }), "keep-local");
assert.equal(canSeedEmptyCloud(B, B), true);
assert.equal(canPushLocalToWorkspace(` ${B} `, B), true);
// Empty target never trusted.
assert.equal(isLocalCacheTrusted({ ...base, tag: "", target: "" }), false);
assert.equal(canSeedEmptyCloud("", ""), false);
// No local data → nothing to do.
assert.equal(decideBootCache({ ...base, tag: A, localHasData: false }), "nothing-local");
console.log("workspace-cache-guard: all assertions passed");
