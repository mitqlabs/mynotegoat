import assert from "node:assert/strict";
import { emailOptionLabel, emailOptionsOf, mailtoHref } from "../../src/lib/contact-email";

const opts = emailOptionsOf({
  email: "front@example.com",
  emails: [
    { name: "Jason", label: "Paralegal", email: "jason@example.com" },
    { name: "", label: "", email: "atty@example.com", main: true },
    { name: "", label: "", email: "ATTY@example.com" },
    { name: "", label: "", email: " " },
  ],
});
assert.deepEqual(opts.map((e) => e.email), ["atty@example.com", "jason@example.com"]);
assert.equal(emailOptionLabel(opts[1]), "jason@example.com (Jason · Paralegal)");
assert.equal(emailOptionLabel(opts[0]), "atty@example.com");
assert.deepEqual(emailOptionsOf({ email: "legacy@example.com" }).map((e) => e.email), ["legacy@example.com"]);
assert.deepEqual(emailOptionsOf({}), []);
assert.deepEqual(emailOptionsOf(null), []);
assert.equal(mailtoHref(" atty@example.com "), "mailto:atty@example.com");
assert.equal(mailtoHref("a+b@example.com"), "mailto:a%2Bb@example.com");
console.log("attorney email copy OK");
