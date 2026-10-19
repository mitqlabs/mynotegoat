/**
 * What an existing workspace effectively sees for every setting that has an
 * in-code default: once with nothing saved, once with partly-saved values
 * (the normalizers merge defaults into saved data, e.g. Dx codes and office
 * hours). Mock data only.
 *
 * The golden copy (legacy-effective-defaults.json) was produced by running
 * this exact file against origin/main BEFORE the blank-starter change, so the
 * test proves the change leaves existing workspaces untouched.
 *
 * Regenerate (only if a default is changed ON PURPOSE for everyone):
 *   npx tsx scripts/tests/fixtures/effective-defaults-snapshot.ts --write
 */
import { writeFileSync } from "node:fs";

type Store = Map<string, string>;

export function installMockWindow(initial: Record<string, unknown> = {}): Store {
  const store: Store = new Map();
  for (const [k, v] of Object.entries(initial)) store.set(k, typeof v === "string" ? v : JSON.stringify(v));
  const localStorage = {
    getItem: (k: string) => (store.has(k) ? (store.get(k) as string) : null),
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
  };
  (globalThis as unknown as { window: unknown }).window = {
    localStorage,
    sessionStorage: localStorage,
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => true,
    location: { search: "", href: "http://localhost/" },
  };
  return store;
}

/** Random ids / timestamps → stable placeholders. */
function stable(value: unknown): unknown {
  return JSON.parse(
    JSON.stringify(value)
      .replace(/default-(\d+)-[0-9a-f-]{36}/g, "default-$1-ID")
      .replace(/apt-type-[0-9a-f-]{36}/g, "apt-type-ID")
      .replace(/SMS-\d+-\d+/g, "SMS-ID")
      .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/g, "ISO"),
  );
}

export const PARTIAL_SAVED = {
  "casemate.billing-macros.v1": {
    treatments: [{ id: "tx-a", name: "Exam", procedureCode: "99203", modifier: "", unitPrice: 100, defaultUnits: 1, active: true }],
    diagnosisFolders: [],
    diagnoses: [{ id: "dx-own", code: "M54.2", description: "Cervicalgia", folderId: "folder-cervical", active: true }],
    bundles: [],
    packages: [],
  },
  "casemate.schedule-settings.v1": {
    officeHours: [
      { dayOfWeek: 1, enabled: true, start: "07:00", end: "19:00" },
      { dayOfWeek: 6, enabled: true, start: "09:00", end: "12:00" },
    ],
  },
  "casemate.schedule-appointment-types.v1": [],
  "casemate.macro-library.v1": { setName: "Mine", templates: [] },
  "casemate.soap-macros.v1": { subjective: ["Own S"], objective: [] },
  "casemate.document-templates.v1": {
    templates: [{ id: "doc-own", name: "Own letter", scope: "generalLetter", body: "Hello {{PATIENT_FULL_NAME}}" }],
  },
  "casemate.report-templates.v1": { templates: [] },
  "casemate.case-statuses.v1": { lienLabel: "LOP" },
};

export async function snapshotEffectiveDefaults(): Promise<Record<string, unknown>> {
  const appt = await import("../../../src/lib/schedule-appointment-types");
  const sched = await import("../../../src/lib/schedule-settings");
  const billing = await import("../../../src/lib/billing-macros");
  const macros = await import("../../../src/lib/macro-templates");
  const soap = await import("../../../src/lib/soap-macros");
  const docs = await import("../../../src/lib/document-templates");
  const reports = await import("../../../src/lib/report-templates");
  const statuses = await import("../../../src/lib/case-statuses");
  const sms = await import("../../../src/lib/sms-templates");

  const read = () => ({
    appointmentTypes: appt.loadAppointmentTypes(),
    scheduleSettings: sched.loadScheduleSettings(),
    billing: billing.loadBillingMacroLibrary(),
    macroLibrary: macros.loadMacroLibrary(),
    soapMacros: soap.loadSoapMacros(),
    documentTemplates: docs.loadDocumentTemplateLibrary(),
    reportTemplates: reports.loadNarrativeReportLibrary(),
    caseStatuses: statuses.loadCaseStatusSettings(),
    smsStarterTemplates: sms.getDefaultSmsTemplates(),
    generalLetterBody: docs.getDefaultBodyForDocumentScope("generalLetter"),
  });

  const store = installMockWindow();
  const nothingSaved = read();
  store.clear();
  for (const [k, v] of Object.entries(PARTIAL_SAVED)) store.set(k, JSON.stringify(v));
  const partlySaved = read();
  return stable({ nothingSaved, partlySaved }) as Record<string, unknown>;
}

if (process.argv.includes("--write")) {
  const out = process.argv[process.argv.indexOf("--write") + 1] ?? "scripts/tests/fixtures/legacy-effective-defaults.json";
  void snapshotEffectiveDefaults().then((snap) => {
    writeFileSync(out, JSON.stringify(snap, null, 1) + "\n");
    console.log(`wrote ${out}`);
  });
}
