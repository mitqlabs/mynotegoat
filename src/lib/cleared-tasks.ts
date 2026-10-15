/**
 * "Clear task" (ignore) — distinct from Done. A cleared Case Flow item (e.g. a
 * Lien task that stays "needed") or To-Do stops showing in Case Flow, the
 * dashboard counts, Morning Rundown and /view todo, and is not regenerated
 * for that case. Nothing is deleted: each clear is a record with who/when,
 * and "Show cleared" can restore it (restore = cleared:false, newer stamp).
 *
 * Stored as [{ id, cleared, by, updatedAt }] so the cloud boot merge
 * (kv-merge unionMerge, UNION_MERGE_KEYS) keeps both sides per id, newest wins.
 *
 * Ids: Case Flow → "fu:<patientId>|<category>" (stage-independent, so a
 * cleared Lien row doesn't come back when its stage text changes);
 * To-Do → "task:<taskId>".
 */
import { unionMerge } from "@/lib/kv-merge";

export const CLEARED_TASKS_KEY = "casemate.cleared-tasks.v1";

export interface ClearedRecord {
  id: string;
  cleared: boolean;
  by: string;
  updatedAt: string;
  /** What was cleared, for the "Show cleared" list. */
  label?: string;
}

export const followUpClearId = (patientId: string, category: string) => `fu:${patientId}|${category}`;
export const taskClearId = (taskId: string) => `task:${taskId}`;

function normalize(v: unknown): ClearedRecord[] {
  if (!Array.isArray(v)) return [];
  return v.filter((r): r is ClearedRecord => !!r && typeof r === "object" && typeof (r as ClearedRecord).id === "string").map((r) => ({
    id: r.id,
    cleared: r.cleared !== false,
    by: typeof r.by === "string" ? r.by : "",
    updatedAt: typeof r.updatedAt === "string" ? r.updatedAt : "",
    ...(typeof r.label === "string" && r.label ? { label: r.label } : {}),
  }));
}

export function loadClearedRecords(): ClearedRecord[] {
  if (typeof window === "undefined") return [];
  try {
    return normalize(JSON.parse(window.localStorage.getItem(CLEARED_TASKS_KEY) ?? "[]"));
  } catch {
    return [];
  }
}

/** Ids currently cleared (restored ones excluded). */
export function clearedIdSet(records: ClearedRecord[] = loadClearedRecords()): Set<string> {
  return new Set(records.filter((r) => r.cleared).map((r) => r.id));
}

/** Pure: set one id cleared / restored. */
export function setCleared(records: ClearedRecord[], id: string, cleared: boolean, by: string, now: string, label?: string): ClearedRecord[] {
  const rest = records.filter((r) => r.id !== id);
  const prev = records.find((r) => r.id === id);
  return [...rest, { id, cleared, by, updatedAt: now, ...(label ?? prev?.label ? { label: label ?? prev?.label } : {}) }];
}

export function mergeClearedRecords(local: ClearedRecord[], cloud: unknown): ClearedRecord[] {
  return normalize(unionMerge(local, normalize(cloud)));
}

/** Save locally, then merge with the cloud copy before writing it (never drops another device's clears). */
export async function saveClearedRecords(records: ClearedRecord[]): Promise<void> {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(CLEARED_TASKS_KEY, JSON.stringify(records));
  try {
    const kv = await import("@/lib/kv-cloud");
    const remote = await kv.fetchKvValue<unknown>(CLEARED_TASKS_KEY).catch(() => null);
    const merged = mergeClearedRecords(records, remote);
    window.localStorage.setItem(CLEARED_TASKS_KEY, JSON.stringify(merged));
    await kv.dualWriteKv(CLEARED_TASKS_KEY, "tasks", merged);
  } catch {
    // Local copy stands; the boot merge reconciles later.
  }
}
