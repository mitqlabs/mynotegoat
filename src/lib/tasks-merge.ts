/**
 * Per-item merge of the To-Do list (casemate.tasks.v1) at cloud bootstrap.
 *
 * The list is stored as ONE array in workspace_kv, so deletions leave no
 * trace. The generic bootstrap rule "keep local if it has more entries than
 * cloud" therefore kept a stale device's old list forever (22 deletions on
 * one computer never showed on another), and the next edit there would have
 * pushed the old list back up.
 *
 * Rule, using the cloud row's updated_at (the last time ANY device saved):
 *  - id in both          → the copy with the newer updatedAt wins (tie → cloud).
 *  - id only in cloud    → kept.
 *  - id only on this device:
 *      updatedAt AFTER the cloud row was saved → an unsynced local add/edit,
 *        kept (and the merged list is uploaded);
 *      otherwise → it existed when the cloud was last saved and is missing
 *        there, so another device deleted it → dropped.
 *  - No usable cloud timestamp → cloud wins for local-only items (safe side).
 *
 * Pure; no storage or network access.
 */

type RawTask = Record<string, unknown> & { id?: unknown; updatedAt?: unknown };

export interface TaskMergeResult {
  merged: RawTask[];
  /** True when the merged list differs from the cloud copy (local-only
   *  new items or newer local edits) and must be uploaded. */
  needsUpload: boolean;
  keptLocalOnly: number;
  droppedLocalOnly: number;
  localNewerEdits: number;
}

function toMs(value: unknown): number {
  if (typeof value !== "string" || !value.trim()) return Number.NaN;
  return new Date(value).getTime();
}

function idOf(row: RawTask): string {
  return typeof row.id === "string" ? row.id.trim() : "";
}

function asRows(value: unknown): RawTask[] {
  if (!Array.isArray(value)) return [];
  return value.filter((row): row is RawTask => Boolean(row) && typeof row === "object" && Boolean(idOf(row as RawTask)));
}

export function mergeTaskLists(
  localValue: unknown,
  cloudValue: unknown,
  cloudUpdatedAt: string | null | undefined,
): TaskMergeResult {
  const local = asRows(localValue);
  const cloud = asRows(cloudValue);
  const cloudSavedMs = toMs(cloudUpdatedAt ?? "");
  const localById = new Map(local.map((row) => [idOf(row), row]));
  const cloudIds = new Set(cloud.map(idOf));

  let localNewerEdits = 0;
  let keptLocalOnly = 0;
  let droppedLocalOnly = 0;
  const merged: RawTask[] = [];

  for (const cloudRow of cloud) {
    const localRow = localById.get(idOf(cloudRow));
    if (localRow) {
      const localMs = toMs(localRow.updatedAt);
      const cloudMs = toMs(cloudRow.updatedAt);
      if (Number.isFinite(localMs) && (!Number.isFinite(cloudMs) || localMs > cloudMs)) {
        merged.push(localRow);
        localNewerEdits += 1;
        continue;
      }
    }
    merged.push(cloudRow);
  }

  for (const localRow of local) {
    if (cloudIds.has(idOf(localRow))) continue;
    const localMs = toMs(localRow.updatedAt);
    if (Number.isFinite(cloudSavedMs) && Number.isFinite(localMs) && localMs > cloudSavedMs) {
      merged.push(localRow);
      keptLocalOnly += 1;
    } else {
      droppedLocalOnly += 1;
    }
  }

  merged.sort((a, b) => String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? "")));
  return {
    merged,
    needsUpload: keptLocalOnly > 0 || localNewerEdits > 0,
    keptLocalOnly,
    droppedLocalOnly,
    localNewerEdits,
  };
}
