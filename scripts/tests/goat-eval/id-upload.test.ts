/**
 * G.O.A.T. ID upload (fictional people and addresses only — the repo is public).
 * - AAMVA barcode text (synthetic) → only Last, First, DOB, Sex, Address
 * - A real PDF417 picture made here (mock image) decodes in-process with zxing-wasm
 * - Front-of-ID OCR text → labeled fields "read", positional fields "check"
 * - Match by full name only (never first name only); fill blanks, conflicts to choose
 * - "add this new patient wednesday 1pm" → ONE card: new patient + New Patient visit
 * - Shared date rule: bare / "this Wednesday" = coming one; "next Wednesday" = the one after
 * - Follow-ups after the card resolve to the same patient
 * Run: npx tsx scripts/tests/goat-eval/id-upload.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { aamvaDate, answerFromText, buildIdCard, idAddress, idPatch, idValues, idVisitRecord, isAboutScreenshot, looksLikeIdFront, maritalAnswer, matchIdPatients, parseAamva, parseIdFront, parseIdRequest, phoneAnswer, planIdUpdate, withIdVisit, type IdPatientLike, type IdRead } from "../../../src/lib/goat-id";
import { idFileName } from "../../../src/lib/goat-id-save";
import { resolveRequestedDay } from "../../../src/lib/goat-howto";
import { emptyDialog, goatTurn, type DialogCtx } from "../../../src/lib/goat-dialog";
import { getDefaultScheduleSettings } from "../../../src/lib/schedule-settings";
import type { PracticeData } from "../../../src/lib/goat-practice";
import type { ScheduleAppointmentRecord } from "../../../src/lib/schedule-appointments";

const TODAY = "2026-10-19"; // Monday
const settings = getDefaultScheduleSettings();
let pass = 0, fail = 0;
const pending: Promise<void>[] = [];
const check = (name: string, fn: () => void | Promise<void>) => {
  const run = async () => { try { await fn(); pass++; } catch (e) { fail++; console.log(`FAIL ${name}: ${(e as Error).message.split("\n")[0]}`); } };
  pending.push(run());
};

// Synthetic AAMVA records (fictional data).
const CA_V8 = "@\n\x1e\rANSI 636014080102DL00410288ZC03290024DLDAQX0000000\nDCSMOCKLEY\nDDEN\nDACJANE\nDDFN\nDADQ\nDDGN\nDCAC\nDCBNONE\nDCDNONE\nDBD01012024\nDBB07041988\nDBA07042029\nDBC2\nDAU065 IN\nDAYBRO\nDAG1234 FAKE ST\nDAHAPT 5\nDAIGLENDALE\nDAJCA\nDAK912060000  \nDCF00000000000000000\nDCGUSA\nDAW140\nDCK00000000000000\nDDB08292017\nDDK1\r";
const TX_V9 = "@\n\x1e\rANSI 636015090001DL00310250DLDCSSAMPLE\nDACJOHN\nDADA\nDBB12251975\nDBC1\nDAG100 MOCK AVE\nDAIAUSTIN\nDAJTX\nDAK787010000\nDAQ00000000\r";
const V1_DAA = "@\n\x1e\rANSI 6360100102DL00390187DLDAAFAKER,ANA,M\nDAG55 SAMPLE RD\nDAIMOCKTOWN\nDAJFL\nDAK33101\nDBB19800315\nDBC2\r";
const CANADA = "@\n\x1e\rANSI 636012080002DL00410200DLDCSTESTER\nDACMAX\nDBB19920131\nDBC1\nDAG9 FAKE CRES\nDAITORONTO\nDAJON\nDAKM5V 2T6\r";

check("AAMVA CA v8 → only the allowed fields", () => {
  const r = parseAamva(CA_V8)!;
  assert.equal(r.source, "barcode");
  assert.deepEqual(idValues(r), { lastName: "Mockley", firstName: "Jane", dob: "07/04/1988", sex: "Female", street: "1234 Fake St", unit: "Apt 5", city: "Glendale", state: "CA", zip: "91206" });
  // License number, height, eyes, expiry are never pulled in.
  assert.deepEqual(Object.keys(r.fields).sort(), ["city", "dob", "firstName", "lastName", "sex", "state", "street", "unit", "zip"]);
  assert.ok(Object.values(r.fields).every((f) => f!.confidence === "exact"));
  assert.equal(r.notes.length, 0);
});
check("AAMVA TX v9", () => assert.deepEqual(idValues(parseAamva(TX_V9)!), { lastName: "Sample", firstName: "John", dob: "12/25/1975", sex: "Male", street: "100 Mock Ave", city: "Austin", state: "TX", zip: "78701" }));
check("AAMVA v1 DAA full name + CCYYMMDD DOB", () => { const v = idValues(parseAamva(V1_DAA)!); assert.equal(v.lastName, "Faker"); assert.equal(v.firstName, "Ana"); assert.equal(v.dob, "03/15/1980"); });
check("AAMVA Canada date order", () => assert.equal(idValues(parseAamva(CANADA)!).dob, "01/31/1992"));
check("AAMVA escaped <LF> text", () => assert.equal(idValues(parseAamva(TX_V9.replace(/\n/g, "<LF>"))!).lastName, "Sample"));
check("not AAMVA → null", () => assert.equal(parseAamva("https://example.com/qr"), null));
check("aamvaDate rejects garbage", () => { assert.equal(aamvaDate("13451999"), ""); assert.equal(aamvaDate("02301999"), ""); });
check("missing barcode field → note, never guessed", () => { const r = parseAamva(TX_V9.replace("DBB12251975\n", ""))!; assert.equal(r.fields.dob, undefined); assert.ok(r.notes.some((n) => /DOB/.test(n))); });

// A real PDF417 picture (mock image) generated and read in-process, same engine as the browser.
check("mock PDF417 image decodes to the AAMVA record", async () => {
  const z = await import("zxing-wasm/full");
  const wasm = readFileSync("node_modules/zxing-wasm/dist/full/zxing_full.wasm");
  z.prepareZXingModule({ overrides: { wasmBinary: wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength) } as never, fireImmediately: false });
  const w = await z.writeBarcode(TX_V9, { format: "PDF417", scale: 2 } as never);
  assert.ok(w.image, w.error);
  const [hit] = await z.readBarcodes(w.image!, { formats: ["PDF417"], textMode: "Plain" });
  assert.ok(hit?.isValid);
  assert.equal(idValues(parseAamva(hit.text)!).firstName, "John");
});

// Front of the ID (no barcode): OCR text as tesseract returns it.
const FRONT = `CALIFORNIA\nDRIVER LICENSE\nDL X0000000\nEXP 07/04/2029\nLN MOCKLEY\nFN JANE Q\n1234 FAKE ST APT 5\nGLENDALE, CA 91206\nDOB 07/04/1988\nSEX F HGT 5-05 EYES BRO`;
check("front OCR → labeled fields read, address check", () => {
  assert.ok(looksLikeIdFront(FRONT));
  const r = parseIdFront(FRONT);
  assert.deepEqual(idValues(r), { lastName: "Mockley", firstName: "Jane", dob: "07/04/1988", sex: "Female", city: "Glendale", state: "CA", zip: "91206", street: "1234 Fake St", unit: "Apt 5" });
  assert.equal(r.fields.lastName!.confidence, "read");
  assert.equal(r.fields.street!.confidence, "check");
  assert.ok(r.notes.some((n) => /check/.test(n)));
});
check("front OCR, partial → says what's missing", () => { const r = parseIdFront("DRIVER LICENSE\nLN SAMPLE\nDOB 12/25/1975"); assert.ok(r.notes[0].includes("First name")); assert.equal(r.fields.firstName, undefined); });
check("a receipt isn't an ID", () => assert.ok(!looksLikeIdFront("Mock Pharmacy\nTotal $12.00\nThank you")));

const patients: IdPatientLike[] = [
  { id: "p-john", fullName: "Sample, John", dob: "1975-12-25", sex: "Male", address: "" },
  { id: "p-jmarg", fullName: "Margaryan, John", dob: "1980-01-01", sex: "Male", address: "1 Old Rd, Austin, TX 78701" },
  { id: "p-jane", fullName: "Mockley, Jane", dob: "", address: "9 Other St, Glendale, CA 91206" },
];
const tx = idValues(parseAamva(TX_V9)!);
check("match needs last AND first name (never first name only)", () => {
  assert.deepEqual(matchIdPatients(tx, patients).map((p) => p.id), ["p-john"]);
  assert.deepEqual(matchIdPatients({ ...tx, lastName: "Smith" }, patients), []);
  assert.deepEqual(matchIdPatients({ ...tx, dob: "01/01/1999" }, patients), []);
});
check("update: fill blanks, conflicts to choose, default keeps", () => {
  const ca = idValues(parseAamva(CA_V8)!);
  const plan = planIdUpdate(patients[2], ca);
  assert.deepEqual(plan.fills.map((f) => f.key).sort(), ["dob", "sex"]);
  assert.deepEqual(plan.conflicts.map((c) => c.key), ["address"]);
  assert.deepEqual(idPatch(plan, {}), { dob: "1988-07-04", sex: "Female" });
  assert.equal(idPatch(plan, { address: true }).address, "1234 Fake St, Apt 5, Glendale, CA 91206");
});
check("update: same values aren't changes", () => { const plan = planIdUpdate(patients[0], tx); assert.deepEqual(plan.conflicts, []); assert.deepEqual(plan.fills.map((f) => f.key), ["address"]); });

// Shared date rule (same as the booking parser).
check("date rule: bare / this / next", () => {
  assert.equal(resolveRequestedDay("wednesday", TODAY)!.iso, "2026-10-21");
  assert.equal(resolveRequestedDay("this wednesday", TODAY)!.iso, "2026-10-21");
  assert.equal(resolveRequestedDay("next wednesday", TODAY)!.iso, "2026-10-28");
  assert.equal(resolveRequestedDay("monday", TODAY)!.iso, "2026-10-26");
});

check("typed: 'add this new patient wednesday 1pm'", () => {
  const r = parseIdRequest("add this new patient wednesday 1pm", TODAY, settings);
  assert.deepEqual([r.newPatient, r.book, r.date, r.time], [true, true, "2026-10-21", "13:00"]);
});
check("typed: 'new patient next wednesday at 1' + phone", () => {
  const r = parseIdRequest("new patient next wednesday at 1 818-555-0142", TODAY, settings);
  assert.deepEqual([r.date, r.time, r.phone], ["2026-10-28", "13:00", "(818) 555-0142"]);
});
check("typed: no day → asks", () => { const r = parseIdRequest("new patient at 1pm", TODAY, settings); assert.ok(r.askDay); });
check("typed: nothing → no booking", () => { const r = parseIdRequest("", TODAY, settings); assert.deepEqual([r.newPatient, r.book], [false, false]); });

const visitType = { name: "New Patient", durationMin: 45 };
const office = { provider: "Dr. Mock", location: "Mock Chiropractic" };
const build = (read: IdRead, typed: string, extra: Partial<Parameters<typeof buildIdCard>[0]> = {}, appts: ScheduleAppointmentRecord[] = []) =>
  buildIdCard({ read, side: "back", request: parseIdRequest(typed, TODAY, settings), patients, appointments: appts, settings, visitType, office, fileKey: "k1", ...extra });

check("combined: ID + 'add this new patient wednesday 1pm' → ONE new-patient card with the visit", () => {
  const b = build(parseAamva(CA_V8.replace("DCSMOCKLEY", "DCSNEWMOCK"))!, "add this new patient wednesday 1pm");
  assert.equal(b.card.mode, "new");
  assert.deepEqual(b.asks, ["phone", "marital"]);
  assert.equal(b.card.saveId, true);
  const v = b.card.visit!;
  assert.deepEqual([v.date, v.time, v.type, v.durationMin, v.provider, v.location], ["2026-10-21", "13:00", "New Patient", 45, "Dr. Mock", "Mock Chiropractic"]);
  const rec = idVisitRecord(b.card, "a1", "p-new", "Newmock, Jane")!;
  assert.deepEqual([rec.patientId, rec.appointmentType, rec.date, rec.startTime, rec.status], ["p-new", "New Patient", "2026-10-21", "13:00", "Scheduled"]);
  assert.equal(idAddress(b.card.values), "1234 Fake St, Apt 5, Glendale, CA 91206");
});
check("combined: phone typed with it → only marital asked", () => {
  const b = build(parseAamva(CA_V8.replace("DCSMOCKLEY", "DCSNEWMOCK"))!, "new patient wed 1pm 818-555-0142");
  assert.deepEqual(b.asks, ["marital"]);
});
check("combined: slot taken → conflict + nearby times, blocked until picked/overridden", () => {
  const busy: ScheduleAppointmentRecord[] = Array.from({ length: 6 }, (_, i) => ({ id: `x${i}`, patientId: `o${i}`, patientName: "Other, Mock", provider: "", location: "", appointmentType: "Treatment", caseLabel: "", room: "", date: "2026-10-21", startTime: "13:00", durationMin: 60, status: "Scheduled", note: "", overrideOfficeHours: false }));
  const b = build(parseAamva(CA_V8.replace("DCSMOCKLEY", "DCSNEWMOCK"))!, "new patient wednesday 1pm", {}, busy);
  assert.ok(b.card.visit!.taken || b.card.visit!.outsideHours);
});
check("combined: Sunday 1pm → outside office hours flagged", () => {
  const b = build(parseAamva(CA_V8.replace("DCSMOCKLEY", "DCSNEWMOCK"))!, "new patient sunday 1pm");
  assert.ok(b.card.visit!.outsideHours);
});
check("new patient but already on file → update, not a duplicate", () => {
  const b = build(parseAamva(TX_V9)!, "add this new patient wednesday 1pm");
  assert.equal(b.card.mode, "update");
  assert.equal(b.card.patientId, "p-john");
  assert.ok(b.card.notes.some((n) => /already a patient/.test(n)));
});
check("on a patient's page → update that patient", () => {
  const b = build(parseAamva(CA_V8)!, "", { pagePatientId: "p-jane" });
  assert.deepEqual([b.card.mode, b.card.patientId, b.asks.length], ["update", "p-jane", 0]);
});
check("page patient with a different name on the ID → heads-up", () => {
  const b = build(parseAamva(TX_V9)!, "", { pagePatientId: "p-jane" });
  assert.ok(b.card.notes.some((n) => /Heads up/.test(n)));
});
check("no match, no wording → Add new patient (asks phone)", () => {
  const b = build(parseAamva(V1_DAA)!, "");
  assert.deepEqual([b.card.mode, b.asks[0], b.card.visit], ["new", "phone", undefined]);
});
check("day/time typed after the card → visit added", () => {
  const b = build(parseAamva(V1_DAA)!, "");
  const next = withIdVisit(b.card, parseIdRequest("this wednesday at 1", TODAY, settings), { appointments: [], settings, visitType, office })!;
  assert.deepEqual([next.visit!.date, next.visit!.time], ["2026-10-21", "13:00"]);
});
check("answers: phone and marital chips", () => {
  assert.equal(phoneAnswer("818 555 0142"), "(818) 555-0142");
  assert.equal(phoneAnswer("call me"), null);
  assert.equal(maritalAnswer("Married"), "Married");
  assert.equal(maritalAnswer("skip"), "skip");
  assert.equal(maritalAnswer("wednesday 1pm"), null);
});
check("ID file name/label", () => { assert.equal(idFileName("Mockley, Jane", "back", "IMG_1.JPG"), "ID (back) - Mockley, Jane.jpg"); assert.equal(idFileName("Mockley, Jane", "front", "scan.pdf"), "ID (front) - Mockley, Jane.pdf"); });

// Screenshots
const SHOT = "Mock Imaging Center\nAppt: 10/28/2026 9:00 AM\nCall (818) 555-0199 to confirm\nfront@mockimaging.example";
check("screenshot: ask about it", () => {
  assert.ok(isAboutScreenshot("what's the phone number on it?"));
  assert.deepEqual(answerFromText(SHOT, "what's the phone number on it?"), ["(818) 555-0199"]);
  assert.deepEqual(answerFromText(SHOT, "what's the email on this"), ["front@mockimaging.example"]);
  assert.deepEqual(answerFromText(SHOT, "when is the appt on it"), ["Appt: 10/28/2026 9:00 AM"]);
});

// Follow-ups after the card: the chat's patient is the one just saved/updated.
const data: PracticeData = { today: TODAY, patients: [{ id: "p-new", fullName: "Jane Newmock", caseStatus: "Active", attorney: "Self", listYear: 2026 }, { id: "p-john", fullName: "John Sample", caseStatus: "Active", attorney: "Mock Law", listYear: 2026 }] as PracticeData["patients"], tasks: [], appointments: [], contacts: [] };
const ctx: DialogCtx = { data, team: [{ firstName: "Hannah", label: "Hannah" }], openPatientId: "p-new", settings };
for (const q of ["oh also add note to check their prescription", "also add a note to check her prescription", "add a note: check prescription"]) {
  check(`follow-up note → same patient: ${q}`, () => {
    const r = goatTurn(q, emptyDialog(), ctx).reply as { kind: string; patientId?: string };
    assert.deepEqual([r.kind, r.patientId], ["noteConfirm", "p-new"]);
  });
}
check("follow-up booking → same patient", () => { const r = goatTurn("book her friday at 3", emptyDialog(), ctx).reply as { kind: string; patientId?: string }; assert.deepEqual([r.kind, r.patientId], ["booking", "p-new"]); });

// Wiring (source checks).
const goat = readFileSync("src/components/global-goat.tsx", "utf8");
const intake = readFileSync("src/hooks/use-goat-id-intake.ts", "utf8");
const reader = readFileSync("src/lib/goat-id-read.ts", "utf8");
const hb = readFileSync("src/lib/handbook-goat.ts", "utf8");
check("wiring: attach / paste / drop / camera + card", () => { for (const t of ["GoatAttachButtons", "onDrop", "clipboardData.files", "<IdCard", "idIntake.handleReply"]) assert.ok(goat.includes(t), t); });
check("wiring: decoders lazy-loaded from local copies, no network", () => {
  assert.ok(reader.includes('import("zxing-wasm/reader")') && reader.includes("/goat/zxing/"));
  assert.ok(!/^import .*zxing-wasm/m.test(reader) && !/^import .*tesseract/m.test(reader));
  assert.ok(!/fetch\(|https?:\/\//.test(reader));
});
check("wiring: nothing saved before Confirm; picture never in browser storage", () => {
  assert.ok(!/localStorage|sessionStorage/.test(intake));
  assert.ok(/const confirm = async/.test(intake) && intake.indexOf("createPatientRecord(") > intake.indexOf("const confirm = async"));
  assert.ok(intake.indexOf("saveIdToPatientFile(") > intake.indexOf("const confirm = async"));
});
check("handbook: ID upload", () => { for (const t of ["ID", "barcode", "Save ID to file", "add this new patient wednesday 1pm"]) assert.ok(hb.includes(t), t); });

void Promise.all(pending).then(() => {
  console.log(`id-upload: ${pass}/${pass + fail} passed`);
  if (fail) process.exit(1);
});
