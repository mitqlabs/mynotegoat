/**
 * Patient Diagnosis Codes box:
 *  - "+ Dx Code" on ICD-10 search rows: folder guess + saving to the office's
 *    list (folder, bundles) without touching the patient.
 *  - One row per code on the patient, however it's added.
 *  - G.O.A.T. MRI suggestions drop codes the moment they're on the patient
 *    (e.g. from a bundle); Excludes1 conflicts move to "Not suggested".
 *  - The box reads the live on-screen list (source checks).
 *
 * Mock data only.  Run:  npx tsx scripts/tests/dx-save-to-list.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { guessDiagnosisFolderId, saveCodeToDiagnosisList, type DxListActions } from "../../src/lib/dx-save-to-list";
import { addDiagnosesToList, diagnosisCodeKey, type PatientDiagnosisEntry } from "../../src/lib/patient-diagnoses";
import { suggestDiagnosesDetailed, type DxSuggestInput } from "../../src/lib/dx-suggest";

let passed = 0;
const test = (name: string, fn: () => void) => {
  try {
    fn();
    passed++;
  } catch (err) {
    console.error(`✗ ${name}`);
    throw err;
  }
};

const DEFAULT_FOLDERS = [
  { id: "folder-general", name: "General" },
  { id: "folder-cervical", name: "Cervical" },
  { id: "folder-thoracic", name: "Thoracic" },
  { id: "folder-lumbar", name: "Lumbar" },
  { id: "folder-shoulder", name: "Shoulder" },
  { id: "folder-leg-knee-foot", name: "Leg/Knee/Foot" },
  { id: "folder-misc", name: "Misc." },
];

test("folder guess: region from the official description", () => {
  const g = (code: string, d: string) => guessDiagnosisFolderId(code, d, DEFAULT_FOLDERS);
  assert.equal(g("M50.222", "Other cervical disc displacement at C5-C6 level"), "folder-cervical");
  assert.equal(g("S13.4XXA", "Sprain of ligaments of cervical spine, initial encounter"), "folder-cervical");
  assert.equal(g("S16.1XXA", "Strain of muscle, fascia and tendon at neck level, initial encounter"), "folder-cervical");
  assert.equal(g("M51.26", "Other intervertebral disc displacement, lumbar region"), "folder-lumbar");
  assert.equal(g("M54.50", "Low back pain, unspecified"), "folder-lumbar");
  assert.equal(g("M54.6", "Pain in thoracic spine"), "folder-thoracic");
  assert.equal(g("M75.101", "Unspecified rotator cuff tear or rupture of right shoulder, not specified as traumatic"), "folder-shoulder");
  assert.equal(g("M23.205", "Derangement of unspecified medial meniscus due to old tear or injury, left knee"), "folder-leg-knee-foot");
  assert.equal(g("M67.322", "Transient synovitis, left elbow"), "folder-general", "no elbow folder → General");
  assert.equal(g("R51.9", "Headache, unspecified"), "folder-general");
});

test("folder guess: by code when the description doesn't name the region", () => {
  assert.equal(guessDiagnosisFolderId("M54.2", "Cervicalgia", DEFAULT_FOLDERS), "folder-cervical");
  assert.equal(guessDiagnosisFolderId("S33.5XXA", "Sprain of ligaments of L-spine", DEFAULT_FOLDERS), "folder-lumbar");
});

test("folder guess: renamed / custom folders match by name; no General → first folder", () => {
  const custom = [
    { id: "f1", name: "Everything else" },
    { id: "f2", name: "Neck" },
    { id: "f3", name: "Low Back" },
  ];
  assert.equal(guessDiagnosisFolderId("M50.20", "Other cervical disc displacement, unspecified cervical region", custom), "f2");
  assert.equal(guessDiagnosisFolderId("M48.061", "Spinal stenosis, lumbar region without neurogenic claudication", custom), "f3");
  assert.equal(guessDiagnosisFolderId("M75.41", "Impingement syndrome of right shoulder", custom), "f1");
  assert.equal(guessDiagnosisFolderId("R51.9", "Headache, unspecified", []), "");
});

/** In-memory stand-in for useBillingMacros (same shapes). */
function fakeLibrary() {
  const state = {
    diagnoses: [
      { id: "dx-1", code: "M54.2", description: "Cervicalgia", folderId: "folder-cervical", active: true },
      { id: "dx-2", code: "M54.50", description: "Low back pain, unspecified", folderId: "folder-lumbar", active: false },
    ],
    bundles: [
      { id: "b-1", name: "Cervical PI", diagnosisIds: ["dx-1"] },
      { id: "b-2", name: "Lumbar PI", diagnosisIds: [] as string[] },
    ],
  };
  let n = 10;
  const actions = (): DxListActions => ({
    diagnoses: state.diagnoses,
    bundles: state.bundles,
    folders: DEFAULT_FOLDERS,
    addDiagnosis: ({ code, description, folderId }) => {
      const id = `dx-${n++}`;
      state.diagnoses = [...state.diagnoses, { id, code, description, folderId: folderId ?? "folder-general", active: true }];
      return { id, added: true };
    },
    updateDiagnosis: (id, patch) => {
      state.diagnoses = state.diagnoses.map((d) => (d.id === id ? { ...d, ...patch } : d));
    },
    updateBundle: (id, patch) => {
      state.bundles = state.bundles.map((b) => (b.id === id ? { ...b, ...patch } : b));
    },
  });
  return { state, actions };
}

test("+ Dx Code saves to the chosen folder and bundles (Settings 'Add a code' data)", () => {
  const lib = fakeLibrary();
  const r = saveCodeToDiagnosisList(lib.actions(), { code: "M50.222", description: "Other cervical disc displacement at C5-C6 level" }, "folder-cervical", ["b-1"]);
  assert.ok(r.ok);
  assert.match(r.ok ? r.message : "", /M50\.222 saved to your codes \(Cervical\) and "Cervical PI"\. Not added to this patient\./);
  const saved = lib.state.diagnoses.find((d) => d.code === "M50.222")!;
  assert.equal(saved.folderId, "folder-cervical");
  assert.equal(saved.active, true);
  assert.deepEqual(lib.state.bundles.find((b) => b.id === "b-1")!.diagnosisIds, ["dx-1", saved.id]);
  assert.deepEqual(lib.state.bundles.find((b) => b.id === "b-2")!.diagnosisIds, [], "unchecked bundle untouched");
});

test("+ Dx Code: no bundles is fine; already-active code is refused; inactive code is turned back on", () => {
  const lib = fakeLibrary();
  const plain = saveCodeToDiagnosisList(lib.actions(), { code: "R51.9", description: "Headache, unspecified" }, "folder-misc", []);
  assert.ok(plain.ok && /\(Misc\.\)\. Not added/.test(plain.message));
  const dup = saveCodeToDiagnosisList(lib.actions(), { code: "m54.2", description: "Cervicalgia" }, "folder-general", []);
  assert.deepEqual(dup, { ok: false, error: "M54.2 is already in your codes." });
  const before = lib.state.diagnoses.length;
  const back = saveCodeToDiagnosisList(lib.actions(), { code: "M54.50", description: "Low back pain, unspecified" }, "folder-lumbar", ["b-2"]);
  assert.ok(back.ok && /turned back on/.test(back.message));
  assert.equal(lib.state.diagnoses.length, before, "no duplicate row");
  assert.equal(lib.state.diagnoses.find((d) => d.id === "dx-2")!.active, true);
  assert.deepEqual(lib.state.bundles.find((b) => b.id === "b-2")!.diagnosisIds, ["dx-2"]);
  const blank = saveCodeToDiagnosisList(lib.actions(), { code: " ", description: "x" }, "folder-general", []);
  assert.equal(blank.ok, false);
});

const entry = (code: string): PatientDiagnosisEntry => ({ id: code, code, description: `desc ${code}`, source: "Manual", createdAt: "2026-10-01T00:00:00Z" });

test("patient list: one row per code (dots/case ignored), from any path", () => {
  assert.equal(diagnosisCodeKey(" m54.16 "), "M5416");
  const current = [entry("M54.16")];
  const r = addDiagnosesToList(
    current,
    [
      { code: "M5416", description: "Radiculopathy, lumbar region (other wording)" },
      { code: "m51.26", description: "Other intervertebral disc displacement, lumbar region", source: "Bundle: Lumbar PI" },
      { code: "M51.26", description: "dup inside the same bundle" },
      { code: "", description: "blank" },
      { code: "M54.50", description: "  " },
    ],
    "Bundle",
  );
  assert.equal(r.added, 1);
  assert.deepEqual(r.entries.map((e) => e.code), ["M54.16", "M51.26"]);
  assert.equal(r.entries[1].source, "Bundle: Lumbar PI");
  const none = addDiagnosesToList(r.entries, [{ code: "m51.26", description: "again" }]);
  assert.equal(none.added, 0);
  assert.equal(none.entries, r.entries, "same array when nothing added (no needless save/re-render)");
});

// MRI suggestions before/after adding a bundle (mock MRI text).
const LUMBAR_MRI = `Lumbar:
1. L4-L5: 4 mm disc herniation with moderate central canal stenosis.
2. L5-S1: 3 mm disc protrusion.`;
const mriInput = (existing: Array<{ code: string }>): DxSuggestInput => ({
  imaging: [{ text: LUMBAR_MRI, source: "MRI findings (Imaging panel)" }],
  files: null,
  clinical: [{ text: "Sciatica down the left leg.", source: "Notes" }],
  library: [],
  existing,
});

test("suggestions disappear as soon as their code is on the patient (bundle add)", () => {
  const before = suggestDiagnosesDetailed(mriInput([]));
  const beforeCodes = before.list.map((s) => s.code);
  assert.ok(beforeCodes.length >= 2, beforeCodes.join(","));
  // A bundle adds the first two suggested codes (stored without dots, lower case — still matches).
  const bundle = beforeCodes.slice(0, 2).map((c) => ({ code: c.replace(".", "").toLowerCase(), description: c, source: "Bundle: Lumbar PI" }));
  const patient = addDiagnosesToList([], bundle, "Bundle").entries;
  const after = suggestDiagnosesDetailed(mriInput(patient.map((p) => ({ code: p.code }))));
  const afterCodes = [...after.list.map((s) => s.code), ...after.list.flatMap((s) => s.others.map((o) => o.code))];
  for (const c of beforeCodes.slice(0, 2)) {
    assert.ok(!afterCodes.includes(c), `${c} still suggested after the bundle added it`);
    assert.ok(!after.heldBack.some((h) => h.code === c), `${c} on patient must not show under Not suggested either`);
  }
});

test("a suggestion that conflicts (Excludes1) with an added code moves to 'Not suggested'", () => {
  const input = mriInput([]);
  const before = suggestDiagnosesDetailed(input);
  assert.deepEqual(before.list.map((s) => s.code), ["M51.16", "M48.061", "M51.17"]);
  assert.equal(before.heldBack.length, 0);
  const after = suggestDiagnosesDetailed({ ...input, existing: [{ code: "M54.16" }] });
  assert.deepEqual(after.list.map((s) => s.code), ["M48.061"]);
  assert.deepEqual(after.heldBack.map((h) => h.code), ["M51.16", "M51.17"]);
  for (const h of after.heldBack) assert.match(h.reason, /M54\.16 is already on the patient/);
  assert.ok(!after.list.some((s) => s.code === "M51.16" || s.code === "M51.17"));
});

const src = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");

test("source: the patient box reads the live list everywhere", () => {
  const hook = src("src/hooks/use-patient-diagnoses.ts");
  assert.match(hook, /onLocalChange\(PATIENT_DIAGNOSES_STORAGE_KEY/, "other components / GlobalKvRealtime (other devices) wake the hook");
  assert.match(hook, /addEventListener\("storage"/, "other tabs");
  assert.match(hook, /notifyChange\(PATIENT_DIAGNOSES_STORAGE_KEY\)/);
  assert.match(hook, /markLocalWrite\(PATIENT_DIAGNOSES_STORAGE_KEY\)/);
  assert.match(hook, /mapRef\.current/, "writes computed against the latest map, not a setState updater");
  assert.doesNotMatch(hook, /setDiagnosisMap\(\(/, "no updater-closure return values");

  const page = src("src/components/patient-case-file.tsx");
  const dx = page.slice(page.indexOf("const dxSuggestState = useMemo"), page.indexOf("const dxSaveToList"));
  assert.match(dx, /patientDiagnoses\.map\(\(d\) => \(\{ code: d\.code \}\)\)/, "suggestions use the on-screen list");
  assert.match(dx, /\[sectionPanelsOpen\.diagnosis, goatContext, billingMacros\.diagnoses, patientDiagnoses\]/);
  const add = page.slice(page.indexOf("const addDiagnosisWithMessage"), page.indexOf("const addDiagnosisWithMessage") + 600);
  assert.match(add, /patientDiagnoses\.some\(\(d\) => sameCode\(d\.code, code\)\)/);
  assert.match(page, /existingCodes=\{patientDiagnoses\.map\(\(d\) => d\.code\)\}/);
  assert.match(page, /saveToList=\{dxSaveToList\}/);
});

console.log(`dx-save-to-list: ${passed} passed`);

// ICD-10 rows: the save button reads "+Dx" and sits to the RIGHT of Add.
{
  const src = readFileSync("src/components/icd10-search.tsx", "utf8");
  assert.ok(src.includes('saveToList.buttonLabel ?? "+Dx"'), "+Dx label");
  const addAt = src.indexOf("{compactAdd}\n              <button\n                aria-expanded={saving}");
  assert.ok(addAt > 0, "Add comes before +Dx");
  assert.ok(src.includes('title="Save to your diagnosis codes'), "tooltip kept");
  console.log("ok - +Dx sits right of Add");
}
