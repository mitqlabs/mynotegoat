/**
 * iPhone shortcut import links.
 * Run: npx tsx scripts/tests/shortcut-import.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  UNSIGNED_SHORTCUT_ERROR,
  buildShortcutLinks,
  genericShortcutLinks,
  icloudShortcutUrl,
  isSignedShortcut,
} from "../../src/lib/shortcut-import";

const template = readFileSync("src/lib/shortcuts/NoteGoat.template.shortcut");
assert.equal(template.subarray(0, 6).toString("utf8"), "bplist");
assert.equal(isSignedShortcut(template), false, "the shipped shortcut is an unsigned plist");
assert.equal(isSignedShortcut(Uint8Array.from([0x41, 0x45, 0x41, 0x31, 0])), true);
assert.equal(isSignedShortcut(Uint8Array.from([0x3c, 0x70, 0x6c, 0x69])), false);

const unsigned = buildShortcutLinks({
  origin: "https://www.mynotegoat.com/",
  ticket: "ticket",
  name: "NoteGoat",
  signed: false,
});
assert.equal(unsigned.importUrl, undefined);
assert.equal(unsigned.error, UNSIGNED_SHORTCUT_ERROR);
assert.equal(unsigned.fileUrl, "https://www.mynotegoat.com/api/reminders/shortcut/NoteGoat.shortcut?t=ticket");

const signed = buildShortcutLinks({
  origin: "https://www.mynotegoat.com",
  ticket: "abc/def",
  name: "NoteGoat",
  signed: true,
  ruleId: "visits",
});
assert.ok(signed.importUrl);
const encoded = signed.importUrl!.slice("shortcuts://import-shortcut?url=".length).split("&name=")[0];
assert.equal(decodeURIComponent(encoded), signed.fileUrl);
assert.equal(signed.importUrl!.includes("https://"), false);
assert.ok(signed.fileUrl.includes("/NoteGoat.shortcut?"));
assert.ok(signed.fileUrl.includes("rule=visits"));
assert.ok(signed.fileUrl.includes("t=abc%2Fdef"));
assert.ok(signed.importUrl!.endsWith("&name=NoteGoat"));

const link = "https://www.icloud.com/shortcuts/0123abcdEF";
assert.equal(icloudShortcutUrl(link), link);
assert.equal(icloudShortcutUrl("https://evil.example/shortcuts/0123abcdEF"), "");
assert.equal(icloudShortcutUrl("http://www.icloud.com/shortcuts/0123abcdEF"), "");
assert.equal(icloudShortcutUrl("https://www.icloud.com/shortcuts/api/records/0123abcdEF"), "");
const viaIcloud = buildShortcutLinks({
  origin: "https://www.mynotegoat.com",
  ticket: "ticket",
  name: "NoteGoat",
  signed: false,
  icloudUrl: "https://www.icloud.com/shortcuts/0123abcdEF",
});
assert.equal(viaIcloud.importUrl, "https://www.icloud.com/shortcuts/0123abcdEF");

const unsignedFile = readFileSync("public/shortcuts/NoteGoat.unsigned.shortcut");
assert.equal(isSignedShortcut(unsignedFile), false);
assert.ok(unsignedFile.includes("Paste the NoteGoat device code."));
const generic = genericShortcutLinks("https://www.mynotegoat.com/");
assert.equal(generic.fileUrl, "https://www.mynotegoat.com/shortcuts/NoteGoat.shortcut");
assert.equal(generic.importUrl, undefined);
assert.equal(generic.error, UNSIGNED_SHORTCUT_ERROR);
const genericIcloud = genericShortcutLinks("https://www.mynotegoat.com", "https://www.icloud.com/shortcuts/0123abcdEF");
assert.equal(genericIcloud.importUrl, "https://www.icloud.com/shortcuts/0123abcdEF");

const route = readFileSync("src/app/api/reminders/shortcut/route.ts", "utf8");
assert.match(route, /genericShortcutLinks/);
assert.match(route, /buildShortcutLinks/);
assert.doesNotMatch(route, /shortcuts:\/\/import-shortcut\?url=/);
const flow = readFileSync("src/components/messaging-setup-flow.tsx", "utf8");
assert.match(flow, /Copy code/);
assert.match(flow, /Get the NoteGoat shortcut/);

console.log("shortcut-import: all checks passed");
