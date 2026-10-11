/**
 * Listener-leak guard counts LIVE listeners, not add() calls.
 * Regression for the 2026-10-10 false alarm ("keydown" on window, 50 handlers)
 * while typing G.O.A.T. questions with only a few real listeners.
 *
 * Run:  npx tsx scripts/tests/listener-leak-guard.test.ts
 */
import assert from "node:assert/strict";
import { setMaxListeners } from "node:events";
import {
  __leakGuardCounts,
  __resetLeakGuardForTests,
  installListenerLeakGuard,
} from "../../src/lib/listener-leak-guard";

// Minimal browser globals: Node's EventTarget behaves like window/document here.
const win = new EventTarget() as EventTarget & { dispatchEvent: EventTarget["dispatchEvent"] };
const doc = new EventTarget();
setMaxListeners(0, win, doc);
Object.assign(globalThis, { window: win, document: doc, location: { origin: "https://www.mynotegoat.com" } });

const alarms: { target: string; type: string; count: number }[] = [];
win.addEventListener("casemate:listener-leak-detected", (e) => alarms.push((e as CustomEvent).detail));
const quiet = console.error;
console.error = () => undefined;
console.trace = () => undefined;

installListenerLeakGuard();
const keydown = () => __leakGuardCounts().window.keydown ?? 0;
const press = () => win.dispatchEvent(new Event("keydown"));
const reset = () => {
  alarms.length = 0;
  __resetLeakGuardForTests();
};

// 1. One-shot listeners that fire (browser removes them; no remove call).
for (let i = 0; i < 80; i++) {
  win.addEventListener("keydown", () => undefined, { once: true });
  press();
}
assert.equal(keydown(), 0, "once listeners are not live after firing");
assert.equal(alarms.length, 0, "no alarm for self-removing one-shots");

// 2. Signal-removed listeners.
for (let i = 0; i < 80; i++) {
  const ac = new AbortController();
  win.addEventListener("keydown", () => undefined, { signal: ac.signal });
  ac.abort();
}
assert.equal(keydown(), 0, "aborted listeners are gone");
assert.equal(alarms.length, 0);

// 3. The same listener added again is one listener.
const same = () => undefined;
for (let i = 0; i < 80; i++) win.addEventListener("keydown", same);
assert.equal(keydown(), 1);
win.removeEventListener("keydown", same);
assert.equal(keydown(), 0);

// 4. A remove that doesn't match (wrong capture / never added) changes nothing.
const kept = () => undefined;
win.addEventListener("keydown", kept, true);
win.removeEventListener("keydown", kept); // capture mismatch: browser keeps it
win.removeEventListener("keydown", () => undefined);
assert.equal(keydown(), 1);
win.removeEventListener("keydown", kept, true);
assert.equal(keydown(), 0);

// 5. A real leak (distinct listeners never removed) still raises the banner.
reset();
for (let i = 0; i < 49; i++) win.addEventListener("keydown", () => undefined);
assert.equal(alarms.length, 0, "below threshold");
win.addEventListener("keydown", () => undefined);
assert.equal(keydown(), 50);
assert.deepEqual(alarms, [{ target: "window", type: "keydown", count: 50 }], "real leak still alarms");

// 6. Document is counted separately.
reset();
for (let i = 0; i < 30; i++) doc.addEventListener("focus", () => undefined);
assert.equal(__leakGuardCounts().document.focus, 30);
assert.equal(alarms.length, 1);
assert.equal(alarms[0].target, "document");

console.error = quiet;
console.log("listener-leak-guard: all 6 checks passed");
