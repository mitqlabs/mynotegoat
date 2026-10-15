/**
 * Writes for the G.O.A.T. office manager — only through the app's own
 * cloud-backed stores (billing map, patient records, Case Notes). No other
 * storage. Every write here runs only after the user pressed Confirm.
 */
import { loadPatientBillingMap, savePatientBillingMap, createPatientBillingRecord, type PatientBillingRecord } from "@/lib/patient-billing";
import { updatePatientRecordById, type PatientRecord, type CaseStatus, type ContactRecord } from "@/lib/mock-data";
import { getCaseNote, setCaseNote, STORAGE_KEY_CASE_NOTES } from "@/lib/case-notes";
import { appendNote } from "@/lib/goat-notes";
import { markLocalWrite, notifyChange } from "@/lib/local-sync";
import { logActivity } from "@/lib/activity-log";
import { usToIso, money, type OmChange, type OmData } from "@/lib/goat-om";
import type { ScheduleAppointmentRecord } from "@/lib/schedule-appointments";

export const BILLING_KEY = "casemate.patient-billing.v1";

/** What the office manager reads: patients with billing totals and last visit. */
export function buildOmData(input: {
  patients: PatientRecord[];
  appointments: ScheduleAppointmentRecord[];
  encounters: Array<{ patientId: string; encounterDate: string }>;
  contacts: ContactRecord[];
  today: string;
}): OmData {
  const billing = loadPatientBillingMap();
  const last = new Map<string, string>();
  const bump = (id: string, iso: string) => {
    if (!iso || iso > input.today) return;
    if ((last.get(id) ?? "") < iso) last.set(id, iso);
  };
  for (const a of input.appointments) if (!/cancel|no show|reschedul/i.test(a.status)) bump(a.patientId, a.date);
  for (const e of input.encounters) bump(e.patientId, usToIso(e.encounterDate));
  const num = (v: string | undefined) => {
    const n = Number.parseFloat(String(v ?? "").replace(/[^0-9.]/g, ""));
    return Number.isFinite(n) ? n : 0;
  };
  return {
    today: input.today,
    attorneys: input.contacts.filter((c) => c.category === "Attorney").map((c) => c.name),
    patients: input.patients
      .filter((p) => !p.deleted)
      .map((p) => {
        const b = billing[p.id];
        const paidIso = p.matrix?.paidDate ?? "";
        return {
          id: p.id,
          fullName: p.fullName,
          caseStatus: p.caseStatus,
          attorney: p.attorney,
          billed: b?.billedAmount || num(p.matrix?.billed),
          paid: b ? b.paidAmount : num(p.matrix?.paidAmount),
          paidDate: b?.paidDate || (paidIso ? paidIso.replace(/^(\d{4})-(\d{2})-(\d{2})$/, "$2/$3/$1") : ""),
          lastVisit: last.get(p.id) ?? "",
          cash: Boolean(p.isCashPatient),
        };
      }),
  };
}

/** Everything a change can touch, exactly as it was (for undo). */
export interface OmSnapshot {
  patientId: string;
  billing: PatientBillingRecord | null;
  caseStatus: CaseStatus;
  attorney: string;
  lastUpdate: string;
  matrix: { paidAmount?: string; paidDate?: string; discharge?: string };
  notes: string;
}

export function snapshotFor(ids: string[], patients: PatientRecord[]): OmSnapshot[] {
  const billing = loadPatientBillingMap();
  return ids.flatMap((id) => {
    const p = patients.find((x) => x.id === id);
    if (!p) return [];
    return [{
      patientId: id,
      billing: billing[id] ? JSON.parse(JSON.stringify(billing[id])) : null,
      caseStatus: p.caseStatus,
      attorney: p.attorney,
      lastUpdate: p.lastUpdate,
      matrix: { paidAmount: p.matrix?.paidAmount, paidDate: p.matrix?.paidDate, discharge: p.matrix?.discharge },
      notes: getCaseNote(id) ?? p.matrix?.notes ?? "",
    }];
  });
}

const nowIso = () => new Date().toISOString();
const adjId = () => `pbadj-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

function saveBilling(mutate: (map: ReturnType<typeof loadPatientBillingMap>) => void) {
  const map = loadPatientBillingMap();
  mutate(map);
  markLocalWrite(BILLING_KEY);
  savePatientBillingMap(map);
  notifyChange(BILLING_KEY);
}

/** Apply confirmed changes. `signLine(text)` formats the signed note line. */
export function applyOmChanges(changes: OmChange[], patients: PatientRecord[], signLine: (text: string) => string): void {
  saveBilling((map) => {
    for (const c of changes) {
      if (!c.billing && !c.adjustment) continue;
      const cur = map[c.patientId] ?? createPatientBillingRecord(c.patientId);
      const next: PatientBillingRecord = { ...cur, adjustments: [...cur.adjustments], updatedAt: nowIso() };
      if (c.billing) {
        next.paidAmount = c.billing.paidAmount;
        next.paidDate = c.billing.paidDate;
      }
      if (c.adjustment) next.adjustments.push({ id: adjId(), label: c.adjustment.label, amount: c.adjustment.amount, note: c.adjustment.note, createdAt: nowIso(), updatedAt: nowIso() });
      map[c.patientId] = next;
      const p = patients.find((x) => x.id === c.patientId);
      if (c.billing && c.billing.paidAmount !== cur.paidAmount) logActivity({ category: "billing", action: "billing.paid_changed", summary: `Paid ${money(cur.paidAmount)} → ${money(c.billing.paidAmount)} (G.O.A.T.)`, patientId: c.patientId, patientName: p?.fullName });
      if (c.adjustment) logActivity({ category: "billing", action: "billing.adjustment_added", summary: `Added adjustment "${c.adjustment.label}" ${money(c.adjustment.amount)} (G.O.A.T.)`, patientId: c.patientId, patientName: p?.fullName });
    }
  });
  for (const c of changes) {
    const patch: Parameters<typeof updatePatientRecordById>[1] = {};
    if (c.caseStatus) patch.caseStatus = c.caseStatus as CaseStatus;
    if (c.attorney) patch.attorney = c.attorney;
    if (c.matrix) patch.matrix = Object.fromEntries(Object.entries(c.matrix).filter(([, v]) => v !== undefined)) as Record<string, string>;
    if (Object.keys(patch).length) updatePatientRecordById(c.patientId, { ...patch, lastUpdate: new Date().toISOString().slice(0, 10) });
    const p = patients.find((x) => x.id === c.patientId);
    const existing = getCaseNote(c.patientId) ?? p?.matrix?.notes ?? "";
    setCaseNote(c.patientId, appendNote(existing, signLine(c.note)));
  }
  notifyChange(STORAGE_KEY_CASE_NOTES);
}

/** Put every touched value back exactly as it was. */
export function restoreOmSnapshot(snaps: OmSnapshot[]): void {
  saveBilling((map) => {
    for (const s of snaps) {
      if (s.billing) map[s.patientId] = JSON.parse(JSON.stringify(s.billing));
      else delete map[s.patientId];
    }
  });
  for (const s of snaps) {
    updatePatientRecordById(s.patientId, {
      caseStatus: s.caseStatus,
      attorney: s.attorney,
      lastUpdate: s.lastUpdate,
      // undefined stays undefined (absent), so the file reads exactly as before.
      matrix: { paidAmount: s.matrix.paidAmount, paidDate: s.matrix.paidDate, discharge: s.matrix.discharge } as Record<string, string>,
    });
    setCaseNote(s.patientId, s.notes);
  }
  notifyChange(STORAGE_KEY_CASE_NOTES);
}
