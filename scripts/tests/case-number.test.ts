/**
 * Case number format: the default is exactly today's number, custom formats apply to NEW patients
 * only, and existing patients never change. Mock data only.
 * Run:  npx tsx scripts/tests/case-number.test.ts
 */
import assert from "node:assert/strict";

const store = new Map<string, string>();
const g = globalThis as unknown as Record<string, unknown>;
g.window = globalThis;
g.localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  key: (i: number) => Array.from(store.keys())[i] ?? null,
  get length() { return store.size; },
  clear: () => store.clear(),
};
g.addEventListener = () => {};
g.removeEventListener = () => {};
g.dispatchEvent = () => true;
if (typeof g.CustomEvent === "undefined") {
  g.CustomEvent = class<T> extends Event { detail: T; constructor(type: string, init?: { detail?: T }) { super(type); this.detail = init?.detail as T; } };
}

let passed = 0;
const test = (name: string, fn: () => void | Promise<void>) => Promise.resolve(fn()).then(() => { passed++; console.log(`ok - ${name}`); });

async function main() {
  const cn = await import("../../src/lib/case-number");
  const { buildCaseNumber, caseNumberOf } = await import("../../src/lib/follow-up-queue");
  const { createPatientRecord, patients } = await import("../../src/lib/mock-data");
  const os = await import("../../src/lib/office-settings");

  // The original algorithm, written out independently.
  const legacy = (doi: string, name: string) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(doi);
    if (!m) return "";
    const [last = "", first = ""] = name.split(",").map((s) => s.trim());
    const l = (s: string) => s.replace(/[^a-zA-Z]/g, "").toUpperCase().slice(0, 2);
    return `${m[2]}${m[3]}${m[1].slice(-2)}${l(last)}${l(first)}`;
  };

  await test("default format == today's behavior (071826SMJO)", () => {
    assert.equal(cn.DEFAULT_CASE_NUMBER_FORMAT, "{MMDDYY}{LAST2}{FIRST2}");
    assert.equal(buildCaseNumber("2026-07-18", "Smith, John"), "071826SMJO");
    assert.equal(cn.exampleCaseNumber(cn.DEFAULT_CASE_NUMBER_FORMAT), "071826SMJO");
    for (const [doi, name] of [["2026-07-18", "Smith, John"], ["2025-01-02", "O'Neil-Ray, Mary Ann"], ["2024-12-31", "Li, Q"], ["2026-03-04", "123, 456"], ["", "Smith, John"]] as const) {
      assert.equal(buildCaseNumber(doi, name), legacy(doi, name), `${doi} ${name}`);
      assert.equal(
        cn.renderCaseNumber(cn.DEFAULT_CASE_NUMBER_FORMAT, (() => {
          const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(doi);
          const [last = "", first = ""] = name.split(",").map((s) => s.trim());
          return { mm: m?.[2], dd: m?.[3], yyyy: m?.[1], lastName: last, firstName: first };
        })()),
        legacy(doi, name),
      );
    }
  });

  await test("tokens render", () => {
    assert.equal(cn.exampleCaseNumber("{LAST3}-{FIRST1}-{YYYY}"), "SMI-J-2026");
    assert.equal(cn.exampleCaseNumber("{YY}{MM}{DD}{FIRST2}{LAST2}"), "260718JOSM");
    assert.equal(cn.exampleCaseNumber("{MMDDYYYY}{LAST}"), "07182026SMITH");
    assert.equal(cn.exampleCaseNumber("PI-{N3}", 7), "PI-007");
    assert.equal(cn.exampleCaseNumber("{N4}{LAST2}", 12), "0012SM");
    assert.equal(cn.exampleCaseNumber("{n}{last2}", 5), "5SM"); // case-insensitive tokens
  });

  await test("bad formats are rejected and fall back to the default", () => {
    for (const bad of ["", "   ", "plain", "{NOPE}", "{LAST2", "LAST2}", "{LAST2} {FIRST2}", "{LAST2}/{FIRST2}", "{LAST2}😀", "x".repeat(60) + "{N}"]) {
      assert.equal(cn.checkCaseNumberFormat(bad).ok, false, bad);
      assert.equal(cn.normalizeCaseNumberFormat(bad), cn.DEFAULT_CASE_NUMBER_FORMAT, bad);
    }
    assert.equal(cn.normalizeCaseNumberFormat(undefined), cn.DEFAULT_CASE_NUMBER_FORMAT);
    assert.equal(cn.normalizeCaseNumberFormat(42), cn.DEFAULT_CASE_NUMBER_FORMAT);
    assert.equal(cn.normalizeCaseNumberFormat("  {LAST3}{N3} "), "{LAST3}{N3}");
  });

  await test("missing injury date → blank (same as today), only when the format needs it", () => {
    assert.equal(buildCaseNumber("", "Smith, John"), "");
    assert.equal(cn.renderCaseNumber("{LAST2}{N3}", { lastName: "Smith", firstName: "John", seq: 4 }), "SM004");
    assert.equal(cn.renderCaseNumber("{MMDDYY}{LAST2}", { lastName: "Smith", firstName: "John" }), "");
  });

  await test("office settings: default, round trip, junk reads as default", () => {
    assert.equal(os.getDefaultOfficeSettings().caseNumberFormat, cn.DEFAULT_CASE_NUMBER_FORMAT);
    assert.equal(os.normalizeOfficeSettings({}).caseNumberFormat, cn.DEFAULT_CASE_NUMBER_FORMAT);
    const saved = os.normalizeOfficeSettings({ ...os.getDefaultOfficeSettings(), caseNumberFormat: "{LAST3}-{N3}" });
    assert.equal(saved.caseNumberFormat, "{LAST3}-{N3}");
    assert.equal(os.normalizeOfficeSettings(JSON.parse(JSON.stringify(saved))).caseNumberFormat, "{LAST3}-{N3}");
    assert.equal(os.normalizeOfficeSettings({ caseNumberFormat: "{BOGUS}" }).caseNumberFormat, cn.DEFAULT_CASE_NUMBER_FORMAT);
  });

  await test("registered + cloud-synced like the rest of office settings", async () => {
    const { readFileSync } = await import("node:fs");
    const reg = readFileSync("src/lib/cloud-key-registry.ts", "utf8");
    assert.ok(reg.includes("casemate.office-settings.v1"));
    assert.ok(readFileSync("src/lib/office-settings.ts", "utf8").includes('dualWriteKv(STORAGE_KEY, "tasks"'));
  });

  await test("new patient under the default format: no stamp, number unchanged", () => {
    const before = patients.length;
    const p = createPatientRecord({ lastName: "Testerly", firstName: "Quinn", phone: "818-555-0199", dateOfLoss: "07/18/2026" })!;
    assert.equal(patients.length, before + 1);
    assert.equal(p.matrix?.caseNumberFormat, undefined);
    assert.equal(p.matrix?.caseSeq, undefined);
    assert.equal(caseNumberOf(p), "071826TEQU");
  });

  await test("custom format applies to NEW patients only; existing ones never change", () => {
    const existing = patients.map((x) => ({ id: x.id, n: caseNumberOf(x) }));
    const withCustom = { ...os.getDefaultOfficeSettings(), caseNumberFormat: "{LAST3}-{N3}", savedAt: 1 };
    store.set("casemate.office-settings.v1", JSON.stringify(withCustom));

    const a = createPatientRecord({ lastName: "Sampleton", firstName: "Dana", phone: "818-555-0101", dateOfLoss: "08/01/2026" })!;
    const b = createPatientRecord({ lastName: "Examplar", firstName: "Lee", phone: "818-555-0102", dateOfLoss: "08/02/2026" })!;
    assert.equal(a.matrix?.caseNumberFormat, "{LAST3}-{N3}");
    assert.equal(caseNumberOf(a), "SAM-001");
    assert.equal(caseNumberOf(b), "EXA-002");

    // Existing patients (made before the change) keep exactly their old numbers.
    for (const e of existing) assert.equal(caseNumberOf(patients.find((x) => x.id === e.id)!), e.n, e.id);

    // Changing the format AGAIN doesn't touch a or b.
    store.set("casemate.office-settings.v1", JSON.stringify({ ...withCustom, caseNumberFormat: "{YY}{FIRST2}{LAST2}", savedAt: 2 }));
    const c = createPatientRecord({ lastName: "Third", firstName: "Sam", phone: "818-555-0103", dateOfLoss: "09/03/2026" })!;
    assert.equal(caseNumberOf(c), "26SATH");
    assert.equal(caseNumberOf(a), "SAM-001");
    assert.equal(caseNumberOf(b), "EXA-002");

    // Back to the default → new patients are unstamped again, old stamped ones keep theirs.
    store.set("casemate.office-settings.v1", JSON.stringify({ ...withCustom, caseNumberFormat: cn.DEFAULT_CASE_NUMBER_FORMAT, savedAt: 3 }));
    const d = createPatientRecord({ lastName: "Fourth", firstName: "Ann", phone: "818-555-0104", dateOfLoss: "09/04/2026" })!;
    assert.equal(d.matrix?.caseNumberFormat, undefined);
    assert.equal(caseNumberOf(d), "090426FOAN");
    assert.equal(caseNumberOf(a), "SAM-001");
  });

  await test("stamp survives a save/reload (matrix round trip) and an edit that doesn't touch it", async () => {
    const { rowToPatient, patientToRow } = await import("../../src/lib/patients-cloud");
    const { updatePatientRecordById } = await import("../../src/lib/mock-data");
    const withCustom = { ...os.getDefaultOfficeSettings(), caseNumberFormat: "{LAST2}{N}", savedAt: 9 };
    store.set("casemate.office-settings.v1", JSON.stringify(withCustom));
    const p = createPatientRecord({ lastName: "Roundtrip", firstName: "Kim", phone: "818-555-0105", dateOfLoss: "10/05/2026" })!;
    const n = caseNumberOf(p);
    assert.match(n, /^RO\d+$/);
    const back = rowToPatient(patientToRow(p, "ws-test"));
    assert.equal(caseNumberOf(back), n);
    // Editing other matrix fields keeps the stamp (matrix is merged).
    updatePatientRecordById(p.id, { matrix: { review: "Yes" } });
    assert.equal(caseNumberOf(patients.find((x) => x.id === p.id)!), n);
  });

  console.log(`\n${passed} passed`);
}
main().catch((e) => { console.error(e); process.exit(1); });
