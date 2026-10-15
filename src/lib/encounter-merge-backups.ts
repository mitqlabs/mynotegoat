/**
 * Restorable backups of G.O.A.T. duplicate-encounter merges. Cloud-only: one
 * workspace_kv row (registered as "workspace" in cloud-key-registry). A merge
 * is refused unless its backup is confirmed in the cloud first.
 */
import type { EncounterNoteRecord } from "@/lib/encounter-notes";

export const ENCOUNTER_MERGE_BACKUPS_KEY = "casemate.encounter-merge-backups.v1";
const MAX_BACKUPS = 200;

export interface EncounterMergeBackup {
  id: string;
  at: string; // ISO
  by: string;
  patientId: string;
  patientName: string;
  date: string;
  mode: "keepFuller" | "union";
  /** The kept encounter before the merge (restored as is). */
  keptBefore: EncounterNoteRecord;
  /** The encounters that were removed (re-created on restore). */
  removed: EncounterNoteRecord[];
  /** Cash payments re-pointed from a removed encounter to the kept one. */
  movedCashPayments: Array<{ paymentId: string; fromEncounterId: string }>;
  restoredAt?: string;
}

/** Pure: the list after adding a backup (newest first, capped). */
export function withBackup(list: EncounterMergeBackup[], b: EncounterMergeBackup): EncounterMergeBackup[] {
  return [b, ...list.filter((x) => x.id !== b.id)].slice(0, MAX_BACKUPS);
}
/** Pure: the list with a backup marked restored. */
export function markRestored(list: EncounterMergeBackup[], id: string, at: string): EncounterMergeBackup[] {
  return list.map((x) => (x.id === id ? { ...x, restoredAt: at } : x));
}

export async function loadMergeBackups(): Promise<EncounterMergeBackup[]> {
  const { fetchKvValue } = await import("@/lib/kv-cloud");
  const v = await fetchKvValue<EncounterMergeBackup[]>(ENCOUNTER_MERGE_BACKUPS_KEY);
  return Array.isArray(v) ? v : [];
}

/** Write the list and read it back; throws unless the cloud has it. */
async function writeConfirmed(list: EncounterMergeBackup[], mustHave: (l: EncounterMergeBackup[]) => boolean) {
  const { upsertKvValue } = await import("@/lib/kv-cloud");
  await upsertKvValue(ENCOUNTER_MERGE_BACKUPS_KEY, list);
  const back = await loadMergeBackups();
  if (!mustHave(back)) throw new Error("The backup didn't reach the cloud, so nothing was changed. Check your connection and try again.");
}

export async function saveMergeBackupOrThrow(b: EncounterMergeBackup): Promise<void> {
  const list = await loadMergeBackups();
  await writeConfirmed(withBackup(list, b), (l) => l.some((x) => x.id === b.id));
}

export async function markBackupRestored(id: string): Promise<void> {
  const list = await loadMergeBackups();
  const at = new Date().toISOString();
  await writeConfirmed(markRestored(list, id, at), (l) => l.some((x) => x.id === id && x.restoredAt));
}
