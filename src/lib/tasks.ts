export type TaskPriority = "Low" | "Medium" | "High" | "Urgent";

export interface TaskRecord {
  id: string;
  title: string;
  priority: TaskPriority;
  done: boolean;
  dueDate: string; // ISO date (YYYY-MM-DD)
  createdAt: string; // ISO timestamp
  updatedAt: string; // ISO timestamp
  patientId?: string;
  patientName?: string;
  /** Who the task is assigned to (a person's label). Optional. */
  assignee?: string;
}

const STORAGE_KEY = "casemate.tasks.v1";
const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;
const prioritySet = new Set<TaskPriority>(["Low", "Medium", "High", "Urgent"]);

function normalizeText(value: unknown, fallback = "") {
  if (typeof value !== "string") {
    return fallback;
  }
  return value.trim();
}

function normalizeBoolean(value: unknown, fallback = false) {
  if (typeof value === "boolean") {
    return value;
  }
  return fallback;
}

function normalizeIsoDate(value: unknown, fallback = "") {
  const normalized = normalizeText(value, fallback);
  if (!normalized) {
    return "";
  }
  return isoDatePattern.test(normalized) ? normalized : fallback;
}

function normalizeIsoTimestamp(value: unknown) {
  const normalized = normalizeText(value);
  if (!normalized) {
    return "";
  }
  const stamp = new Date(normalized);
  if (Number.isNaN(stamp.getTime())) {
    return "";
  }
  return stamp.toISOString();
}

function normalizePriority(value: unknown): TaskPriority {
  if (typeof value === "string" && prioritySet.has(value as TaskPriority)) {
    return value as TaskPriority;
  }
  return "Medium";
}

function normalizeTask(value: unknown): TaskRecord | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const row = value as Partial<TaskRecord>;
  const id = normalizeText(row.id);
  const title = normalizeText(row.title);
  const priority = normalizePriority(row.priority);
  const done = normalizeBoolean(row.done);
  const dueDate = normalizeIsoDate(row.dueDate);
  const createdAt = normalizeIsoTimestamp(row.createdAt) || new Date().toISOString();
  const updatedAt = normalizeIsoTimestamp(row.updatedAt) || createdAt;
  const patientId = normalizeText(row.patientId);
  const patientName = normalizeText(row.patientName);
  const assignee = normalizeText(row.assignee);

  if (!id || !title) {
    return null;
  }

  return {
    id,
    title,
    priority,
    done,
    dueDate,
    createdAt,
    updatedAt,
    patientId: patientId || undefined,
    patientName: patientName || undefined,
    assignee: assignee || undefined,
  };
}

function compareByUpdatedAtDesc(left: TaskRecord, right: TaskRecord) {
  return right.updatedAt.localeCompare(left.updatedAt);
}

export function createTaskId() {
  return `TASK-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
}

export function getDefaultTasks(): TaskRecord[] {
  return [];
}

export function normalizeTasks(value: unknown): TaskRecord[] {
  if (!Array.isArray(value)) {
    return getDefaultTasks();
  }
  return value
    .map((entry) => normalizeTask(entry))
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
    .sort(compareByUpdatedAtDesc);
}

export function loadTasks(): TaskRecord[] {
  if (typeof window === "undefined") {
    return getDefaultTasks();
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return getDefaultTasks();
    }
    return normalizeTasks(JSON.parse(raw));
  } catch {
    return getDefaultTasks();
  }
}

export function saveTasks(rows: TaskRecord[]) {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(rows));
  void import("@/lib/kv-cloud").then((m) => m.dualWriteKv(STORAGE_KEY, "tasks", rows));
}

export function formatUsDateFromIso(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return "";
  }
  return `${match[2]}/${match[3]}/${match[1]}`;
}
