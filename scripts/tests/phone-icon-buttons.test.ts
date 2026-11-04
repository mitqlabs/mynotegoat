import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Patient Phone: Text and Add to Contacts are icon buttons with names for hover + screen readers.
const src = readFileSync("src/components/patient-case-file.tsx", "utf8");
assert.ok(src.includes('ariaLabel="Text this patient"'), "Text icon has a label");
assert.ok(src.includes('aria-label="Add to Contacts"'), "Add to Contacts icon has a label");
assert.ok(!src.includes('label="Text"'), "no text-only Text button");
assert.ok(!/>\s*Add to Contacts\s*<\/button>/.test(src), "no text-only Add to Contacts button");
const menu = readFileSync("src/components/sms-send-menu.tsx", "utf8");
assert.ok(menu.includes("aria-label={ariaLabel}") && menu.includes("title={ariaLabel}"), "SmsSendMenu passes the label");
console.log("phone icon buttons OK");
