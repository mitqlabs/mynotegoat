import { isBlankStarterWorkspace } from "@/lib/workspace-starter";
export interface TreatmentMacro {
  id: string;
  name: string;
  procedureCode: string;
  modifier: string;
  unitPrice: number;
  defaultUnits: number;
  active: boolean;
}

export interface DiagnosisFolder {
  id: string;
  name: string;
}

export interface TreatmentPackageItem {
  treatmentId: string;
  visits: number;
}

export interface TreatmentPackage {
  id: string;
  name: string;
  totalVisits: number;
  discountedPrice: number;
  items: TreatmentPackageItem[];
  active: boolean;
  /** Optional family / group label for two-level organization in the
   *  settings panel — e.g. family "Spinal Decompression" with tiers
   *  "Gold" / "Silver" / "Bronze". Empty / missing means the package
   *  groups under "Uncategorized". Just a string tag — no separate
   *  Family entity, so renames cascade by editing every package
   *  whose family matched. */
  family?: string;
}

export interface DiagnosisMacro {
  id: string;
  code: string;
  description: string;
  folderId: string;
  active: boolean;
}

export interface DiagnosisBundle {
  id: string;
  name: string;
  diagnosisIds: string[];
  active: boolean;
}

export interface BillingMacroLibraryConfig {
  treatments: TreatmentMacro[];
  diagnosisFolders: DiagnosisFolder[];
  diagnoses: DiagnosisMacro[];
  bundles: DiagnosisBundle[];
  packages: TreatmentPackage[];
}

const STORAGE_KEY = "casemate.billing-macros.v1";
export const GENERAL_DIAGNOSIS_FOLDER_ID = "folder-general";

function createDiagnosisFolder(id: string, name: string): DiagnosisFolder {
  return {
    id,
    name,
  };
}

function getDefaultDiagnosisFolders(): DiagnosisFolder[] {
  // New practices: just the one folder the app files unsorted codes into.
  if (isBlankStarterWorkspace()) return [createDiagnosisFolder(GENERAL_DIAGNOSIS_FOLDER_ID, "General")];
  return [
    createDiagnosisFolder(GENERAL_DIAGNOSIS_FOLDER_ID, "General"),
    createDiagnosisFolder("folder-cervical", "Cervical"),
    createDiagnosisFolder("folder-thoracic", "Thoracic"),
    createDiagnosisFolder("folder-lumbar", "Lumbar"),
    createDiagnosisFolder("folder-shoulder", "Shoulder"),
    createDiagnosisFolder("folder-leg-knee-foot", "Leg/Knee/Foot"),
    createDiagnosisFolder("folder-misc", "Misc."),
  ];
}

function inferDiagnosisFolderId(id: string) {
  const normalized = id.toLowerCase();
  if (normalized.includes("cervical")) {
    return "folder-cervical";
  }
  if (normalized.includes("thoracic")) {
    return "folder-thoracic";
  }
  if (
    normalized.includes("lumbar") ||
    normalized.includes("lumbosacral") ||
    normalized.includes("sciatica") ||
    normalized.includes("back-")
  ) {
    return "folder-lumbar";
  }
  if (normalized.includes("shoulder")) {
    return "folder-shoulder";
  }
  if (
    normalized.includes("knee") ||
    normalized.includes("foot") ||
    normalized.includes("ankle") ||
    normalized.includes("femur") ||
    normalized.includes("tib") ||
    normalized.includes("leg") ||
    normalized.includes("acl") ||
    normalized.includes("pcl")
  ) {
    return "folder-leg-knee-foot";
  }
  if (
    normalized.includes("mva") ||
    normalized.includes("concussion") ||
    normalized.includes("headache") ||
    normalized.includes("dizziness") ||
    normalized.includes("sleep") ||
    normalized.includes("tinnitus")
  ) {
    return "folder-misc";
  }
  return GENERAL_DIAGNOSIS_FOLDER_ID;
}

function createTreatment(
  id: string,
  name: string,
  procedureCode: string,
  unitPrice: number,
  defaultUnits: number,
): TreatmentMacro {
  return {
    id,
    name,
    procedureCode,
    modifier: "",
    unitPrice,
    defaultUnits,
    active: true,
  };
}

function createDiagnosis(
  id: string,
  code: string,
  description: string,
  folderId = inferDiagnosisFolderId(id),
): DiagnosisMacro {
  return {
    id,
    code,
    description,
    folderId,
    active: true,
  };
}

function createBundle(id: string, name: string, diagnosisIds: string[]): DiagnosisBundle {
  return {
    id,
    name,
    diagnosisIds,
    active: true,
  };
}

export function getDefaultBillingMacroLibrary(): BillingMacroLibraryConfig {
  // New practices start with no charges, prices, saved Dx codes or bundles.
  // (The full official ICD-10 search stays available everywhere.)
  if (isBlankStarterWorkspace()) {
    return {
      treatments: [],
      diagnosisFolders: getDefaultDiagnosisFolders(),
      diagnoses: [],
      bundles: [],
      packages: [],
    };
  }
  const diagnoses = [
    createDiagnosis("dx-cervical-sprain", "S13.4XXA", "Sprain of ligaments of cervical spine, initial encounter"),
    createDiagnosis("dx-cervical-strain", "S16.1XXA", "Strain of muscle, fascia and tendon at neck level, initial encounter"),
    createDiagnosis("dx-cervical-spondylolysis", "M43.02", "Spondylolysis, cervical region"),
    createDiagnosis("dx-cervical-spondylolisthesis", "M43.12", "Spondylolisthesis, cervical region"),
    createDiagnosis("dx-cervical-disc-displacement", "M50.20", "Other cervical disc displacement, unspecified cervical region"),
    createDiagnosis("dx-cervical-disc-radiculopathy", "M50.10", "Cervical disc disorder with radiculopathy, unspecified cervical region"),
    createDiagnosis("dx-cervicothoracic-disc-disorder", "M50.93", "Cervical disc disorder, unspecified, cervicothoracic region"),
    createDiagnosis("dx-cervical-dorsopathy", "M53.82", "Other specified dorsopathies, cervical region"),
    createDiagnosis("dx-cervical-rad", "M54.12", "Radiculopathy, cervical region"),
    createDiagnosis("dx-cervical-pain", "M54.2", "Cervicalgia"),
    createDiagnosis("dx-cervical-segmental-dysfunction", "M99.01", "Segmental and somatic dysfunction of cervical region"),
    createDiagnosis("dx-cervical-neural-stenosis", "M99.51", "Intervertebral disc stenosis of neural canal of cervical region"),

    createDiagnosis("dx-thoracic-strain", "S29.012A", "Strain of muscle and tendon of back wall of thorax, initial encounter"),
    createDiagnosis("dx-thoracic-sprain", "S23.3XXA", "Sprain of ligaments of thoracic spine, initial encounter"),
    createDiagnosis("dx-thoracic-pain", "M54.6", "Pain in thoracic spine"),
    createDiagnosis("dx-thoracic-spondylolysis", "M43.04", "Spondylolysis, thoracic region"),
    createDiagnosis("dx-thoracic-spondylolisthesis", "M43.14", "Spondylolisthesis, thoracic region"),
    createDiagnosis("dx-thoracic-segmental-dysfunction", "M99.02", "Segmental and somatic dysfunction of thoracic region"),
    createDiagnosis("dx-thoracic-osseous-stenosis", "M99.32", "Osseous stenosis of neural canal of thoracic region"),
    createDiagnosis("dx-thoracic-disc-stenosis", "M99.52", "Intervertebral disc stenosis of neural canal of thoracic region"),

    createDiagnosis("dx-lumbar-sprain", "S33.5XXA", "Sprain of ligaments of lumbar spine, initial encounter"),
    createDiagnosis("dx-lumbar-strain", "S39.012A", "Strain of muscle, fascia and tendon of lower back, initial encounter"),
    createDiagnosis("dx-lumbar-spondylolysis", "M43.06", "Spondylolysis, lumbar region"),
    createDiagnosis("dx-lumbar-spondylolisthesis", "M43.16", "Spondylolisthesis, lumbar region"),
    createDiagnosis("dx-lumbar-annulus-defect", "M51.A0", "Intervertebral annulus fibrosus defect, lumbar region, unspecified size"),
    createDiagnosis("dx-lumbosacral-annulus-defect", "M51.A3", "Intervertebral annulus fibrosus defect, lumbosacral region, unspecified size"),
    createDiagnosis("dx-lumbar-disc-radiculopathy", "M51.16", "Intervertebral disc disorders with radiculopathy, lumbar region"),
    createDiagnosis("dx-lumbosacral-disc-radiculopathy", "M51.17", "Intervertebral disc disorders with radiculopathy, lumbosacral region"),
    createDiagnosis("dx-lumbar-disc-displacement", "M51.26", "Other intervertebral disc displacement, lumbar region"),
    createDiagnosis("dx-lumbar-dorsopathy", "M53.86", "Other specified dorsopathies, lumbar region"),
    createDiagnosis("dx-lumbar-rad", "M54.16", "Radiculopathy, lumbar region"),
    createDiagnosis("dx-sciatica-unspecified", "M54.30", "Sciatica, unspecified side"),
    createDiagnosis("dx-lumbar-pain", "M54.50", "Low back pain, unspecified"),
    createDiagnosis("dx-back-muscle-spasm", "M62.830", "Muscle spasm of back"),
    createDiagnosis("dx-lumbar-segmental-dysfunction", "M99.03", "Segmental and somatic dysfunction of lumbar region"),
    createDiagnosis("dx-lumbar-osseous-stenosis", "M99.33", "Osseous stenosis of neural canal of lumbar region"),
    createDiagnosis("dx-lumbar-disc-stenosis", "M99.53", "Intervertebral disc stenosis of neural canal of lumbar region"),

    createDiagnosis("dx-right-shoulder-sprain", "S43.401A", "Unspecified sprain of right shoulder joint, initial encounter"),
    createDiagnosis("dx-right-shoulder-pain", "M25.511", "Pain in right shoulder"),
    createDiagnosis("dx-right-bicipital-tendinitis", "M75.21", "Bicipital tendinitis, right shoulder"),
    createDiagnosis("dx-right-rotator-cuff-tear", "M75.111", "Incomplete rotator cuff tear or rupture of right shoulder, not specified as traumatic"),
    createDiagnosis("dx-right-shoulder-bursitis", "M75.51", "Bursitis of right shoulder"),
    createDiagnosis("dx-right-labrum-lesion", "S43.431A", "Superior glenoid labrum lesion of right shoulder, initial encounter"),
    createDiagnosis("dx-right-shoulder-bone-density-disorder", "M85.811", "Other specified disorders of bone density and structure, right shoulder"),
    createDiagnosis("dx-right-other-shoulder-lesion", "M75.81", "Other shoulder lesions, right shoulder"),
    createDiagnosis("dx-left-shoulder-sprain", "S43.402A", "Unspecified sprain of left shoulder joint, initial encounter"),
    createDiagnosis("dx-left-shoulder-pain", "M25.512", "Pain in left shoulder"),
    createDiagnosis("dx-left-bicipital-tendinitis", "M75.22", "Bicipital tendinitis, left shoulder"),
    createDiagnosis("dx-left-rotator-cuff-tear", "M75.112", "Incomplete rotator cuff tear or rupture of left shoulder, not specified as traumatic"),
    createDiagnosis("dx-left-shoulder-bursitis", "M75.52", "Bursitis of left shoulder"),
    createDiagnosis("dx-left-labrum-lesion", "S43.432A", "Superior glenoid labrum lesion of left shoulder, initial encounter"),
    createDiagnosis("dx-left-shoulder-bone-density-disorder", "M85.812", "Other specified disorders of bone density and structure, left shoulder"),
    createDiagnosis("dx-left-other-shoulder-lesion", "M75.82", "Other shoulder lesions, left shoulder"),

    createDiagnosis("dx-right-knee-pain", "M25.561", "Pain in right knee"),
    createDiagnosis("dx-right-acl-sprain", "S83.511A", "Sprain of anterior cruciate ligament of right knee, initial encounter"),
    createDiagnosis("dx-right-pcl-sprain", "S83.521A", "Sprain of posterior cruciate ligament of right knee, initial encounter"),
    createDiagnosis("dx-right-knee-effusion", "M25.461", "Effusion, right knee"),
    createDiagnosis("dx-right-knee-chondromalacia", "M94.261", "Chondromalacia, right knee"),
    createDiagnosis("dx-right-foot-pain", "M79.671", "Pain in right foot"),
    createDiagnosis("dx-right-foot-contusion", "S90.31XA", "Contusion of right foot, initial encounter"),
    createDiagnosis("dx-right-ankle-foot-pain", "M25.571", "Pain in right ankle and joints of right foot"),
    createDiagnosis("dx-left-knee-pain", "M25.562", "Pain in left knee"),
    createDiagnosis("dx-left-acl-sprain", "S83.512A", "Sprain of anterior cruciate ligament of left knee, initial encounter"),
    createDiagnosis("dx-left-knee-effusion", "M25.462", "Effusion, left knee"),
    createDiagnosis("dx-left-knee-chondromalacia", "M94.262", "Chondromalacia, left knee"),
    createDiagnosis("dx-left-foot-pain", "M79.672", "Pain in left foot"),
    createDiagnosis("dx-left-foot-contusion", "S90.32XA", "Contusion of left foot, initial encounter"),
    createDiagnosis("dx-left-ankle-foot-pain", "M25.572", "Pain in left ankle and joints of left foot"),

    createDiagnosis("dx-mva-driver-collision", "V43.52XA", "Car driver injured in collision with other type car in traffic accident, initial encounter"),
    createDiagnosis("dx-mva-passenger-collision", "V43.62XA", "Car passenger injured in collision with other type car in traffic accident, initial encounter"),
    createDiagnosis("dx-post-traumatic-headache", "G44.309", "Post-traumatic headache, unspecified, not intractable"),
    createDiagnosis("dx-sleep-disorder", "G47.9", "Sleep disorder, unspecified"),
    createDiagnosis("dx-tinnitus", "H93.19", "Tinnitus, unspecified ear"),
    createDiagnosis("dx-dizziness", "R42", "Dizziness and giddiness"),
    createDiagnosis("dx-concussion-without-loc", "S06.0X0A", "Concussion without loss of consciousness, initial encounter"),
    createDiagnosis("dx-concussion-with-loc", "S06.0X9A", "Concussion with loss of consciousness of unspecified duration, initial encounter"),
  ];

  return {
    treatments: [
      createTreatment("tx-cmt12", "CMT 1-2", "98940", 85, 1),
      createTreatment("tx-cmt34", "CMT 3-4", "98941", 95, 1),
      createTreatment("tx-ems", "Electrical Muscle Stimulation", "97014", 35, 1),
      createTreatment("tx-ultrasound", "Ultrasound", "97035", 50, 1),
      createTreatment("tx-traction", "Mechanical Traction", "97012", 45, 1),
      createTreatment("tx-decompression", "Spinal Decompression", "S9090", 250, 1),
    ],
    diagnosisFolders: getDefaultDiagnosisFolders(),
    diagnoses,
    bundles: [
      createBundle("bundle-cervical", "Cervical PI Bundle", [
        "dx-cervical-sprain",
        "dx-cervical-strain",
        "dx-cervical-disc-radiculopathy",
        "dx-cervical-disc-displacement",
        "dx-cervical-rad",
        "dx-cervical-pain",
        "dx-cervical-segmental-dysfunction",
      ]),
      createBundle("bundle-thoracic", "Thoracic PI Bundle", [
        "dx-thoracic-sprain",
        "dx-thoracic-strain",
        "dx-thoracic-pain",
        "dx-thoracic-segmental-dysfunction",
      ]),
      createBundle("bundle-lumbar", "Lumbar PI Bundle", [
        "dx-lumbar-sprain",
        "dx-lumbar-strain",
        "dx-lumbar-disc-radiculopathy",
        "dx-lumbosacral-disc-radiculopathy",
        "dx-lumbar-rad",
        "dx-lumbar-pain",
        "dx-lumbar-segmental-dysfunction",
      ]),
      createBundle("bundle-right-shoulder", "Right Shoulder Bundle", [
        "dx-right-shoulder-sprain",
        "dx-right-shoulder-pain",
        "dx-right-bicipital-tendinitis",
        "dx-right-rotator-cuff-tear",
      ]),
      createBundle("bundle-left-shoulder", "Left Shoulder Bundle", [
        "dx-left-shoulder-sprain",
        "dx-left-shoulder-pain",
        "dx-left-bicipital-tendinitis",
        "dx-left-rotator-cuff-tear",
      ]),
      createBundle("bundle-right-leg-knee-foot", "Right Leg/Knee/Foot Bundle", [
        "dx-right-knee-pain",
        "dx-right-acl-sprain",
        "dx-right-knee-effusion",
        "dx-right-ankle-foot-pain",
        "dx-right-foot-pain",
      ]),
      createBundle("bundle-left-leg-knee-foot", "Left Leg/Knee/Foot Bundle", [
        "dx-left-knee-pain",
        "dx-left-acl-sprain",
        "dx-left-knee-effusion",
        "dx-left-ankle-foot-pain",
        "dx-left-foot-pain",
      ]),
      createBundle("bundle-mva-misc", "MVC / Misc Bundle", [
        "dx-mva-driver-collision",
        "dx-mva-passenger-collision",
        "dx-post-traumatic-headache",
        "dx-dizziness",
        "dx-concussion-without-loc",
      ]),
    ],
    packages: [],
  };
}

function normalizeNumber(value: unknown, fallback: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return value;
}

function normalizeString(value: unknown) {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim();
}

function normalizeTreatment(value: unknown): TreatmentMacro | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const row = value as Partial<TreatmentMacro>;
  const id = normalizeString(row.id);
  const name = normalizeString(row.name);
  const procedureCode = normalizeString(row.procedureCode);
  if (!id || !name || !procedureCode) {
    return null;
  }
  return {
    id,
    name,
    procedureCode,
    modifier: normalizeString(row.modifier),
    unitPrice: normalizeNumber(row.unitPrice, 0),
    defaultUnits: Math.max(1, Math.round(normalizeNumber(row.defaultUnits, 1))),
    active: row.active !== false,
  };
}

function normalizeDiagnosis(value: unknown): DiagnosisMacro | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const row = value as Partial<DiagnosisMacro>;
  const id = normalizeString(row.id);
  const code = normalizeString(row.code);
  const description = normalizeString(row.description);
  if (!id || !code || !description) {
    return null;
  }
  return {
    id,
    code,
    description,
    folderId: normalizeString(row.folderId) || inferDiagnosisFolderId(id),
    active: row.active !== false,
  };
}

function normalizeDiagnosisFolder(value: unknown): DiagnosisFolder | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const row = value as Partial<DiagnosisFolder>;
  const id = normalizeString(row.id);
  const name = normalizeString(row.name);
  if (!id || !name) {
    return null;
  }
  return {
    id,
    name,
  };
}

function normalizeBundle(value: unknown, validDiagnosisIds: Set<string>): DiagnosisBundle | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const row = value as Partial<DiagnosisBundle>;
  const id = normalizeString(row.id);
  const name = normalizeString(row.name);
  if (!id || !name) {
    return null;
  }

  const diagnosisIds = Array.isArray(row.diagnosisIds)
    ? Array.from(
        new Set(
          row.diagnosisIds
            .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
            .filter((entry) => entry && validDiagnosisIds.has(entry)),
        ),
      )
    : [];

  return {
    id,
    name,
    diagnosisIds,
    active: row.active !== false,
  };
}

function normalizePackageItem(value: unknown, validTreatmentIds: Set<string>): TreatmentPackageItem | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const row = value as Partial<TreatmentPackageItem>;
  const treatmentId = normalizeString(row.treatmentId);
  if (!treatmentId || !validTreatmentIds.has(treatmentId)) {
    return null;
  }
  return {
    treatmentId,
    visits: Math.max(1, Math.round(normalizeNumber(row.visits, 1))),
  };
}

function normalizePackage(value: unknown, validTreatmentIds: Set<string>): TreatmentPackage | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const row = value as Partial<TreatmentPackage>;
  const id = normalizeString(row.id);
  const name = normalizeString(row.name);
  if (!id || !name) {
    return null;
  }

  const items = Array.isArray(row.items)
    ? row.items
        .map((entry) => normalizePackageItem(entry, validTreatmentIds))
        .filter((entry): entry is TreatmentPackageItem => Boolean(entry))
    : [];

  const dedupedItems = Array.from(
    new Map(items.map((entry) => [entry.treatmentId, entry] as const)).values(),
  );

  const family = normalizeString(row.family);

  return {
    id,
    name,
    totalVisits: Math.max(1, Math.round(normalizeNumber(row.totalVisits, 1))),
    discountedPrice: Math.max(0, normalizeNumber(row.discountedPrice, 0)),
    items: dedupedItems,
    active: row.active !== false,
    ...(family ? { family } : {}),
  };
}

export function normalizeBillingMacroLibrary(value: unknown): BillingMacroLibraryConfig {
  const defaults = getDefaultBillingMacroLibrary();
  if (!value || typeof value !== "object") {
    return defaults;
  }

  const row = value as Partial<BillingMacroLibraryConfig>;
  const defaultDiagnosisFolders = getDefaultDiagnosisFolders();
  const diagnosisFolders = Array.isArray(row.diagnosisFolders)
    ? row.diagnosisFolders
        .map(normalizeDiagnosisFolder)
        .filter((entry): entry is DiagnosisFolder => Boolean(entry))
    : [];
  const mergedDiagnosisFolders = diagnosisFolders.length
    ? [...diagnosisFolders]
    : [...defaultDiagnosisFolders];
  if (
    !mergedDiagnosisFolders.some(
      (entry) => entry.id === GENERAL_DIAGNOSIS_FOLDER_ID,
    )
  ) {
    mergedDiagnosisFolders.unshift(createDiagnosisFolder(GENERAL_DIAGNOSIS_FOLDER_ID, "General"));
  }
  const validFolderIds = new Set(mergedDiagnosisFolders.map((entry) => entry.id));

  const treatments = Array.isArray(row.treatments)
    ? row.treatments.map(normalizeTreatment).filter((entry): entry is TreatmentMacro => Boolean(entry))
    : [];
  const diagnoses = Array.isArray(row.diagnoses)
    ? row.diagnoses
        .map(normalizeDiagnosis)
        .filter((entry): entry is DiagnosisMacro => Boolean(entry))
        .map((entry) => ({
          ...entry,
          folderId: validFolderIds.has(entry.folderId) ? entry.folderId : GENERAL_DIAGNOSIS_FOLDER_ID,
        }))
    : [];

  const mergedDiagnoses = diagnoses.length
    ? [...diagnoses]
    : [...defaults.diagnoses];

  if (diagnoses.length) {
    const diagnosisCodeSet = new Set(diagnoses.map((entry) => entry.code.toLowerCase()));
    defaults.diagnoses.forEach((entry) => {
      if (!diagnosisCodeSet.has(entry.code.toLowerCase())) {
        mergedDiagnoses.push(entry);
      }
    });
  }
  const normalizedMergedDiagnoses = mergedDiagnoses.map((entry) => ({
    ...entry,
    folderId: validFolderIds.has(entry.folderId) ? entry.folderId : GENERAL_DIAGNOSIS_FOLDER_ID,
  }));

  const validDiagnosisIds = new Set(normalizedMergedDiagnoses.map((entry) => entry.id));
  const bundles = Array.isArray(row.bundles)
    ? row.bundles
        .map((entry) => normalizeBundle(entry, validDiagnosisIds))
        .filter((entry): entry is DiagnosisBundle => Boolean(entry))
    : [];

  const validTreatmentIds = new Set(
    (treatments.length ? treatments : defaults.treatments).map((entry) => entry.id),
  );
  const packages = Array.isArray(row.packages)
    ? row.packages
        .map((entry) => normalizePackage(entry, validTreatmentIds))
        .filter((entry): entry is TreatmentPackage => Boolean(entry))
    : [];

  return {
    treatments: treatments.length ? treatments : defaults.treatments,
    diagnosisFolders: mergedDiagnosisFolders,
    diagnoses: normalizedMergedDiagnoses,
    bundles: bundles.length ? bundles : defaults.bundles,
    packages,
  };
}

export function loadBillingMacroLibrary(): BillingMacroLibraryConfig {
  if (typeof window === "undefined") {
    return getDefaultBillingMacroLibrary();
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return getDefaultBillingMacroLibrary();
    }
    return normalizeBillingMacroLibrary(JSON.parse(raw));
  } catch {
    return getDefaultBillingMacroLibrary();
  }
}

export function saveBillingMacroLibrary(config: BillingMacroLibraryConfig) {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  void import("@/lib/kv-cloud").then((m) => m.dualWriteKv(STORAGE_KEY, "macros", config));
}
