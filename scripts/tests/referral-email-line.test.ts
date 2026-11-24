import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { findEmailContact } from "../../src/components/contact-email-line";
import { emailOptionsOf } from "../../src/lib/contact-email";

const contacts = [
  { name: "Sample Imaging Center", email: "front@sample.test", emails: [{ name: "", label: "", email: "billing@sample.test" }, { name: "", label: "", email: "front@sample.test", main: true }] },
  { name: "Dr. Test Person", email: "" },
];
assert.equal(findEmailContact(contacts, "  sample imaging   center ")?.name, "Sample Imaging Center");
assert.equal(findEmailContact(contacts, ""), null);
assert.equal(emailOptionsOf(findEmailContact(contacts, "Sample Imaging Center"))[0].email, "front@sample.test", "starred first");
assert.equal(emailOptionsOf(findEmailContact(contacts, "Dr. Test Person")).length, 0, "no email -> hidden");
const src = readFileSync("src/components/patient-case-file.tsx", "utf8");
assert.equal((src.match(/<ContactEmailLine /g) ?? []).length, 3, "MRI, X-ray, Specialist cards");
const comp = readFileSync("src/components/contact-email-line.tsx", "utf8");
assert.ok(comp.includes("text-xs text-[var(--text-muted)]") && comp.includes("return null"), "small, muted, hidden when empty");
console.log("referral email line OK");
