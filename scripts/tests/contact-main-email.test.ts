import assert from "node:assert/strict";
import { mainEmailOf, withMainFirst } from "../../src/lib/contact-email";

const a = { name: "Jason", label: "Paralegal", email: "jason@example.com" };
const b = { name: "", label: "Intake", email: "intake@example.com" };
const c = { name: "", label: "", email: "atty@example.com" };
// None starred → first is main.
assert.deepEqual(withMainFirst([a, b]).map((e) => [e.email, Boolean(e.main)]), [["jason@example.com", true], ["intake@example.com", false]]);
// Starred one moves first; exactly one main even if several flagged.
const r = withMainFirst([a, { ...b, main: true }, { ...c, main: true }]);
assert.equal(r[0].email, "intake@example.com");
assert.equal(r.filter((e) => e.main).length, 1);
assert.equal(r.length, 3);
assert.equal(mainEmailOf({ email: "jason@example.com", emails: [a, { ...c, main: true }] }), "atty@example.com");
assert.equal(mainEmailOf({ email: "legacy@example.com" }), "legacy@example.com");
assert.equal(mainEmailOf({}), "");
console.log("contact main email OK");
