import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Contact card: phone/fax/email rows sit in the text column right under the name
// (no avatar-height gap); the sub-category line renders only when filled.
const src = readFileSync("src/app/(portal)/contacts/page.tsx", "utf8");
assert.ok(!src.includes("pl-[2.625rem]"), "detail rows must not be a separate avatar-indented block");
const sub = src.indexOf("{contact.subCategory ? (");
const details = src.indexOf("{(contact.phone || contact.fax || contact.address || emailRows.length > 0) && (");
assert.ok(sub > 0 && details > sub, "details follow the optional sub-category line");
assert.ok(src.slice(sub, details).includes(") : null}"), "empty sub-category renders nothing");
console.log("contact card no gap OK");
