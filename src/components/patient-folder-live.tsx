"use client";

import { useEffect, useMemo, useState } from "react";
import { usePatientBilling } from "@/hooks/use-patient-billing";
import { useTasks } from "@/hooks/use-tasks";
import { currentAuthor } from "@/hooks/use-case-note-entries";
import { formatEntryDate } from "@/lib/case-note-entries";
import { caseNumberOf } from "@/lib/follow-up-queue";
import { PATIENTS_STORAGE_KEY, createPatientRecord, patients, type PatientRecord } from "@/lib/mock-data";
import { onLocalChange } from "@/lib/local-sync";
import { patientFoldersEnabled } from "@/lib/patient-folder-flag";
import {
  formatDobDisplay,
  groupPatientCases,
  resolveCaseMoney,
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

function caseRow(patient: PatientRecord, billing: { billedAmount: number; paidAmount: number; paidDate?: string } | null): FolderCaseRow {
  const money = resolveCaseMoney(billing, patient.matrix);
  return {
    id: patient.id,
    caseNumber: caseNumberOf(patient) || patient.id,
    dateOfInjury: formatDobDisplay(patient.dateOfLoss) || patient.dateOfLoss || "—",
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
    return () => {
      stopCloud();
      stopPatients();
    };
  }, []);
  return tick;
}

export function PatientFolderListPage() {
  const { getRecord } = usePatientBilling();
  const tick = useFolderTick();
  const rows: FolderListRow[] = useMemo(() => {
    void tick;
    const grouping = groupPatientCases(caseInputs(getRecord));
    const byId = new Map(patients.map((patient) => [patient.id, patient]));
    return grouping.folders
      .map((folder) => {
        const members = folder.caseIds.map((id) => byId.get(id)).filter((row): row is PatientRecord => Boolean(row));
        const cloud = loadFolderCloud();
        return {
          id: folder.id,
          name: folder.person.fullName,
          dob: folder.person.dob,
          phone: folder.person.phone,
          photo: cloud.people[folder.id]?.photoDataUrl || undefined,
          active: members.filter((row) => row.caseStatus === "Active").length,
          submitted: members.filter((row) => row.caseStatus === "Submitted").length,
          paid: members.filter((row) => row.caseStatus === "Paid").length,
          total: members.length,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
    // tick re-reads the module-level patient list and the folder cloud.
  }, [getRecord, tick]);

  if (!patientFoldersEnabled()) return null;

  return (
    <PatientFolderListView
      onCreate={(draft) => {
        const created = createPatientRecord({
          firstName: draft.firstName,
          lastName: draft.lastName,
          dob: draft.dob,
          phone: draft.phone,
          dateOfLoss: draft.openCase ? "" : "",
        });
        if (created) window.location.assign(`/patients/pf-${created.id}`);
      }}
      onOpen={(id) => window.location.assign(`/patients/${id}`)}
      rows={rows}
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
    photo: override?.photoDataUrl || undefined,
    todos,
    notes,
    cases: folder.caseIds
      .map((id) => byId.get(id))
      .filter((row): row is PatientRecord => Boolean(row))
      .map((patient) => caseRow(patient, getRecord(patient.id))),
  };
}

export function PatientFolderRecordPage({ folderId }: { folderId: string }) {
  const { getRecord } = usePatientBilling();
  const { tasks, addTask, toggleTaskDone } = useTasks();
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
  return (
    <PatientFolderPageView
        folder={folder}
        onAddNote={(text) => {
          const { author, userId } = currentAuthor();
          const cloud = loadFolderCloud();
          const now = new Date().toISOString();
          const note: FolderGeneralNote = {
            id: newFolderNoteId(),
            folderId,
            text,
            date: now.slice(0, 10),
            author,
            authorUserId: userId,
            createdAt: now,
            updatedAt: now,
          };
          void saveFolderCloud({ ...cloud, notes: [note, ...cloud.notes] });
        }}
        onAddTodo={(draft) => {
          const result = addTask({
            title: draft.title,
            priority: draft.priority,
            dueDate: draft.dueDate,
            patientName: folder.name,
          });
          return result.added ? "" : result.reason;
        }}
        onToggleTodo={toggleTaskDone}
        todoItems={todoItems}
        onBack={() => window.location.assign("/patients")}
        onNewCase={(draft) => {
          const [lastName, firstName] = folder.name.split(",").map((part) => part.trim());
          const created = createPatientRecord({
            firstName: firstName || folder.name,
            lastName: lastName || folder.name,
            dob: folder.dob,
            phone: folder.phone,
            email: folder.email,
            address: folder.address,
            attorney: draft.attorney,
            dateOfLoss: draft.dateOfInjury,
          });
          if (created) window.location.assign(`/patients/${created.id}`);
        }}
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
          void saveFolderPerson(folder.id, {
            fullName: `${next.lastName.trim()}, ${next.firstName.trim()}`,
            dob: next.dob,
            phone: next.phone,
            email: next.email,
            address: next.address,
            sex: next.sex,
            maritalStatus: next.maritalStatus,
            alerts: folder.alerts,
          });
        }}
    />
  );
}

