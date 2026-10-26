/**
 * New uploads to a patient/case are named "<CASE#> <Last>, <First> - <original name>",
 * e.g. "101526SMJO Smith, John - MRI Report.pdf". Unchanged when there's no
 * case # or the name already starts with it (any case). A name that already
 * starts with "Last, First" just gets the case # in front. Extension kept.
 */
export function withCaseNumberPrefix(name: string, caseNumber: string | null | undefined, fullName = ""): string {
  const cn = (caseNumber ?? "").trim();
  const original = name.trim();
  if (!cn || !original) return name;
  if (original.toLowerCase().startsWith(cn.toLowerCase())) return name;
  const [last = "", first = ""] = fullName.split(",").map((x) => x.trim());
  const who = last && first ? `${last}, ${first}` : last || first;
  if (who && original.toLowerCase().startsWith(who.toLowerCase())) {
    const rest = stripDash(original.slice(who.length));
    return rest ? `${cn} ${who} - ${rest}` : `${cn} ${who}`;
  }
  const rest = stripDash(original);
  return who ? `${cn} ${who} - ${rest}` : `${cn} - ${rest}`;
}

/** Drop leading spaces / " - " separators so the dash is never doubled. */
function stripDash(s: string): string {
  return s.replace(/^[\s\-\u2013\u2014]+/, "").trim();
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

/**
 * Split a file name into the locked auto prefix ("<CASE#> <Last>, <First> ")
 * and the editable label, using the same pieces withCaseNumberPrefix builds
 * from. Returns null when the name doesn't start with that prefix (the whole
 * name stays editable then).
 */
export function splitCaseNumberPrefix(
  name: string,
  caseNumber: string | null | undefined,
  fullName = "",
): { prefix: string; label: string } | null {
  const cn = (caseNumber ?? "").trim();
  if (!cn || !name) return null;
  const [last = "", first = ""] = fullName.split(",").map((x) => x.trim());
  const who = last && first ? `${last}, ${first}` : last || first;
  const candidates = who ? [`${cn} ${who}`, cn] : [cn];
  const lower = name.toLowerCase();
  for (const c of candidates) {
    if (!lower.startsWith(c.toLowerCase())) continue;
    const after = name.slice(c.length);
    // Must be followed by a separator (old: " ", new: " - ").
    if (!/^[\s\-\u2013\u2014]/.test(after)) continue;
    const label = stripDash(after);
    if (!label) continue;
    // Locked prefix always uses the new " - " form.
    return { prefix: `${name.slice(0, c.length)} -`, label };
  }
  return null;
}

/** Locked prefix + edited label; an empty label keeps the old name. */
export function joinCaseNumberPrefix(prefix: string, label: string): string {
  const l = stripDash(label);
  if (!l) return "";
  const p = prefix.trim().replace(/\s*[-\u2013\u2014]$/, "");
  return `${p} - ${l}`;
}
