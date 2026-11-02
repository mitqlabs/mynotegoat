/**
 * Pure merge helpers for encounter notes held in memory by the
 * useEncounterNotes() hook instances on a page. No React, no storage.
 *
 * Why this exists: the local cache only keeps a pruned slice of the notes
 * (recent / small), so a hook instance may legitimately hold notes that the
 * cache does NOT list. Those must never be treated as "deleted". A note is
 * only removed when something explicitly deleted it — recorded here.
 */
import type { EncounterNoteRecord } from "@/lib/encounter-notes";

/** Ids deleted on this page since load (explicit user deletes, realtime
 *  DELETE events). Shared by every hook instance on the page. */
const deletedEncounterIds = new Set<string>();

export function markEncounterDeleted(id: string): void {
  deletedEncounterIds.add(id);
}

/** Call when a note id is intentionally brought back (restore). */
export function unmarkEncounterDeleted(id: string): void {
  deletedEncounterIds.delete(id);
}

export function isEncounterDeleted(id: string): boolean {
  return deletedEncounterIds.has(id);
}

/** Test helper. */
export function __resetDeletedEncounterIdsForTest(): void {
  deletedEncounterIds.clear();
}

const ts = (iso: string) => Date.parse(iso) || 0;

/** Keep, per id, whichever copy has the newer updatedAt. Records only in
 *  `incoming` are added. Records only in `local` are KEPT — the local cache
 *  is a pruned subset, so absence from it does not mean deleted — except
 *  ids explicitly deleted on this page (`isDeleted`), which are removed. */
export function mergeNewerById(
  local: EncounterNoteRecord[],
  incoming: EncounterNoteRecord[],
  _now = Date.now(),
  isDeleted: (id: string) => boolean = isEncounterDeleted,
): EncounterNoteRecord[] {
  void _now;
  const incomingById = new Map<string, EncounterNoteRecord>();
  for (const inc of incoming) if (!incomingById.has(inc.id)) incomingById.set(inc.id, inc);
  const emitted = new Set<string>();
  const out: EncounterNoteRecord[] = [];
  // Local first (keeps order, so "nothing changed" returns the same array),
  // taking the incoming copy only when it is strictly newer.
  for (const cur of local) {
    if (emitted.has(cur.id) || isDeleted(cur.id)) continue;
    emitted.add(cur.id);
    const inc = incomingById.get(cur.id);
    out.push(inc && ts(inc.updatedAt) > ts(cur.updatedAt) ? inc : cur);
  }
  for (const inc of incomingById.values()) {
    if (emitted.has(inc.id) || isDeleted(inc.id)) continue;
    emitted.add(inc.id);
    out.push(inc);
  }
  if (out.length === local.length && out.every((n, i) => n === local[i])) return local;
  return out;
}

/** Combine a patient's notes fetched straight from the cloud with the
 *  in-memory list, for DISPLAY. In-memory copies win when at least as new.
 *  Notes deleted on this page never come back from a stale cloud snapshot.
 *  Returns `inMemory` itself (same reference) when the cloud adds nothing. */
export function mergePatientCloudNotes(
  inMemory: EncounterNoteRecord[],
  cloudForPatient: EncounterNoteRecord[],
  patientId: string,
  isDeleted: (id: string) => boolean = isEncounterDeleted,
): EncounterNoteRecord[] {
  if (cloudForPatient.length === 0) return inMemory;
  const memById = new Map(inMemory.map((n) => [n.id, n]));
  const replace = new Map<string, EncounterNoteRecord>();
  const added = new Map<string, EncounterNoteRecord>();
  for (const c of cloudForPatient) {
    if (c.patientId !== patientId || isDeleted(c.id)) continue;
    const mem = memById.get(c.id);
    if (!mem) added.set(c.id, c);
    else if (ts(c.updatedAt) > ts(mem.updatedAt)) replace.set(c.id, c);
  }
  if (replace.size === 0 && added.size === 0) return inMemory;
  const merged = inMemory.map((n) => replace.get(n.id) ?? n);
  return [...merged, ...added.values()].sort((l, r) => ts(r.updatedAt) - ts(l.updatedAt));
}
