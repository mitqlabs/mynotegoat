"use client";

import { useEffect, useMemo, useState } from "react";
import { NewPatientCasePopup, type CaseAttorneyOption } from "@/components/new-patient-case-popup";
import { reviewCasePopup, scheduleCaseLabel, type CasePopupConflict, type CasePopupDraft } from "@/lib/new-patient-intake";
import { useContactDirectory } from "@/hooks/use-contact-directory";
import { useScheduleAppointments } from "@/hooks/use-schedule-appointments";
import { useScheduleAppointmentTypes } from "@/hooks/use-schedule-appointment-types";
import { useScheduleSettings } from "@/hooks/use-schedule-settings";
import { createAppointmentId } from "@/lib/schedule-appointments";
import { loadOfficeSettings } from "@/lib/office-settings";
import { caseNumberStampFor, renderCaseNumber } from "@/lib/case-number";
import { formatUsPhoneInput } from "@/lib/phone-format";
import { usDateToIso } from "@/components/patient-person-fields";
import { usePatientBilling } from "@/hooks/use-patient-billing";
import { useCaseStatuses } from "@/hooks/use-case-statuses";
import { useTasks } from "@/hooks/use-tasks";
import { currentAuthor } from "@/hooks/use-case-note-entries";
import { formatEntryDate, CASE_NOTE_ENTRIES_KEY, addEntry, entriesForPatient, loadCaseNoteEntries, makeEntry, saveCaseNoteEntries } from "@/lib/case-note-entries";
import { logActivity } from "@/lib/activity-log";
import { getCaseNote, STORAGE_KEY_CASE_NOTES } from "@/lib/case-notes";
import { caseNumberOf } from "@/lib/follow-up-queue";
import { PATIENTS_STORAGE_KEY, createPatientRecord, patients, updatePatientRecordById, type PatientRecord } from "@/lib/mock-data";
import { notifyChange, onLocalChange } from "@/lib/local-sync";
import { patientFoldersEnabled } from "@/lib/patient-folder-flag";
import {
  formatDobDisplay,
  groupPatientCases,
  resolveCaseMoney,
  splitFullName,
  type FolderCaseInput,
} from "@/lib/patient-folders";
import {
  loadFolderCloud,
  newFolderNoteId,
  saveFolderCloud,
  subscribeFolderCloud,
  type FolderGeneralNote,
} from "@/lib/patient-folder-store";
import { saveFolderPerson, savePatientPhoto } from "@/lib/patient-folder-runtime";
import {
  PatientFolderListView,
  PatientFolderPageView,
  type FolderCaseRow,
  type FolderDetail,
  type FolderListRow,
} from "@/components/patient-folder-views";

function caseInputs(getBilling: (id: string) => { billedAmount: number; paidAmount: number; paidDate?: string } | null): FolderCaseInput[] {
  return patients
    .filter((patient) => !patient.deleted)
    .map((patient) => {
      const money = resolveCaseMoney(getBilling(patient.id), patient.matrix);
      return {
        id: patient.id,
        fullName: patient.fullName,
        dob: patient.dob,
        phone: patient.phone,
        email: patient.email,
        address: patient.address,
        sex: patient.sex,
        maritalStatus: patient.maritalStatus,
        alerts: patient.alerts,
        caseStatus: patient.caseStatus,
        billed: money.billed,
        paid: money.paid,
      };
    });
}

function caseOpenedOn(patient: PatientRecord): string {
  const doi = patient.dateOfLoss?.trim() ?? "";
  if (/^\d{4}-\d{2}-\d{2}/.test(doi)) return doi.slice(0, 10);
  const us = doi.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (us) return `${us[3]}-${us[1]}-${us[2]}`;
  const stamp = patient.id.match(/^PT-(\d{10,})/);
  if (stamp) {
    const date = new Date(Number(stamp[1]));
    if (!Number.isNaN(date.getTime())) return date.toISOString().slice(0, 10);
  }
  return "";
}

function caseRow(patient: PatientRecord, billing: { billedAmount: number; paidAmount: number; paidDate?: string } | null): FolderCaseRow {
  const money = resolveCaseMoney(billing, patient.matrix);
  return {
    id: patient.id,
    caseNumber: caseNumberOf(patient) || patient.id,
    dateOfInjury: formatDobDisplay(patient.dateOfLoss) || patient.dateOfLoss || "—",
    openedOn: caseOpenedOn(patient),
    initialExam: formatDobDisplay(patient.matrix?.initialExam ?? "") || patient.matrix?.initialExam || "—",
    attorney: patient.attorney || "—",
    attorneyPhone: "",
    location: patient.locationId || "—",
    status: patient.caseStatus,
    review: patient.matrix?.review || "",
    lop: patient.matrix?.lien || "",
    priorCare: patient.matrix?.priorCare || "",
    discharge: patient.matrix?.discharge || "",
    billed: money.billed,
    paid: money.paid,
    paidDate: billing?.paidDate || patient.matrix?.paidDate || "",
    owed: money.owed,
    notes: [],
  };
}

function useFolderTick(): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const bump = () => setTick((value) => value + 1);
    const stopCloud = subscribeFolderCloud(bump);
    const stopPatients = onLocalChange(PATIENTS_STORAGE_KEY, bump);
    const stopNotes = onLocalChange(CASE_NOTE_ENTRIES_KEY, bump);
    const stopEarlier = onLocalChange(STORAGE_KEY_CASE_NOTES, bump);
    return () => {
      stopCloud();
      stopPatients();
      stopNotes();
      stopEarlier();
    };
  }, []);
  return tick;
}

export function PatientFolderListPage({ onNewPatient }: { onNewPatient: () => void }) {
  const { getRecord } = usePatientBilling();
  const { caseStatuses } = useCaseStatuses();
  const tick = useFolderTick();
  const rows: FolderListRow[] = useMemo(() => {
    void tick;
    const grouping = groupPatientCases(caseInputs(getRecord));
    const byId = new Map(patients.map((patient) => [patient.id, patient]));
    return grouping.folders
      .map((folder) => {
        const members = folder.caseIds.map((id) => byId.get(id)).filter((row): row is PatientRecord => Boolean(row));
        const cloud = loadFolderCloud();
        const counts: Record<string, number> = {};
        for (const status of caseStatuses) counts[status.name] = 0;
        for (const member of members) {
          const key = member.caseStatus.trim().toLowerCase();
          const match = caseStatuses.find((status) => status.name.trim().toLowerCase() === key);
          if (match) counts[match.name] += 1;
        }
        return {
          id: folder.id,
          name: folder.person.fullName,
          dob: folder.person.dob,
          phone: folder.person.phone,
          photo: cloud.people[folder.id]?.photoDataUrl || undefined,
          counts,
          total: members.length,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
    // tick re-reads the module-level patient list and the folder cloud.
  }, [caseStatuses, getRecord, tick]);

  if (!patientFoldersEnabled()) return null;

  return (
    <PatientFolderListView
      onNewPatient={onNewPatient}
      onOpen={(id) => window.location.assign(`/patients/${id}`)}
      rows={rows}
      statuses={caseStatuses.map((status) => ({ name: status.name, color: status.color }))}
    />
  );
}

function folderDetail(folderId: string, getRecord: (id: string) => { billedAmount: number; paidAmount: number; paidDate?: string } | null): FolderDetail | null {
  const grouping = groupPatientCases(caseInputs(getRecord));
  const folder = grouping.folders.find((item) => item.id === folderId);
  if (!folder) return null;
  const cloud = loadFolderCloud();
  const override = cloud.people[folder.id];
  const person = override
    ? {
        ...folder.person,
        fullName: override.fullName,
        dob: override.dob,
        phone: override.phone,
        email: override.email,
        address: override.address,
        sex: override.sex,
        maritalStatus: override.maritalStatus,
        alerts: override.alerts,
      }
    : folder.person;
  const byId = new Map(patients.map((patient) => [patient.id, patient]));
  const members = folder.caseIds.map((id) => byId.get(id)).filter((row): row is PatientRecord => Boolean(row));
  const notes = cloud.notes
    .filter((note) => note.folderId === folder.id && !note.deleted)
    .map((note) => ({ id: note.id, date: formatEntryDate(note.date), author: note.author, text: note.text }));
  const todos = cloud.todos
    .filter((todo) => todo.folderId === folder.id && !todo.deleted && !todo.done)
    .map((todo) => ({ id: todo.id, title: todo.title, due: todo.dueDate }));
  return {
    id: folder.id,
    name: person.fullName,
    dob: person.dob,
    phone: person.phone,
    sex: person.sex,
    maritalStatus: person.maritalStatus,
    email: person.email,
    address: person.address,
    alerts: person.alerts,
    textRemindersOff: members[0]?.textRemindersOff === true,
    photo: override?.photoDataUrl || undefined,
    todos,
    notes,
    cases: folder.caseIds
      .map((id) => byId.get(id))
      .filter((row): row is PatientRecord => Boolean(row))
      .map((patient) => {
        const row = caseRow(patient, getRecord(patient.id));
        const log = loadCaseNoteEntries();
        row.notes = entriesForPatient(log, patient.id).map((entry) => ({
          id: entry.id,
          date: formatEntryDate(entry.date),
          author: entry.author,
          text: entry.text,
        }));
        const stored = getCaseNote(patient.id);
        const earlier = stored !== null ? stored : (patient.matrix?.notes ?? "");
        row.earlierNotes = earlier.trim();
        return row;
      }),
  };
}

export function PatientFolderRecordPage({ folderId }: { folderId: string }) {
  const { getRecord } = usePatientBilling();
  const { tasks, addTask, toggleTaskDone } = useTasks();
  const { contacts } = useContactDirectory();
  const { scheduleAppointments, addAppointments } = useScheduleAppointments();
  const { scheduleSettings } = useScheduleSettings();
  const { appointmentTypes } = useScheduleAppointmentTypes();
  const [addingCase, setAddingCase] = useState(false);
  const [caseMessage, setCaseMessage] = useState("");
  const [caseConflict, setCaseConflict] = useState<CasePopupConflict | null>(null);
  const tick = useFolderTick();
  const folder = useMemo(() => {
    void tick;
    return folderDetail(folderId, getRecord);
  }, [folderId, getRecord, tick]);
  const todoItems = useMemo(() => {
    if (!folder) return [];
    const caseIds = new Set(folder.cases.map((row) => row.id));
    const caseLabel = new Map(folder.cases.map((row) => [row.id, row.caseNumber]));
    const person = folder.name.trim().toLowerCase();
    return tasks
      .filter((task) => {
        if (task.patientId && caseIds.has(task.patientId)) return true;
        return !task.patientId && person.length > 0 && (task.patientName ?? "").trim().toLowerCase() === person;
      })
      .map((task) => ({
        id: task.id,
        title: task.title,
        done: task.done,
        priority: task.priority,
        dueDate: task.dueDate,
        caseLabel: task.patientId ? caseLabel.get(task.patientId) : undefined,
      }));
  }, [folder, tasks]);
  if (!folder) {
    return <p className="p-6 text-sm">That patient folder is not in this office.</p>;
  }
  const names = splitFullName(folder.name);
  const attorneyName = folder.cases.find((row) => row.attorney && row.attorney !== "—" && row.attorney.toLowerCase() !== "self")?.attorney ?? "";
  const attorneys: CaseAttorneyOption[] = [];
  const seenAttorney = new Set<string>();
  for (const contact of contacts) {
    if (contact.category.toLowerCase() !== "attorney") continue;
    const key = contact.name.trim().toLowerCase();
    if (!key || seenAttorney.has(key)) continue;
    seenAttorney.add(key);
    attorneys.push({ id: contact.id, name: contact.name, phone: contact.phone });
  }
  const matched = attorneys.find((contact) => contact.name.trim().toLowerCase() === attorneyName.trim().toLowerCase());
  return (
    <>
    <PatientFolderPageView
        folder={folder}
        onAddNote={(draft) => {
          const { author, userId } = currentAuthor();
          if (draft.caseId) {
            const patient = patients.find((row) => row.id === draft.caseId);
            if (!patient) return;
            const entry = makeEntry({ patientId: patient.id, text: draft.text, author, authorUserId: userId });
            if (!entry) return;
            void saveCaseNoteEntries(addEntry(loadCaseNoteEntries(), entry));
            notifyChange(CASE_NOTE_ENTRIES_KEY);
            logActivity({
              category: "notes",
              action: "case_note.added",
              summary: "Added a note to Notes",
              patientId: patient.id,
              patientName: patient.fullName,
              details: { text: entry.text },
            });
            return;
          }
          const cloud = loadFolderCloud();
          const now = new Date().toISOString();
          const note: FolderGeneralNote = {
            id: newFolderNoteId(),
            folderId,
            text: draft.text,
            date: now.slice(0, 10),
            author,
            authorUserId: userId,
            createdAt: now,
            updatedAt: now,
          };
          void saveFolderCloud({ ...cloud, notes: [note, ...cloud.notes] });
        }}
        onAddAlert={(text) => {
          const caseId = folder.cases[0]?.id;
          if (!caseId) return;
          updatePatientRecordById(caseId, { alerts: [...folder.alerts, text] });
        }}
        onAddTodo={(draft) => {
          const attached = draft.caseId ? patients.find((row) => row.id === draft.caseId) : undefined;
          if (draft.caseId && !attached) return "That case is not on this patient.";
          const result = addTask({
            title: draft.title,
            priority: draft.priority,
            dueDate: draft.dueDate,
            patientName: attached?.fullName || folder.name,
            ...(attached ? { patientId: attached.id } : {}),
          });
          return result.added ? "" : result.reason;
        }}
        onToggleTodo={toggleTaskDone}
        todoItems={todoItems}
        onBack={() => window.location.assign("/patients")}
        onAddCase={() => setAddingCase(true)}
        onOpenCase={(caseId) => window.location.assign(`/patients/${caseId}`)}
        onSavePhoto={(dataUrl) => {
          void savePatientPhoto(folder.id, dataUrl, {
            fullName: folder.name,
            dob: folder.dob,
            phone: folder.phone,
            email: folder.email,
            address: folder.address,
            sex: folder.sex,
            maritalStatus: folder.maritalStatus,
            alerts: folder.alerts,
          });
        }}
        onSavePerson={(next) => {
          const firstName = next.firstName.trim();
          const lastName = next.lastName.trim();
          const fullName =
            firstName || lastName
              ? `${lastName || names.lastName}, ${firstName || names.firstName}`
              : folder.name;
          const typedDob = usDateToIso(next.dob);
          void saveFolderPerson(folder.id, {
            fullName,
            dob: typedDob || (next.dob.trim() ? folder.dob : ""),
            phone: formatUsPhoneInput(next.phone) || "-",
            email: next.email.trim(),
            address: next.address.trim(),
            sex: next.sex,
            maritalStatus: next.maritalStatus,
            alerts: folder.alerts,
          });
          if (next.textRemindersOff !== (folder.textRemindersOff === true)) {
            for (const row of folder.cases) {
              updatePatientRecordById(row.id, { textRemindersOff: next.textRemindersOff });
            }
          }
        }}
    />
    {addingCase && (
      <NewPatientCasePopup
        attorneys={attorneys}
        conflict={caseConflict}
        initial={{
          attorney: matched?.name ?? attorneyName,
          attorneyPhone: matched ? formatUsPhoneInput(matched.phone) : "",
          dateOfLoss: "",
          evalDate: "",
          evalTime: "",
        }}
        message={caseMessage}
        onCaseNumber={(dateOfLoss) => caseNumberPreview(dateOfLoss, names.lastName, names.firstName)}
        onClose={() => {
          setAddingCase(false);
          setCaseMessage("");
          setCaseConflict(null);
        }}
        onDismissIssue={() => {
          setCaseMessage("");
          setCaseConflict(null);
        }}
        onSave={(draft, bookAnyway) => {
          const reviewed = reviewCasePopup(draft, {
            bookAnyway,
            appointments: scheduleAppointments,
            settings: scheduleSettings,
            types: appointmentTypes,
          });
          if (!reviewed.ok) {
            setCaseMessage(reviewed.message);
            setCaseConflict(reviewed.conflict ?? null);
            return;
          }
          const created = createPatientRecord({
            firstName: names.firstName || folder.name,
            lastName: names.lastName || folder.name,
            dob: folder.dob,
            phone: folder.phone,
            email: folder.email,
            address: folder.address,
            sex: folder.sex === "Male" || folder.sex === "Female" || folder.sex === "Other" ? folder.sex : undefined,
            maritalStatus: folder.maritalStatus === "Single" || folder.maritalStatus === "Married" || folder.maritalStatus === "Divorced" || folder.maritalStatus === "Widowed" ? folder.maritalStatus : undefined,
            attorney: draft.attorney || "Self",
            dateOfLoss: draft.dateOfLoss,
            initialExam: reviewed.initialExamIso,
          });
          if (!created) {
            setCaseMessage("Could not add that case.");
            return;
          }
          if (reviewed.visit) {
            const office = loadOfficeSettings();
            try {
              addAppointments([
                {
                  id: createAppointmentId(),
                  patientId: created.id,
                  patientName: created.fullName,
                  provider: office.doctorName?.trim() ?? "",
                  location: office.officeName?.trim() ?? "",
                  appointmentType: reviewed.visit.type,
                  caseLabel: scheduleCaseLabel(reviewed.dateOfLossIso, created.fullName),
                  room: "",
                  date: reviewed.visit.iso,
                  startTime: reviewed.visit.time,
                  durationMin: reviewed.visit.durationMin,
                  status: "Scheduled",
                  note: "",
                  overrideOfficeHours: reviewed.visit.override,
                },
              ]);
            } catch (error) {
              setCaseMessage(error instanceof Error ? error.message : "The schedule couldn't be saved.");
              return;
            }
          }
          setAddingCase(false);
          window.location.assign(`/patients/${created.id}`);
        }}
        purpose="intake"
      />
    )}
    </>
  );
}

function caseNumberPreview(dateOfLoss: string, lastName: string, firstName: string) {
  const dateDigits = dateOfLoss.replace(/\D/g, "");
  if (dateDigits.length < 8) return "";
  const stamp = caseNumberStampFor(
    loadOfficeSettings().caseNumberFormat,
    patients.map((existing) => existing.matrix?.caseSeq),
  );
  if (stamp.caseNumberFormat) {
    return renderCaseNumber(stamp.caseNumberFormat, {
      mm: dateDigits.slice(0, 2),
      dd: dateDigits.slice(2, 4),
      yyyy: dateDigits.slice(4, 8),
      lastName,
      firstName,
      seq: parseInt(stamp.caseSeq ?? "", 10) || undefined,
    });
  }
  const lastInitials = lastName.replace(/[^a-z]/gi, "").toUpperCase().slice(0, 2);
  const firstInitials = firstName.replace(/[^a-z]/gi, "").toUpperCase().slice(0, 2);
  return `${dateDigits.slice(0, 2)}${dateDigits.slice(2, 4)}${dateDigits.slice(6, 8)}${lastInitials}${firstInitials}`;
}

