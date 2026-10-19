/**
 * New uploads to a patient/case are named "<CASE#> <original name>",
 * e.g. "101526MANA MRI Report.pdf". Unchanged when there's no case # or
 * the name already starts with it (any case). Extension is kept as-is.
 */
export function withCaseNumberPrefix(name: string, caseNumber: string | null | undefined): string {
  const cn = (caseNumber ?? "").trim();
  const original = name.trim();
  if (!cn || !original) return name;
  if (original.toLowerCase().startsWith(cn.toLowerCase())) return name;
  return `${cn} ${original}`;
}

/** Walk up from a folder to the patient it belongs to (folders carry patientId). */
export function patientIdForFolder(
  folders: ReadonlyArray<{ id: string; parentId: string | null; patientId?: string }>,
  folderId: string,
): string | null {
  const byId = new Map(folders.map((f) => [f.id, f]));
  let cur = byId.get(folderId);
  for (let i = 0; cur && i < 50; i++) {
    if (cur.patientId) return cur.patientId;
    if (cur.id.startsWith("SYSTEM-PATIENT-") && cur.id !== "SYSTEM-PATIENT-FOLDERS-ROOT") {
      return cur.id.slice("SYSTEM-PATIENT-".length);
    }
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }
  if (folderId.startsWith("SYSTEM-PATIENT-") && folderId !== "SYSTEM-PATIENT-FOLDERS-ROOT") {
    return folderId.slice("SYSTEM-PATIENT-".length);
  }
  return null;
}
