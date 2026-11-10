/**
 * Floating goat fills its circle and mirrors the cloud save status.
 * Run: npx tsx scripts/tests/goat-fab-save.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { onSyncStatusChange, reportCloudWriteError, reportCloudWriteStart, reportCloudWriteSuccess } from "../../src/lib/storage-sync-interceptor";

const face = readFileSync(new URL("../../src/components/global-goat-button.tsx", import.meta.url), "utf8");
assert.match(face, /object-cover/);
assert.match(face, /avatar-128\.png 128w/);
assert.match(face, /h-full w-full/);
assert.match(face, /Saving…/);
assert.match(face, /"Saved"/);
assert.match(face, /Retry/);
assert.match(face, /motion-reduce:transition-none/);
assert.match(face, /fixed bottom-4 right-4/);
assert.match(face, /Open G\.O\.A\.T\. chat/);
assert.doesNotMatch(face, /GoatAvatar size=\{36\}/);

const seen: string[] = [];
const offA = onSyncStatusChange((status) => seen.push(`a:${status}`));
const offB = onSyncStatusChange((status) => seen.push(`b:${status}`));
reportCloudWriteStart("fab-test");
reportCloudWriteSuccess("fab-test");
reportCloudWriteStart("fab-test-2");
reportCloudWriteError("fab-test-2", new Error("nope"));
offA();
reportCloudWriteStart("fab-test-3");
reportCloudWriteSuccess("fab-test-3");
offB();
assert.deepEqual(seen, ["a:syncing", "b:syncing", "a:synced", "b:synced", "a:syncing", "b:syncing", "a:error", "b:error", "b:syncing", "b:synced"]);

console.log("goat fab save ok");
