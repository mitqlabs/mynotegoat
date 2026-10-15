/**
 * G.O.A.T. bulk contacts from pasted text + Handbook/help. Fictional firms only.
 * Run: npx tsx scripts/tests/goat-eval/contacts-paste.test.ts
 */
import assert from "node:assert/strict";
import { batchCategory, buildImportRows, categoryFromRequest, guessCategory, looksLikeContactPaste, nameKey, parseContactPaste } from "../../../src/lib/goat-contacts-import";
import { goatHandbookChapter, goatHelpText, isGoatHelpQuestion } from "../../../src/lib/handbook-goat";
import { SLASH_COMMANDS, detectBrief } from "../../../src/lib/goat-briefs";

let pass = 0, fail = 0;
const check = (name: string, fn: () => void) => { try { fn(); pass++; } catch (e) { fail++; console.log(`FAIL ${name}: ${(e as Error).message.split("\n")[0]}`); } };

// 45 fictional firms in the user's format (name / phone / address), with some variety.
const SURN = ["Ardent", "Bramble", "Calloway", "Dunmore", "Ellery", "Fenwick", "Galloway", "Hartwell", "Ivers", "Jessup", "Kestrel", "Larkin", "Merriweather", "Norcross", "Oakhurst"];
const SUFFIX = ["Law Firm", "Law Group, PLLC", "& Associates, P.C.", "Injury Lawyers", "Legal"];
const STREETS = ["Camp Bowie Blvd", "Mockingbird Ln", "Hulen St", "Vickery Blvd", "Bryant Irvin Rd"];
const blocks: string[] = [];
const expect: Array<{ name: string; phone: string; address: string }> = [];
for (let i = 0; i < 45; i++) {
  const name = `${SURN[i % 15]}${i >= 15 ? ` ${["Mock", "Sample"][Math.floor(i / 15) - 1]}` : ""} ${SUFFIX[i % 5]}${i % 9 === 0 ? ` (Pat ${SURN[(i + 3) % 15]})` : ""}`;
  const phone = `817-555-${String(100 + i).padStart(4, "0")}`;
  const address = `${1000 + i * 7} ${STREETS[i % 5]}${i % 2 ? `, Suite ${100 + i}` : ""}, Fort Worth, TX 761${String(i % 40).padStart(2, "0")}`;
  expect.push({ name, phone, address });
  const phoneLine = i % 7 === 3 ? `(817) 555-${String(100 + i).padStart(4, "0")}` : i % 7 === 5 ? `Phone: ${phone}` : phone;
  const extra = i % 11 === 4 ? `\nFax: 817-555-${String(900 + i).padStart(4, "0")}\nintake${i}@firm.example` : "";
  blocks.push(`${name}\n${phoneLine}${extra}\n${address}`);
}
const SAMPLE = `Add these as contacts\n\n${blocks.join("\n\n")}`;

const parsed = parseContactPaste(SAMPLE);
check("45 parsed", () => assert.equal(parsed.length, 45));
for (let i = 0; i < 45; i++) {
  check(`block ${i + 1}`, () => {
    assert.equal(parsed[i]?.name, expect[i].name);
    assert.equal(parsed[i]?.phone, expect[i].phone);
    assert.equal(parsed[i]?.address, expect[i].address);
  });
}
check("fax + email picked up", () => { assert.equal(parsed[4].fax, "817-555-0904"); assert.equal(parsed[4].email, "intake4@firm.example"); });
check("paste detected", () => assert.ok(looksLikeContactPaste(SAMPLE)));
check("paste detected without phrase", () => assert.ok(looksLikeContactPaste(blocks.slice(0, 3).join("\n\n"))));
check("all attorneys", () => assert.equal(batchCategory(parsed), "Attorney"));

// Formats
const one = (t: string) => parseContactPaste(t);
check("Ward example", () => assert.deepEqual(one("Ward Mock Law Firm (Rick Ward)\n817-555-3043\n6100 Mock Blvd, Suite X, Fort Worth, TX 76116")[0], { name: "Ward Mock Law Firm (Rick Ward)", phone: "817-555-3043", fax: "", email: "", address: "6100 Mock Blvd, Suite X, Fort Worth, TX 76116", extra: [] }));
check("no blank lines", () => {
  const r = one("Alpha Mock PLLC\n817-555-0001\n1 Main St, Fort Worth, TX 76102\nBeta Mock P.C.\n817-555-0002\n2 Main St, Fort Worth, TX 76102");
  assert.deepEqual(r.map((x) => x.name), ["Alpha Mock PLLC", "Beta Mock P.C."]);
  assert.equal(r[1].phone, "817-555-0002");
});
check("single-line comma", () => assert.deepEqual(one("Gamma Mock Legal, 214-555-0110, 22 Oak Rd, Dallas, TX 75201")[0], { name: "Gamma Mock Legal", phone: "214-555-0110", fax: "", email: "", address: "22 Oak Rd, Dallas, TX 75201", extra: [] }));
check("single-line pipes", () => { const r = one("Delta Mock Law | (972) 555-0120 | 9 Elm St, Plano, TX 75074 | info@delta.example")[0]; assert.equal(r.name, "Delta Mock Law"); assert.equal(r.phone, "972-555-0120"); assert.equal(r.address, "9 Elm St, Plano, TX 75074"); assert.equal(r.email, "info@delta.example"); });
check("several single lines", () => assert.equal(one("Echo Mock Law, 817-555-0131, 1 A St, Fort Worth, TX 76104\nFox Mock Law, 817-555-0132, 2 B St, Fort Worth, TX 76104").length, 2));
check("multi-line address", () => assert.equal(one("Hotel Mock Law\n817-555-0140\n500 Commerce St.\nSuite 9\nFort Worth, TX 76102")[0].address, "500 Commerce St., Suite 9, Fort Worth, TX 76102"));
check("extra lines kept aside", () => { const r = one("India Mock Law\nAttn: Paralegal Team\n817-555-0150\n1 Main St, Fort Worth, TX 76102")[0]; assert.equal(r.name, "India Mock Law"); assert.deepEqual(r.extra, ["Attn: Paralegal Team"]); });
check("dotted phone + +1", () => assert.equal(one("Juliet Mock Law\n+1 817.555.0160\n1 Main St, Fort Worth, TX 76102")[0].phone, "817-555-0160"));
check("bulleted", () => assert.equal(one("1. Kilo Mock Law\n817-555-0170\n1 Main St, Fort Worth, TX 76102")[0].name, "Kilo Mock Law"));
check("missing phone", () => assert.equal(one("Lima Mock Law\n1 Main St, Fort Worth, TX 76102")[0].phone, ""));

// Detection must not hijack normal chat
for (const q of ["what's john smith's phone", "call 817-555-0101 for kara", "mark smith paid 3200", "how many submitted cases", "who's coming in today", "/todo call 817-555-0100 tomorrow"]) {
  check(`not paste: ${q}`, () => assert.equal(looksLikeContactPaste(q), false));
}
check("intent + one line", () => assert.ok(looksLikeContactPaste("add this contact: Mike Mock Law, 817-555-0190, 1 Main St, Fort Worth, TX 76102")));

// Category
check("guess attorney", () => { for (const n of ["Ward Law Firm", "Smith & Associates", "Jones PLLC", "Doe P.C.", "Roe Injury Lawyers", "Acme Legal"]) assert.equal(guessCategory(n), "Attorney", n); });
check("guess imaging", () => assert.equal(guessCategory("Mock Open MRI"), "Imaging Center"));
check("guess acute", () => assert.equal(guessCategory("Mock Urgent Care"), "Acute Care"));
check("guess specialist", () => assert.equal(guessCategory("Mock Orthopedics"), "Specialist"));
check("guess unknown", () => assert.equal(guessCategory("Bob Mock"), ""));
check("mixed → ask", () => assert.equal(batchCategory([{ name: "Bob Mock" }, { name: "Ann Mock" }, { name: "X Law" }]), ""));
check("request names category", () => assert.equal(categoryFromRequest("add these imaging centers as contacts\nMock MRI\n817-555-0100"), "Imaging Center"));
check("request plain", () => assert.equal(categoryFromRequest("add these as contacts\nMock\n817-555-0100"), ""));

// Duplicates
const existing = [{ name: "Ardent Law Firm", phone: "214-555-9999" }, { name: "Someone Else", phone: "817-555-0101" }];
const rows = buildImportRows(parsed, existing, "Attorney");
check("dupe by name (suffix/alias ignored)", () => { assert.equal(rows[0].checked, false); assert.match(rows[0].flag, /Already in contacts as "Ardent Law Firm"/); });
check("dupe by phone", () => { assert.equal(rows[1].checked, false); assert.match(rows[1].flag, /Same phone as "Someone Else"/); });
check("others ticked", () => assert.equal(rows.filter((r) => r.checked).length, 43));
check("category applied", () => assert.ok(rows.every((r) => r.category === "Attorney")));
check("within-paste dupe", () => { const r = buildImportRows(one("Zed Mock Law\n817-555-0001\n\nZed Mock Law PLLC\n817-555-0002"), [], ""); assert.equal(r[1].flag, "Listed twice in this paste"); assert.equal(r[1].checked, false); });
check("missing phone unticked", () => { const r = buildImportRows(one("Lima Mock Law\n1 Main St, Fort Worth, TX 76102"), [], ""); assert.match(r[0].flag, /No phone/); assert.equal(r[0].checked, false); });
check("nameKey", () => { assert.equal(nameKey("The Ward Law Firm, PLLC (Rick Ward)"), "ward"); assert.equal(nameKey("Smith & Jonas, P.C."), "smith jonas"); });

// Handbook + help
const hb = JSON.stringify(goatHandbookChapter);
check("handbook lists every / command", () => { for (const c of SLASH_COMMANDS) assert.ok(hb.includes(`/${c.cmd} — `), c.cmd); });
check("handbook topics", () => { for (const t of ["Morning Rundown", "Appointment Check", "Know Your Business", "Eyes only", "Duplicate encounters", "contacts", "confirm card", "asks"]) assert.ok(hb.toLowerCase().includes(t.toLowerCase()), t); });
check("help text commands", () => { for (const c of SLASH_COMMANDS) assert.match(goatHelpText(), new RegExp(`/${c.cmd}`)); });
for (const q of ["help", "Help", "what can you do?", "what can you do", "What do you do", "what can i ask", "how do i use goat", "what are your features", "what else can you help me with"]) check(`help: ${q}`, () => assert.ok(isGoatHelpQuestion(q)));
for (const q of ["help me find john smith's dob", "what can you do for kara", "add a note", "morning rundown"]) check(`not help: ${q}`, () => assert.equal(isGoatHelpQuestion(q), false));
check("rundown not help", () => assert.equal(detectBrief("help"), null));

console.log(`contacts-paste: ${pass}/${pass + fail} passed (fictional firms only)`);
if (fail) process.exit(1);
