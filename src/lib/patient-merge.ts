"use client";

/**
 * Patient merge — combine two duplicate patient records into one.
 *
 * Flow:
 *   1. Caller picks a "winner" id and a "loser" id.
 *   2. Caller passes a merged PatientRecord (built from the merge UI's
 *      field-by-field choices).
 *   3. mergePatients() writes the merged record to the winner via
 *      updatePatientRecordById, soft-deletes the loser, and reassigns
 *      every related entity (encounters, appointments, billing,
 *      diagnoses, follow-up overrides, file folders) from loser → winner
 *      so no data is orphaned.
 *
 * IMPORTANT: this mutates module-scope state in several other modules
 * (encounter-notes, schedule-appointments, file-manager, billing/
 * diagnoses maps). Each module's save function triggers its own cloud
 * dual-write, so the changes propagate to Supabase automatically.
 */

import {
  patients,
  updatePatientRecordById,
  deletePatientRecord,
  type PatientRecord,
  type UpdatePatientRecordPatch,
} from "@/lib/mock-data";
import {
  loadEncounterNoteRecords,
  saveEncounterNoteRecords,
} from "@/lib/encounter-notes";
import {
  loadScheduleAppointments,
  saveScheduleAppointments,
} from "@/lib/schedule-appointments";
import {
  loadPatientBillingMap,
  savePatientBillingMap,
} from "@/lib/patient-billing";
import {
  loadPatientDiagnosesMap,
  savePatientDiagnosesMap,
} from "@/lib/patient-diagnoses";
import {
  loadPatientFollowUpOverridesMap,
  savePatientFollowUpOverridesMap,
} from "@/lib/patient-follow-up-overrides";
import {
  loadFileManagerState,
  saveFileManagerState,
} from "@/lib/file-manager";
import { purgeDismissalsContaining } from "@/lib/duplicate-dismissals";

export type MergePatientsResult = {
  ok: boolean;
  reason?: string;
  reassigned: {
    encounters: number;
    appointments: number;
    billing: boolean;
    diagnoses: boolean;
    overrides: boolean;
    fileFolders: number;
  };
};

/** Build a UpdatePatientRecordPatch from a merged-field payload. We only
 *  copy fields that are part of the documented patch type so we don't
 *  accidentally clobber id / createdAt / etc. */
function patchFromMerged(merged: PatientRecord): UpdatePatientRecordPatch {
  return {
    fullName: merged.fullName,
    dob: merged.dob,
    sex: merged.sex,
    maritalStatus: merged.maritalStatus,
    phone: merged.phone,
    email: merged.email,
    address: merged.address,
    attorney: merged.attorney,
    caseStatus: merged.caseStatus,
    dateOfLoss: merged.dateOfLoss,
    lastUpdate: new Date().toISOString().slice(0, 10),
    priority: merged.priority,
    relatedCases: merged.relatedCases,
    xrayReferrals: merged.xrayReferrals,
    mriReferrals: merged.mriReferrals,
    specialistReferrals: merged.specialistReferrals,
    alerts: merged.alerts,
    matrix: merged.matrix ?? {},
  };
}

/** Reassign all encounter notes from loserId → winnerId. Returns how many
 *  notes were rewritten. */
function reassignEncounters(loserId: string, winnerId: string): number {
  const all = loadEncounterNoteRecords();
  let touched = 0;
  const next = all.map((note) => {
    if (note.patientId !== loserId) return note;
    touched++;
    return { ...note, patientId: winnerId };
  });
  if (touched > 0) saveEncounterNoteRecords(next);
  return touched;
}

/** Reassign every appointment from loserId → winnerId. Patient name is
 *  also rewritten so the schedule stays consistent visually. */
function reassignAppointments(
  loserId: string,
  winnerId: string,
  winnerFullName: string,
): number {
  const all = loadScheduleAppointments();
  let touched = 0;
  const next = all.map((appt) => {
    if (appt.patientId !== loserId) return appt;
    touched++;
    return { ...appt, patientId: winnerId, patientName: winnerFullName };
  });
  if (touched > 0) saveScheduleAppointments(next);
  return touched;
}

/** Move the loser's billing record under the winner's id (or delete the
 *  loser entry if winner already has one). Returns true if anything
 *  changed. */
function reassignBilling(loserId: string, winnerId: string): boolean {
  const map = loadPatientBillingMap();
  const loserRow = map[loserId];
  if (!loserRow) return false;
  const winnerRow = map[winnerId];
  if (!winnerRow) {
    // Move the entire row under the winner key
    map[winnerId] = { ...loserRow, patientId: winnerId };
  } else {
    // Winner already has billing — keep the higher of each $$ amount,
    // append loser's adjustments, and bump updated_at.
    const adjustments = [...winnerRow.adjustments, ...loserRow.adjustments];
    map[winnerId] = {
      ...winnerRow,
      billedAmount: Math.max(winnerRow.billedAmount, loserRow.billedAmount),
      paidAmount: Math.max(winnerRow.paidAmount, loserRow.paidAmount),
      paidDate: winnerRow.paidDate || loserRow.paidDate,
      adjustments,
      updatedAt: new Date().toISOString(),
    };
  }
  delete map[loserId];
  savePatientBillingMap(map);
  return true;
}

/** Move the loser's diagnoses list under the winner's id (concat + dedupe
 *  by code if winner already has some). */
function reassignDiagnoses(loserId: string, winnerId: string): boolean {
  const map = loadPatientDiagnosesMap();
  const loserList = map[loserId];
  if (!loserList) return false;
  const winnerList = map[winnerId] ?? [];
  // Dedupe by ICD-10 code (case-insensitive) so identical diagnoses
  // entered on both records don't double up.
  const seen = new Set(winnerList.map((d) => d.code.toLowerCase()));
  const merged = [...winnerList];
  for (const d of loserList) {
    if (seen.has(d.code.toLowerCase())) continue;
    seen.add(d.code.toLowerCase());
    merged.push(d);
  }
  map[winnerId] = merged;
  delete map[loserId];
  savePatientDiagnosesMap(map);
  return true;
}

/** Move follow-up overrides from loser → winner. Winner's existing
 *  overrides win on conflict. */
function reassignFollowUpOverrides(loserId: string, winnerId: string): boolean {
  const map = loadPatientFollowUpOverridesMap();
  const loserOverride = map[loserId];
  if (!loserOverride) return false;
  if (!map[winnerId]) {
    map[winnerId] = loserOverride;
  }
  // Either way, drop the loser key
  delete map[loserId];
  savePatientFollowUpOverridesMap(map);
  return true;
}

/** Re-parent any file folder rows that were tagged with the loser's
 *  patientId. Returns how many folders were touched. */
function reassignFileFolders(loserId: string, winnerId: string): number {
  const state = loadFileManagerState();
  let touched = 0;
  const folders = state.folders.map((f) => {
    if (f.patientId !== loserId) return f;
    touched++;
    return { ...f, patientId: winnerId };
  });
  if (touched > 0) {
    saveFileManagerState({ ...state, folders });
  }
  return touched;
}

/**
 * Merge two patients. Writes the merged record to the winner, soft-deletes
 * the loser, and reassigns every related entity. The merged record is
 * caller-provided so the merge UI can show a field-by-field conflict
 * resolver and the user picks which value wins on each conflict.
 */
export function mergePatients(
  winnerId: string,
  loserId: string,
  mergedRecord: PatientRecord,
): MergePatientsResult {
  if (winnerId === loserId) {
    return {
      ok: false,
      reason: "Winner and loser are the same patient.",
      reassigned: noReassignments(),
    };
  }
  const winner = patients.find((p) => p.id === winnerId && !p.deleted);
  const loser = patients.find((p) => p.id === loserId && !p.deleted);
  if (!winner) {
    return {
      ok: false,
      reason: `Winner patient ${winnerId} not found (or already deleted).`,
      reassigned: noReassignments(),
    };
  }
  if (!loser) {
    return {
      ok: false,
      reason: `Loser patient ${loserId} not found (or already deleted).`,
      reassigned: noReassignments(),
    };
  }

  // 1. Reassign related entities FIRST so they're under the winner before
  //    the loser disappears. If anything throws here we bail without
  //    touching either patient record.
  const winnerName = mergedRecord.fullName;
  const encounters = reassignEncounters(loserId, winnerId);
  const appointments = reassignAppointments(loserId, winnerId, winnerName);
  const billing = reassignBilling(loserId, winnerId);
  const diagnoses = reassignDiagnoses(loserId, winnerId);
  const overrides = reassignFollowUpOverrides(loserId, winnerId);
  const fileFolders = reassignFileFolders(loserId, winnerId);

  // 2. Write the merged record to the winner. updatePatientRecordById
  //    triggers persistPatients which fires the Supabase dual-write.
  const updated = updatePatientRecordById(winnerId, patchFromMerged(mergedRecord));
  if (!updated) {
    return {
      ok: false,
      reason: "Could not update winner patient.",
      reassigned: { encounters, appointments, billing, diagnoses, overrides, fileFolders },
    };
  }

  // 3. Soft-delete the loser. Same persistPatients path → cloud dual-write.
  deletePatientRecord(loserId);

  // 4. Drop any dismissal fingerprints that contained the loser id —
  //    they're meaningless now and would never re-fire anyway.
  purgeDismissalsContaining(loserId);

  return {
    ok: true,
    reassigned: { encounters, appointments, billing, diagnoses, overrides, fileFolders },
  };
}

function noReassignments() {
  return {
    encounters: 0,
    appointments: 0,
    billing: false,
    diagnoses: false,
    overrides: false,
    fileFolders: 0,
  };
}

/**
 * Default field-merge strategy: for each field, prefer the WINNER's value
 * if non-blank, otherwise fall back to the LOSER's value. Arrays/objects
 * are unioned where it makes sense (alerts, related cases). The merge UI
 * uses this as the starting point and lets the user override individual
 * fields where both sides disagree.
 */
export function autoMergeRecord(
  winner: PatientRecord,
  loser: PatientRecord,
): PatientRecord {
  const pickStr = (a: string | undefined, b: string | undefined) =>
    (a ?? "").trim() ? (a ?? "") : (b ?? "");

  return {
    ...winner,
    fullName: pickStr(winner.fullName, loser.fullName),
    dob: pickStr(winner.dob, loser.dob),
    sex: winner.sex ?? loser.sex,
    maritalStatus: winner.maritalStatus ?? loser.maritalStatus,
    phone: pickStr(winner.phone, loser.phone),
    email: pickStr(winner.email, loser.email) || undefined,
    address: pickStr(winner.address, loser.address) || undefined,
    attorney: pickStr(winner.attorney, loser.attorney),
    caseStatus: winner.caseStatus ?? loser.caseStatus,
    dateOfLoss: pickStr(winner.dateOfLoss, loser.dateOfLoss),
    priority: winner.priority ?? loser.priority,
    matrix: { ...(loser.matrix ?? {}), ...(winner.matrix ?? {}) },
    relatedCases: dedupeRelatedCases([
      ...(winner.relatedCases ?? []),
      ...(loser.relatedCases ?? []),
    ]),
    xrayReferrals: [
      ...(winner.xrayReferrals ?? []),
      ...(loser.xrayReferrals ?? []),
    ],
    mriReferrals: [
      ...(winner.mriReferrals ?? []),
      ...(loser.mriReferrals ?? []),
    ],
    specialistReferrals: [
      ...(winner.specialistReferrals ?? []),
      ...(loser.specialistReferrals ?? []),
    ],
    alerts: dedupeStrings([...(winner.alerts ?? []), ...(loser.alerts ?? [])]),
  };
}

function dedupeStrings(list: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of list) {
    const key = s.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(s.trim());
  }
  return out;
}

function dedupeRelatedCases(
  list: { patientId: string; fullName: string; dateOfLoss: string }[],
) {
  const seen = new Set<string>();
  const out: typeof list = [];
  for (const r of list) {
    const key = `${r.patientId}|${r.dateOfLoss}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}
