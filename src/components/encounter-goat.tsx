"use client";

import type { DischargeIndex } from "@/lib/discharge-date";
import { useMemo } from "react";
import { GoatPanel } from "@/components/goat-panel";
import { goatContextFromRecords, goatPeople } from "@/lib/goat-context";
import { useGoatTerms } from "@/hooks/use-goat-terms";
import { useGoatFiles } from "@/hooks/use-goat-files";
import { useContactDirectory } from "@/hooks/use-contact-directory";
import { useCaseNotes } from "@/hooks/use-case-notes";
import { usePatientDiagnoses } from "@/hooks/use-patient-diagnoses";
import { useMacroTemplates } from "@/hooks/use-macro-templates";
import { useWorkspaceAccess } from "@/lib/workspace-access-context";
import { loadPatientPagePrefs } from "@/lib/patient-page-prefs";
import type { PatientRecord } from "@/lib/mock-data";
import type { ScheduleAppointmentRecord } from "@/lib/schedule-appointments";
import type { EncounterNoteRecord } from "@/lib/encounter-notes";
import type { TreatmentPlan } from "@/lib/treatment-plans";

/**
 * G.O.A.T. in the Encounters side-rail: the same ask engine as the patient
 * page, reading this patient's stored file. Read-only; hidden sections follow
 * the patient page's rules; nothing leaves the app. Answers link to the
 * patient file in a new tab so the encounter being charted stays open.
 */
export function EncounterGoat({
  patient,
  appointments,
  encounters,
  plans,
  billingRecord,
  currentEncounterId,
  onOpenEncounter,
  dischargeIndex,
}: {
  patient: PatientRecord;
  appointments: ScheduleAppointmentRecord[];
  encounters: EncounterNoteRecord[];
  plans: TreatmentPlan[];
  /** Stored billing record, if any (usePatientBilling). */
  billingRecord: { billedAmount: number; paidAmount: number; paidDate: string } | null | undefined;
  /** The note open in the workspace; snippets from it say "This note". */
  currentEncounterId?: string;
  /** Switch the workspace to another of this patient's notes. */
  onOpenEncounter?: (encounterId: string) => void;
  /** Schedule-wide Discharge visits (lib/discharge-date) for the Discharge box date. */
  dischargeIndex?: DischargeIndex;
}) {
  const { notes } = useCaseNotes(patient.id, patient.matrix?.notes ?? "");
  const { entries: diagnoses } = usePatientDiagnoses(patient.id);
  const { macroLibrary } = useMacroTemplates();
  const { sectionHidden, canView } = useWorkspaceAccess();
  const sectionModes = useMemo(() => loadPatientPagePrefs().mode as Record<string, string | undefined>, []);
  const { groups: termGroups } = useGoatTerms();
  const { contacts } = useContactDirectory();
  // Same rule as the patient page: no Patient Files section, no file reading.
  const filesHidden = sectionModes.patientFiles === "hide" || sectionHidden("patientFiles");
  const goatFiles = useGoatFiles(patient.id, !filesHidden);
  const canSeeContacts = canView("contacts");

  const context = useMemo(() => {
    const chargesTotal = encounters.reduce(
      (sum, e) => sum + e.charges.reduce((s, c) => s + c.unitPrice * c.units, 0),
      0,
    );
    // Same rule as the patient page: encounter charges when there are any,
    // else the billing record, else the legacy matrix figures.
    const matrix = (patient.matrix ?? {}) as Record<string, string | undefined>;
    const fromMatrix = (v: string | undefined) => Number.parseFloat(String(v ?? "").replace(/[^0-9.]/g, "")) || 0;
    const storedBilled = billingRecord ? billingRecord.billedAmount : fromMatrix(matrix.billed);
    const paid = billingRecord ? billingRecord.paidAmount : fromMatrix(matrix.paidAmount);
    const billed = chargesTotal > 0 ? chargesTotal : storedBilled;
    const base = goatContextFromRecords({
      patient,
      appointments,
      encounters,
      notes,
      diagnoses,
      plans,
      macroName: (id) => macroLibrary.templates.find((t) => t.id === id)?.buttonName ?? "",
      billing: {
        billed: billed ? billed.toFixed(2) : "",
        paid: paid ? paid.toFixed(2) : "",
        paidDate: billingRecord?.paidDate ?? matrix.paidDate ?? "",
      },
      isHidden: (key) => sectionModes[key] === "hide" || sectionHidden(key),
      canViewEncounters: canView("encounters"),
      dischargeIndex,
    });
    return {
      ...base,
      termGroups,
      people: goatPeople(
        base.specialists.map((s) => ({ name: s.name, sentDate: s.sentDate })),
        canSeeContacts ? contacts : [],
      ),
      files: goatFiles.enabled ? goatFiles.files : null,
    };
  }, [patient, appointments, dischargeIndex, encounters, notes, diagnoses, plans, macroLibrary.templates, billingRecord, sectionModes, sectionHidden, canView, termGroups, contacts, canSeeContacts, goatFiles.enabled, goatFiles.files]);

  return (
    <GoatPanel
      context={context}
      currentEncounterId={currentEncounterId}
      files={goatFiles}
      fileHref={`/patients/${encodeURIComponent(patient.id)}`}
      onOpenEncounter={onOpenEncounter}
      scope="file"
    />
  );
}
