"use client";

/**
 * Folder-only cloud record: person edits, General Notes, and general to-dos.
 * Stored in workspace_kv under its own key. Case notes stay in
 * casemate.case-note-entries.v1 and are never written here.
 *
 * Nothing in this module runs unless the folder switch is on. With the
 * switch off, load returns an empty record and save does nothing.
 */
import { patientFoldersEnabled } from "@/lib/patient-folder-flag";
import { notifyChange, onLocalChange } from "@/lib/local-sync";
import { unionMerge } from "@/lib/kv-merge";

export const PATIENT_FOLDERS_KEY = "casemate.patient-folders.v1";

export type FolderPersonRecord = {
  folderId: string;
  fullName: string;
  dob: string;
  phone: string;
  email: string;
  address: string;
  sex: string;
  maritalStatus: string;
  alerts: string[];
  updatedAt: string;
};

/** Same shape as a case note entry, but folderId is a patient folder, never a case id. */
export type FolderGeneralNote = {
  id: string;
  folderId: string;
  text: string;
  date: string;
  author: string;
  authorUserId: string;
  createdAt: string;
  updatedAt: string;
  editedBy?: string;
  deleted?: boolean;
};

export type FolderGeneralTodo = {
  id: string;
  folderId: string;
  title: string;
  dueDate: string;
  done: boolean;
  updatedAt: string;
  deleted?: boolean;
};

export type PatientFolderCloud = {
  people: Record<string, FolderPersonRecord>;
  notes: FolderGeneralNote[];
  todos: FolderGeneralTodo[];
};

export function emptyFolderCloud(): PatientFolderCloud {
  return { people: {}, notes: [], todos: [] };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export function normalizeFolderCloud(value: unknown): PatientFolderCloud {
  const row = asRecord(value);
  if (!row) return emptyFolderCloud();
  const people: Record<string, FolderPersonRecord> = {};
  const rawPeople = asRecord(row.people);
  if (rawPeople) {
    for (const [key, entry] of Object.entries(rawPeople)) {
      const person = asRecord(entry);
      if (!person) continue;
      const fullName = typeof person.fullName === "string" ? person.fullName : "";
      if (!fullName.trim()) continue;
      people[key] = {
        folderId: typeof person.folderId === "string" ? person.folderId : key,
        fullName,
        dob: typeof person.dob === "string" ? person.dob : "",
        phone: typeof person.phone === "string" ? person.phone : "",
        email: typeof person.email === "string" ? person.email : "",
        address: typeof person.address === "string" ? person.address : "",
        sex: typeof person.sex === "string" ? person.sex : "",
        maritalStatus: typeof person.maritalStatus === "string" ? person.maritalStatus : "",
        alerts: Array.isArray(person.alerts) ? person.alerts.filter((item): item is string => typeof item === "string") : [],
        updatedAt: typeof person.updatedAt === "string" ? person.updatedAt : "",
      };
    }
  }
  const notes: FolderGeneralNote[] = [];
  if (Array.isArray(row.notes)) {
    for (const entry of row.notes) {
      const note = asRecord(entry);
      if (!note) continue;
      const id = typeof note.id === "string" ? note.id.trim() : "";
      const folderId = typeof note.folderId === "string" ? note.folderId.trim() : "";
      const text = typeof note.text === "string" ? note.text : "";
      if (!id || !folderId || !text.trim()) continue;
      notes.push({
        id,
        folderId,
        text,
        date: typeof note.date === "string" ? note.date : "",
        author: typeof note.author === "string" ? note.author : "",
        authorUserId: typeof note.authorUserId === "string" ? note.authorUserId : "",
        createdAt: typeof note.createdAt === "string" ? note.createdAt : "",
        updatedAt: typeof note.updatedAt === "string" ? note.updatedAt : "",
        editedBy: typeof note.editedBy === "string" ? note.editedBy : undefined,
        deleted: note.deleted === true ? true : undefined,
      });
    }
  }
  const todos: FolderGeneralTodo[] = [];
  if (Array.isArray(row.todos)) {
    for (const entry of row.todos) {
      const todo = asRecord(entry);
      if (!todo) continue;
      const id = typeof todo.id === "string" ? todo.id.trim() : "";
      const folderId = typeof todo.folderId === "string" ? todo.folderId.trim() : "";
      const title = typeof todo.title === "string" ? todo.title : "";
      if (!id || !folderId || !title.trim()) continue;
      todos.push({
        id,
        folderId,
        title,
        dueDate: typeof todo.dueDate === "string" ? todo.dueDate : "",
        done: todo.done === true,
        updatedAt: typeof todo.updatedAt === "string" ? todo.updatedAt : "",
        deleted: todo.deleted === true ? true : undefined,
      });
    }
  }
  return { people, notes, todos };
}

export function loadFolderCloud(): PatientFolderCloud {
  if (!patientFoldersEnabled() || typeof window === "undefined") return emptyFolderCloud();
  try {
    const raw = window.localStorage.getItem(PATIENT_FOLDERS_KEY);
    if (!raw) return emptyFolderCloud();
    return normalizeFolderCloud(JSON.parse(raw));
  } catch {
    return emptyFolderCloud();
  }
}

function cache(value: PatientFolderCloud) {
  try {
    window.localStorage.setItem(PATIENT_FOLDERS_KEY, JSON.stringify(value));
  } catch {
    /* the cloud write below is the record */
  }
  notifyChange(PATIENT_FOLDERS_KEY);
}

/**
 * Merge with the cloud copy, then write. Refuses to run when the switch is
 * off, and never touches case notes or the patients table.
 */
export async function saveFolderCloud(next: PatientFolderCloud): Promise<{ cloudOk: boolean }> {
  if (!patientFoldersEnabled()) return { cloudOk: false };
  const normalized = normalizeFolderCloud(next);
  if (typeof window === "undefined") return { cloudOk: true };
  cache(normalized);
  try {
    const kv = await import("@/lib/kv-cloud");
    const remote = await kv.fetchKvValue<unknown>(PATIENT_FOLDERS_KEY).catch(() => null);
    const merged = normalizeFolderCloud(unionMerge(normalized, remote));
    cache(merged);
    await kv.dualWriteKvOrThrow(PATIENT_FOLDERS_KEY, "tasks", merged);
    return { cloudOk: true };
  } catch (err) {
    console.error("[patient-folders] cloud save failed; kept on this device and queued:", err);
    return { cloudOk: false };
  }
}

export function subscribeFolderCloud(listener: () => void): () => void {
  return onLocalChange(PATIENT_FOLDERS_KEY, listener);
}

export function newFolderNoteId(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return `gn-${crypto.randomUUID()}`;
    }
  } catch {
    /* fall through */
  }
  return `gn-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
