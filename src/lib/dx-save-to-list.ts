/**
 * Which of the office's diagnosis folders a new code most likely belongs in,
 * from its body region. Used to preselect the folder when a code is saved to
 * the list from the patient's Diagnosis Codes search ("+ Dx Code"). Only a
 * default — the user can pick another folder before saving.
 *
 * Folders are matched by the built-in id first (folder-cervical, …), then by
 * name, so renamed or custom folders ("Neck", "Low Back") still match. When
 * nothing fits, it's General (or the first folder).
 */
import { GENERAL_DIAGNOSIS_FOLDER_ID } from "@/lib/billing-macros";

export type DxFolderRef = { id: string; name: string };

type Region = { id: string; folderName: RegExp; text: RegExp; codes: RegExp };

// Order matters: the first region whose text/code rule matches wins.
const REGIONS: Region[] = [
  {
    id: "folder-cervical",
    folderName: /cervical|neck/i,
    // "cervicothoracic" is filed with the upper region.
    text: /\b(cervical|cervicalgia|cervicothoracic|cervicocranial|cervicobrachial|neck|whiplash|occipito-atlanto-axial)\b/i,
    // M50 cervical disc, M54.2 cervicalgia, S13/S14/S16 neck sprain/strain/nerve
    codes: /^(M50|M542|S13|S14|S16)/,
  },
  {
    id: "folder-thoracic",
    folderName: /thoracic|mid[- ]?back|upper back/i,
    text: /\b(thoracic|thoracolumbar|thoracic region|mid back|rib|ribs)\b/i,
    codes: /^(M546|S23|S24|S29|S22)/,
  },
  {
    id: "folder-lumbar",
    folderName: /lumbar|low(er)? back/i,
    text: /\b(lumbar|lumbosacral|low back|lower back|sacral|sacrum|sacroiliac|sciatica|coccyx)\b/i,
    codes: /^(M543|M544|M545|S33|S34|S39|S32)/,
  },
  {
    id: "folder-shoulder",
    folderName: /shoulder/i,
    text: /\b(shoulder|rotator cuff|glenohumeral|acromioclavicular|scapula|scapular)\b/i,
    codes: /^(M75|S43|S46|S40|S42)/,
  },
  {
    id: "folder-leg-knee-foot",
    folderName: /knee|leg|foot|ankle/i,
    text: /\b(knee|leg|foot|feet|ankle|toe|toes|tibia|fibula|femur|thigh|patella|meniscus|lower limb)\b/i,
    codes: /^(M17|M22|M23|S80|S82|S83|S86|S90|S92|S93|S96)/,
  },
];

/** Folder id to preselect for a new code. */
export function guessDiagnosisFolderId(code: string, description: string, folders: DxFolderRef[]): string {
  const raw = code.replace(/[\s.]/g, "").toUpperCase();
  const general =
    folders.find((f) => f.id === GENERAL_DIAGNOSIS_FOLDER_ID) ??
    folders.find((f) => /^general$/i.test(f.name.trim())) ??
    folders[0];
  const region = REGIONS.find((r) => r.text.test(description)) ?? REGIONS.find((r) => r.codes.test(raw));
  if (region) {
    const folder = folders.find((f) => f.id === region.id) ?? folders.find((f) => region.folderName.test(f.name));
    if (folder) return folder.id;
  }
  return general?.id ?? "";
}

type LibraryDx = { id: string; code: string; folderId: string; active: boolean };
type LibraryBundle = { id: string; name: string; diagnosisIds: string[] };

/** The useBillingMacros pieces saveCodeToDiagnosisList needs (kept narrow so it's testable). */
export type DxListActions = {
  diagnoses: LibraryDx[];
  bundles: LibraryBundle[];
  folders: DxFolderRef[];
  addDiagnosis: (draft: { code: string; description: string; folderId?: string }) => { id: string | null; added: boolean };
  updateDiagnosis: (id: string, patch: { active?: boolean; folderId?: string }) => void;
  updateBundle: (id: string, patch: { diagnosisIds: string[] }) => void;
};

const codeKey = (code: string) => code.replace(/[\s.]/g, "").toUpperCase();

/**
 * Save a code to the office's diagnosis list (Settings → Diagnosis "Add a
 * code" behavior): into `folderId`, plus any chosen bundles. A code that's
 * already in the list but switched off is turned back on (in the chosen
 * folder) rather than duplicated. Never touches the patient.
 */
export function saveCodeToDiagnosisList(
  actions: DxListActions,
  entry: { code: string; description: string },
  folderId: string,
  bundleIds: string[],
): { ok: true; message: string } | { ok: false; error: string } {
  const code = entry.code.trim().toUpperCase();
  const description = entry.description.trim();
  if (!code || !description) return { ok: false, error: "Code or description is missing." };
  const folder = actions.folders.find((f) => f.id === folderId) ?? actions.folders[0];
  const folderName = folder?.name ?? "General";

  const existing = actions.diagnoses.find((d) => codeKey(d.code) === codeKey(code));
  let id: string;
  let verb: string;
  if (existing) {
    if (existing.active) return { ok: false, error: `${code} is already in your codes.` };
    actions.updateDiagnosis(existing.id, { active: true, folderId: folder?.id ?? existing.folderId });
    id = existing.id;
    verb = "turned back on in";
  } else {
    const result = actions.addDiagnosis({ code, description, folderId: folder?.id });
    if (!result.id) return { ok: false, error: "Couldn't save this code." };
    id = result.id;
    verb = "saved to";
  }

  const bundleNames: string[] = [];
  for (const bundleId of bundleIds) {
    const bundle = actions.bundles.find((b) => b.id === bundleId);
    if (!bundle) continue;
    if (!bundle.diagnosisIds.includes(id)) actions.updateBundle(bundle.id, { diagnosisIds: [...bundle.diagnosisIds, id] });
    bundleNames.push(bundle.name);
  }
  const bundleNote = bundleNames.length ? ` and ${bundleNames.map((n) => `"${n}"`).join(", ")}` : "";
  return { ok: true, message: `${code} ${verb} your codes (${folderName})${bundleNote}. Not added to this patient.` };
}
