/**
 * Live-bug layouts (mock text only): empty Specialist box, Contacts specialty stored
 * as a legacy category, doctor only in "Specialist Referral/Report - DR. X" file names,
 * and a report whose visit date opens the ASSESSMENT ("ASSESSMENT: 02/25/2026: …").
 *
 * Run:  npx tsx scripts/tests/goat-eval/live-layout.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { askGoat } from "../../../src/lib/goat";
import { goatPeople } from "../../../src/lib/goat-context";
import { extractFileFacts } from "../../../src/lib/goat-facts";
import { factsForFiles } from "../../../src/lib/goat-facts-store";
import { reportVisitDate } from "../../../src/lib/goat-referrals";
import type { GoatFile } from "../../../src/lib/goat-docs";
import { mockContext } from "./mock-patient";

const results: Array<{ name: string; ok: boolean; err?: string }> = [];
const evalCase = (name: string, fn: () => void) => { try { fn(); results.push({ name, ok: true }); } catch (e) { results.push({ name, ok: false, err: (e as Error).message.split("\n")[0] }); } };
const f = (id: string, name: string, pages: string[]): GoatFile => ({ id, name, folder: "Records", uploaded: "2026-03-01", status: "read", pages } as GoatFile);

// Mirrors the live layout; invented names and text.
const FILES = [
  f("r", "Specialist Referral - DR. MOCK HAROYAN.pdf", ["REFERRAL\nPatient: Testpatient, Kara   DOB: 04/02/1985\nDate of Referral: 01/14/2026\nSpecialty requested: see attached"]),
  f("p", "Specialist Report - DR. MOCK HAROYAN.pdf", [
    "CHIEF COMPLAINT: Consultation Visit Kara Testpatient presents for evaluation of neck and back pain. DOB: 04/02/1985. She was involved in an MVA on December 9, 2025 when she was rear-ended.",
    "PAST HISTORY: none significant.",
    "ASSESSMENT: 02/25/2026: Kara Testpatient is a pleasant 41-year-old female seen today for neck and low back pain.\nPLAN: Recommend cervical medial branch block. Follow up in 6 weeks.",
  ]),
  f("x", "XRAY.pdf", ["CERVICAL SPINE 3 VIEWS\nExam Date: 12/12/2025\nIMPRESSION: Straightening of lordosis."]),
  f("m", "MRI.pdf", ["MRI LUMBAR SPINE\nExam Date: 01/05/2026\nIMPRESSION: L4-L5 disc protrusion."]),
  f("l", "LIEN.pdf", ["Lien agreement signed 12/15/2025"]),
  f("i", "INFO.pdf", ["Patient info. DOB 04/02/1985. Date of injury 12/09/2025"]),
  f("d", "ID.pdf", ["ID card"]),
];
// Contacts as stored on main: category "Specialist", sub-category "Pain Management";
// the doctor written in another case, without "Dr.".
const people = goatPeople([], [
  { name: "MOCK HAROYAN, MD", category: "Specialist", subCategory: "Pain Management" },
  { name: "Otto Bonesmith", category: "Specialist", subCategory: "Orthopedics" },
]);
const ctx = mockContext({ files: FILES, people, specialists: [], termGroups: [], imaging: [], doi: "2025-12-09", dob: "1985-04-02" });
const text = (q: string) => askGoat(ctx, q).answers.map((a) => a.lines.join("\n")).join("\n");

evalCase("Contacts: specialty read from the sub-category (also legacy category / other top-level)", () => {
  assert.equal(people.find((x) => /haroyan/i.test(x.name))?.specialty, "Pain Management");
  assert.equal(goatPeople([], [{ name: "A Legacyson", category: "Pain Management" }])[0]?.specialty.toLowerCase(), "pain management");
  assert.equal(goatPeople([], [{ name: "B Otherson", category: "Doctor", subCategory: "Pain Management" }])[0]?.specialty, "Pain Management");
  assert.equal(goatPeople([{ name: "Dr. Mock Haroyan" }], [{ name: "MOCK HAROYAN, MD", category: "Specialist", subCategory: "Pain Management" }])[0]?.specialty, "Pain Management");
});
for (const q of ["when was kara referred to pm and when did he go", "when was she referred to pain management and when did she go", "when did kara see pain mgmt", "when was she referred to the specialist and when was she seen"]) {
  evalCase(`"${q}" → referral + visit from the files`, () => {
    const t = text(q);
    assert.doesNotMatch(t, /No specialist referrals on file/);
    if (/refer/.test(q)) assert.match(t, /01\/14\/2026/, t);
    assert.match(t, /02\/25\/2026/, t);
    assert.doesNotMatch(t, /12\/09\/2025|04\/02\/1985/, t);
  });
}
evalCase("empty Specialist box + specialist files: never 'none on file'", () => {
  const t = text("specialist referrals");
  assert.doesNotMatch(t, /No specialist referrals on file/);
  assert.match(t, /Haroyan/i);
  assert.match(t, /01\/14\/2026/);
  assert.match(t, /02\/25\/2026/);
});
evalCase("visit date: label → section-leading date → earliest after referral (not DOB/MVA)", () => {
  assert.equal(reportVisitDate("Date of Service: March 3, 2026\nASSESSMENT: 02/25/2026: x"), "03/03/2026");
  assert.equal(reportVisitDate(FILES[1].pages!.join("\n")), "02/25/2026");
  assert.equal(reportVisitDate("DOB: 04/02/1985. MVA on December 9, 2025. Seen in clinic 2/27/2026 and again 3/30/2026.", { after: "01/14/2026" }), "02/27/2026");
  assert.equal(reportVisitDate("Accident date 01/02/2026. Exam performed January 20, 2026.", { after: "01/14/2026" }), "01/20/2026");
});
evalCase("facts index reads the same page text (OCR/pdf) G.O.A.T. search reads", () => {
  const facts = factsForFiles(ctx.files);
  assert.equal(facts.length, FILES.length, "every read file gets facts");
  const rep = extractFileFacts(FILES[1]);
  assert.equal(rep.docType, "specialist report");
  assert.equal(rep.doctor, "Dr. Mock Haroyan");
  assert.equal(rep.mainDate, "02/25/2026");
  assert.equal(extractFileFacts(FILES[0]).docType, "referral");
  // An unread file (no pages yet) gets none, and is picked up once text arrives.
  assert.equal(factsForFiles([{ ...FILES[1], id: "p2", pages: null }]).length, 0);
  assert.equal(factsForFiles([{ ...FILES[1], id: "p2" }])[0].mainDate, "02/25/2026");
});

// Two-column report header (mock): "Visit:" next to other labels, and the same block read out of column order.
evalCase("header 'Visit: 02/25/2026 9:15AM' with other labels on the line; never the DOB", () => {
  const inline = "Patient: Testpatient, Kara | DOB: 07/19/1979 | Sex: F\nProvider: Dr. Mock Haroyan, M.D. | Visit: 02/25/2026 9:15AM | Chart: 000\nOffice: Mock Office | Address: 1 Test St\nCHIEF COMPLAINT: Consultation Visit Kara presents…";
  const split = "Patient: DOB: Sex:\nTestpatient, Kara 07/19/1979 F\nProvider: Visit: Chart:\nDr. Mock Haroyan, M.D. 02/25/2026 9:15AM 000\nOffice: Address:\nMock Office 1 Test St";
  const splitDobFirst = "Visit: DOB: Provider:\n07/19/1979 02/25/2026 9:15AM Dr. Mock Haroyan";
  assert.equal(reportVisitDate(inline), "02/25/2026");
  assert.equal(reportVisitDate(split), "02/25/2026");
  assert.equal(reportVisitDate(splitDobFirst), "02/25/2026");
  const facts = extractFileFacts(f("h", "Specialist Report - DR. MOCK HAROYAN.pdf", [inline]));
  assert.equal(facts.mainDate, "02/25/2026");
  assert.equal(extractFileFacts(f("h2", "Consult.pdf", [inline])).doctor, "Dr. Mock Haroyan");
  const ctx2 = mockContext({ files: [FILES[0], f("h", "Specialist Report - DR. MOCK HAROYAN.pdf", [split])], people, specialists: [], termGroups: [], imaging: [], dob: "1979-07-19" });
  const t = askGoat(ctx2, "when was kara referred to pm and when did he go").answers.map((a) => a.lines.join(" ")).join(" ");
  assert.match(t, /referred to pain management.*01\/14\/2026.*seen on 02\/25\/2026/, t);
  assert.doesNotMatch(t, /07\/19\/1979/);
});

// + mode On + ready: the model writes the final answer; the basic lookup is input / fallback only.
evalCase("+ mode never short-circuits with the basic answer", () => {
  const src = readFileSync(new URL("../../../src/lib/goat-ai/assist.ts", import.meta.url), "utf8");
  assert.doesNotMatch(src, /if \(base\.answers\.length\) return done\(base, false\)/);
  assert.match(src, /ruleAnswers: base\.answers/);
  const ans = readFileSync(new URL("../../../src/lib/goat-ai/answer.ts", import.meta.url), "utf8");
  assert.match(ans, /Basic lookup results/);
});

const passed = results.filter((r) => r.ok).length;
for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"} ${r.name}${r.err ? ` — ${r.err}` : ""}`);
console.log(`\nLive-layout eval: ${passed}/${results.length} passed`);
if (passed !== results.length) process.exit(1);
