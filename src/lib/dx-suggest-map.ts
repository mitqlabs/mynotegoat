/**
 * G.O.A.T. "Suggested from MRI" — which MRI/CT words suggest which ICD-10-CM
 * codes, per spinal region. EDIT THIS FILE to change the suggestions; the
 * engine is src/lib/dx-suggest.ts and the tests are
 * scripts/tests/dx-suggest.test.ts (run them after editing).
 *
 * How a rule works
 *  - `terms`: regular expressions (case-insensitive, matched as whole words)
 *    that mean the finding. Negated wording ("no disc herniation", "without
 *    stenosis", "possible …") never counts.
 *  - `codes`: what to suggest, keyed by a cervical level ("C5-C6") or a
 *    spinal segment ("Lumbar", "Lumbosacral"). A level key wins over the
 *    segment key. Lists are alternatives for the same finding: the first one
 *    already in the office's Diagnosis Code settings is used, otherwise the
 *    first one. `others` are shown as "other options" only.
 *  - `withRadiculopathy` / `withMyelopathy`: the combination code to use
 *    instead when the patient's notes support radiculopathy (or myelopathy is
 *    documented) in that region. ICD-10-CM does not allow M54.1- next to a
 *    disc (M50.1-/M51.1-) or spondylosis (M47.2-) radiculopathy code.
 *  - `superiorLevelOnly`: cervical disc codes are coded to the most superior
 *    level (ICD-10-CM note at M50), so only the highest level is suggested.
 *
 * Segments: C2-C3…C6-C7 = Cervical, C7-T1 = Cervicothoracic, T1-T2…T10-T11 =
 * Thoracic, T11-T12/T12-L1 = Thoracolumbar, L1-L2…L4-L5 = Lumbar,
 * L5-S1 = Lumbosacral.
 *
 * Codes and wording are from the FY2026 ICD-10-CM tabular list and index
 * (CMS, public domain). They are suggestions for the doctor to confirm;
 * nothing is ever added automatically.
 */

export type SpineSegment = "Cervical" | "Cervicothoracic" | "Thoracic" | "Thoracolumbar" | "Lumbar" | "Lumbosacral";
export type CervicalLevel = "C2-C3" | "C3-C4" | "C4-C5" | "C5-C6" | "C6-C7";
export type DxKey = SpineSegment | CervicalLevel;

export const SEGMENT_ORDER: SpineSegment[] = ["Cervical", "Cervicothoracic", "Thoracic", "Thoracolumbar", "Lumbar", "Lumbosacral"];

/** Which "region family" a segment belongs to, for notes like "lumbar radiculopathy". */
export const SEGMENT_FAMILY: Record<SpineSegment, "Cervical" | "Thoracic" | "Lumbar"> = {
  Cervical: "Cervical",
  Cervicothoracic: "Cervical",
  Thoracic: "Thoracic",
  Thoracolumbar: "Thoracic",
  Lumbar: "Lumbar",
  Lumbosacral: "Lumbar",
};

export interface DxCode {
  code: string;
  description: string;
}

export type DxCodeMap = Partial<Record<DxKey, DxCode[]>>;

export interface DxRule {
  id: string;
  /** Shown on the suggestion ("Disc herniation / bulge"). */
  label: string;
  terms: string[];
  codes: DxCodeMap;
  withRadiculopathy?: DxCodeMap;
  withMyelopathy?: DxCodeMap;
  /** Swap to these codes when the finding's own sentence matches `when` (e.g. bony foraminal narrowing). */
  variant?: { when: string; codes: DxCodeMap };
  /** Lumbar spinal stenosis with neurogenic claudication documented in the notes. */
  withClaudication?: DxCodeMap;
  /** Shown as "other options" (e.g. the M51.36- sixth characters). */
  others?: DxCodeMap;
  superiorLevelOnly?: boolean;
  /** A disc finding (M50/M51): combines with notes-supported radiculopathy before spondylosis does. */
  disc?: boolean;
  /** Counts as a compressive finding (lets notes-supported radiculopathy be suggested for that region). */
  compressive?: boolean;
  note?: string;
}

const c = (code: string, description: string): DxCode[] => [{ code, description }];

// --- Shared code sets -------------------------------------------------------

const DISC_WITH_RADICULOPATHY: DxCodeMap = {
  "C2-C3": c("M50.11", "Cervical disc disorder with radiculopathy, high cervical region"),
  "C3-C4": c("M50.11", "Cervical disc disorder with radiculopathy, high cervical region"),
  "C4-C5": c("M50.121", "Cervical disc disorder at C4-C5 level with radiculopathy"),
  "C5-C6": c("M50.122", "Cervical disc disorder at C5-C6 level with radiculopathy"),
  "C6-C7": c("M50.123", "Cervical disc disorder at C6-C7 level with radiculopathy"),
  Cervical: c("M50.10", "Cervical disc disorder with radiculopathy, unspecified cervical region"),
  Cervicothoracic: c("M50.13", "Cervical disc disorder with radiculopathy, cervicothoracic region"),
  Thoracic: c("M51.14", "Intervertebral disc disorders with radiculopathy, thoracic region"),
  Thoracolumbar: c("M51.15", "Intervertebral disc disorders with radiculopathy, thoracolumbar region"),
  Lumbar: c("M51.16", "Intervertebral disc disorders with radiculopathy, lumbar region"),
  Lumbosacral: c("M51.17", "Intervertebral disc disorders with radiculopathy, lumbosacral region"),
};

const DISC_WITH_MYELOPATHY: DxCodeMap = {
  "C2-C3": c("M50.01", "Cervical disc disorder with myelopathy, high cervical region"),
  "C3-C4": c("M50.01", "Cervical disc disorder with myelopathy, high cervical region"),
  "C4-C5": c("M50.021", "Cervical disc disorder at C4-C5 level with myelopathy"),
  "C5-C6": c("M50.022", "Cervical disc disorder at C5-C6 level with myelopathy"),
  "C6-C7": c("M50.023", "Cervical disc disorder at C6-C7 level with myelopathy"),
  Cervical: c("M50.00", "Cervical disc disorder with myelopathy, unspecified cervical region"),
  Cervicothoracic: c("M50.03", "Cervical disc disorder with myelopathy, cervicothoracic region"),
  Thoracic: c("M51.04", "Intervertebral disc disorders with myelopathy, thoracic region"),
  Thoracolumbar: c("M51.05", "Intervertebral disc disorders with myelopathy, thoracolumbar region"),
  Lumbar: c("M51.06", "Intervertebral disc disorders with myelopathy, lumbar region"),
};

const DISC_DEGENERATION: DxCodeMap = {
  "C2-C3": c("M50.31", "Other cervical disc degeneration, high cervical region"),
  "C3-C4": c("M50.31", "Other cervical disc degeneration, high cervical region"),
  "C4-C5": c("M50.321", "Other cervical disc degeneration at C4-C5 level"),
  "C5-C6": c("M50.322", "Other cervical disc degeneration at C5-C6 level"),
  "C6-C7": c("M50.323", "Other cervical disc degeneration at C6-C7 level"),
  Cervical: c("M50.30", "Other cervical disc degeneration, unspecified cervical region"),
  Cervicothoracic: c("M50.33", "Other cervical disc degeneration, cervicothoracic region"),
  Thoracic: c("M51.34", "Other intervertebral disc degeneration, thoracic region"),
  Thoracolumbar: c("M51.35", "Other intervertebral disc degeneration, thoracolumbar region"),
  Lumbar: c("M51.369", "Other intervertebral disc degeneration, lumbar region without mention of lumbar back pain or lower extremity pain"),
  Lumbosacral: c("M51.379", "Other intervertebral disc degeneration, lumbosacral region without mention of lumbar back pain or lower extremity pain"),
};

const DISC_DEGENERATION_OTHERS: DxCodeMap = {
  Lumbar: [
    { code: "M51.360", description: "Other intervertebral disc degeneration, lumbar region with discogenic back pain only" },
    { code: "M51.361", description: "Other intervertebral disc degeneration, lumbar region with lower extremity pain only" },
    { code: "M51.362", description: "Other intervertebral disc degeneration, lumbar region with discogenic back pain and lower extremity pain" },
  ],
  Lumbosacral: [
    { code: "M51.370", description: "Other intervertebral disc degeneration, lumbosacral region with discogenic back pain only" },
    { code: "M51.371", description: "Other intervertebral disc degeneration, lumbosacral region with lower extremity pain only" },
    { code: "M51.372", description: "Other intervertebral disc degeneration, lumbosacral region with discogenic back pain and lower extremity pain" },
  ],
};

const SPONDYLOSIS: DxCodeMap = {
  Cervical: c("M47.812", "Spondylosis without myelopathy or radiculopathy, cervical region"),
  Cervicothoracic: c("M47.813", "Spondylosis without myelopathy or radiculopathy, cervicothoracic region"),
  Thoracic: c("M47.814", "Spondylosis without myelopathy or radiculopathy, thoracic region"),
  Thoracolumbar: c("M47.815", "Spondylosis without myelopathy or radiculopathy, thoracolumbar region"),
  Lumbar: c("M47.816", "Spondylosis without myelopathy or radiculopathy, lumbar region"),
  Lumbosacral: c("M47.817", "Spondylosis without myelopathy or radiculopathy, lumbosacral region"),
};

const SPONDYLOSIS_WITH_RADICULOPATHY: DxCodeMap = {
  Cervical: c("M47.22", "Other spondylosis with radiculopathy, cervical region"),
  Cervicothoracic: c("M47.23", "Other spondylosis with radiculopathy, cervicothoracic region"),
  Thoracic: c("M47.24", "Other spondylosis with radiculopathy, thoracic region"),
  Thoracolumbar: c("M47.25", "Other spondylosis with radiculopathy, thoracolumbar region"),
  Lumbar: c("M47.26", "Other spondylosis with radiculopathy, lumbar region"),
  Lumbosacral: c("M47.27", "Other spondylosis with radiculopathy, lumbosacral region"),
};

const SPONDYLOSIS_WITH_MYELOPATHY: DxCodeMap = {
  Cervical: c("M47.12", "Other spondylosis with myelopathy, cervical region"),
  Cervicothoracic: c("M47.13", "Other spondylosis with myelopathy, cervicothoracic region"),
  Thoracic: c("M47.14", "Other spondylosis with myelopathy, thoracic region"),
  Thoracolumbar: c("M47.15", "Other spondylosis with myelopathy, thoracolumbar region"),
  Lumbar: c("M47.16", "Other spondylosis with myelopathy, lumbar region"),
};

/** Notes-supported radiculopathy with no disc/spondylosis finding to combine with. */
export const RADICULOPATHY: DxCodeMap = {
  Cervical: c("M54.12", "Radiculopathy, cervical region"),
  Cervicothoracic: c("M54.13", "Radiculopathy, cervicothoracic region"),
  Thoracic: c("M54.14", "Radiculopathy, thoracic region"),
  Thoracolumbar: c("M54.15", "Radiculopathy, thoracolumbar region"),
  Lumbar: c("M54.16", "Radiculopathy, lumbar region"),
  Lumbosacral: c("M54.17", "Radiculopathy, lumbosacral region"),
};

// --- Rules (order = display order within a region) --------------------------

export const DX_RULES: DxRule[] = [
  {
    id: "disc-displacement",
    label: "Disc herniation / protrusion / extrusion / bulge",
    terms: [
      "herniat\\w*",
      "hnp",
      "protru\\w*",
      "extru\\w*",
      "sequest\\w*",
      "bulg\\w*",
      "dis[ck] displacement",
    ],
    codes: {
      "C2-C3": c("M50.21", "Other cervical disc displacement, high cervical region"),
      "C3-C4": c("M50.21", "Other cervical disc displacement, high cervical region"),
      "C4-C5": c("M50.221", "Other cervical disc displacement at C4-C5 level"),
      "C5-C6": c("M50.222", "Other cervical disc displacement at C5-C6 level"),
      "C6-C7": c("M50.223", "Other cervical disc displacement at C6-C7 level"),
      Cervical: c("M50.20", "Other cervical disc displacement, unspecified cervical region"),
      Cervicothoracic: c("M50.23", "Other cervical disc displacement, cervicothoracic region"),
      Thoracic: c("M51.24", "Other intervertebral disc displacement, thoracic region"),
      Thoracolumbar: c("M51.25", "Other intervertebral disc displacement, thoracolumbar region"),
      Lumbar: c("M51.26", "Other intervertebral disc displacement, lumbar region"),
      Lumbosacral: c("M51.27", "Other intervertebral disc displacement, lumbosacral region"),
    },
    withRadiculopathy: DISC_WITH_RADICULOPATHY,
    withMyelopathy: DISC_WITH_MYELOPATHY,
    superiorLevelOnly: true,
    disc: true,
    compressive: true,
    note: "ICD-10-CM indexes bulging, protruding and extruded discs under disc displacement.",
  },
  {
    id: "disc-degeneration",
    label: "Degenerative disc disease / desiccation",
    terms: [
      "degenerative dis[ck] disease",
      "ddd",
      "dis[ck] degeneration",
      "degenerat\\w* (?:of )?(?:the )?(?:intervertebral )?dis[ck]s?",
      "degenerated dis[ck]s?",
      "desiccat\\w*",
      "(?:loss|decrease|reduction|narrowing) (?:of|in) (?:the )?(?:intervertebral )?dis[ck] (?:space )?height",
      "dis[ck] (?:space )?(?:height )?(?:narrowing|loss)",
    ],
    codes: DISC_DEGENERATION,
    others: DISC_DEGENERATION_OTHERS,
    withRadiculopathy: DISC_WITH_RADICULOPATHY,
    withMyelopathy: DISC_WITH_MYELOPATHY,
    superiorLevelOnly: true,
    disc: true,
    note: "Lumbar M51.36-/M51.37-: pick the back/leg pain version if the notes document it.",
  },
  {
    id: "annular-tear",
    label: "Annular tear / fissure",
    terms: ["annular (?:tear|fissure)s?", "annulus fibrosus (?:tear|fissure)s?", "tear of the annulus", "high[- ]intensity zone"],
    // ICD-10-CM index: "Tear, annular fibrosis" → disc degeneration (M51.3-).
    // M51.A- (annulus fibrosus defect) is for annular defects, typically
    // after a discectomy; add it from the ICD-10 search when it applies.
    codes: DISC_DEGENERATION,
    others: DISC_DEGENERATION_OTHERS,
    withRadiculopathy: DISC_WITH_RADICULOPATHY,
    withMyelopathy: DISC_WITH_MYELOPATHY,
    superiorLevelOnly: true,
    disc: true,
  },
  {
    id: "spinal-stenosis",
    label: "Spinal (central canal) stenosis",
    terms: [
      "(?:central|spinal|canal|thecal sac|lateral recess|subarticular)(?: canal)? (?:stenosis|narrowing)",
      "stenosis of the (?:central|spinal) canal",
      "(?:central|spinal) canal (?:is )?(?:\\w+ly )?narrowed",
      "spinal stenosis",
      "(?:central|spinal|canal)(?: canal)? and (?:\\w+ )?(?:neural )?foramin\\w* (?:stenosis|narrowing)",
      "(?<!foraminal |foramina |foramen |recess )stenosis",
    ],
    codes: {
      Cervical: [
        { code: "M48.02", description: "Spinal stenosis, cervical region" },
        { code: "M99.51", description: "Intervertebral disc stenosis of neural canal of cervical region" },
      ],
      Cervicothoracic: [
        { code: "M48.03", description: "Spinal stenosis, cervicothoracic region" },
        { code: "M99.51", description: "Intervertebral disc stenosis of neural canal of cervical region" },
      ],
      Thoracic: [
        { code: "M48.04", description: "Spinal stenosis, thoracic region" },
        { code: "M99.52", description: "Intervertebral disc stenosis of neural canal of thoracic region" },
      ],
      Thoracolumbar: [
        { code: "M48.05", description: "Spinal stenosis, thoracolumbar region" },
        { code: "M99.52", description: "Intervertebral disc stenosis of neural canal of thoracic region" },
      ],
      Lumbar: [
        { code: "M48.061", description: "Spinal stenosis, lumbar region without neurogenic claudication" },
        { code: "M99.53", description: "Intervertebral disc stenosis of neural canal of lumbar region" },
      ],
      Lumbosacral: [
        { code: "M48.07", description: "Spinal stenosis, lumbosacral region" },
        { code: "M99.53", description: "Intervertebral disc stenosis of neural canal of lumbar region" },
      ],
    },
    withClaudication: {
      Lumbar: c("M48.062", "Spinal stenosis, lumbar region with neurogenic claudication"),
    },
    compressive: true,
  },
  {
    id: "foraminal-stenosis",
    label: "Foraminal stenosis / narrowing",
    terms: [
      "(?:neural )?foramin\\w* (?:stenosis|narrowing|encroachment|compromise|impingement)",
      "(?:stenosis|narrowing|encroachment) of the (?:\\w+ )?(?:neural )?foramina?",
      "(?:neural )?foramina? (?:is |are )?(?:\\w+ly )?narrowed",
      "nfn",
    ],
    // Index: Stenosis, intervertebral foramina, disc / connective tissue → M99.7-.
    codes: {
      Cervical: c("M99.71", "Connective tissue and disc stenosis of intervertebral foramina of cervical region"),
      Cervicothoracic: c("M99.71", "Connective tissue and disc stenosis of intervertebral foramina of cervical region"),
      Thoracic: c("M99.72", "Connective tissue and disc stenosis of intervertebral foramina of thoracic region"),
      Thoracolumbar: c("M99.72", "Connective tissue and disc stenosis of intervertebral foramina of thoracic region"),
      Lumbar: c("M99.73", "Connective tissue and disc stenosis of intervertebral foramina of lumbar region"),
      Lumbosacral: c("M99.73", "Connective tissue and disc stenosis of intervertebral foramina of lumbar region"),
    },
    // …osseous (bony spur / facet / uncovertebral) → M99.6-.
    variant: {
      when: "osteophyt\\w*|spur\\w*|uncovertebral|facet\\w*|bony|osseous|hypertroph\\w*",
      codes: {
        Cervical: c("M99.61", "Osseous and subluxation stenosis of intervertebral foramina of cervical region"),
        Cervicothoracic: c("M99.61", "Osseous and subluxation stenosis of intervertebral foramina of cervical region"),
        Thoracic: c("M99.62", "Osseous and subluxation stenosis of intervertebral foramina of thoracic region"),
        Thoracolumbar: c("M99.62", "Osseous and subluxation stenosis of intervertebral foramina of thoracic region"),
        Lumbar: c("M99.63", "Osseous and subluxation stenosis of intervertebral foramina of lumbar region"),
        Lumbosacral: c("M99.63", "Osseous and subluxation stenosis of intervertebral foramina of lumbar region"),
      },
    },
    compressive: true,
  },
  {
    id: "spondylosis",
    label: "Spondylosis",
    terms: [
      "spondylos[ie]s",
      "spondylotic",
      "dis[ck][- ]osteophyte(?: complex(?:es)?)?",
      "uncovertebral (?:joint )?(?:hypertroph\\w*|arthropathy|arthrosis|spurring|osteophyt\\w*|degenerat\\w*)",
      "(?:marginal|endplate|end plate|anterior|posterior|vertebral) (?:osteophyt\\w*|spurring)",
    ],
    codes: SPONDYLOSIS,
    withRadiculopathy: SPONDYLOSIS_WITH_RADICULOPATHY,
    withMyelopathy: SPONDYLOSIS_WITH_MYELOPATHY,
  },
  {
    id: "facet-arthropathy",
    label: "Facet arthropathy",
    // Index: Arthropathy, facet joint → Spondylosis (M47.81-).
    terms: [
      "facet (?:joint )?(?:arthropathy|arthrosis|hypertroph\\w*|osteoarthritis|arthritis|degenerat\\w*|disease)",
      "hypertrophic facet\\w*",
      "facet(?: joint)? (?:and ligamentum flavum )?hypertrophy",
    ],
    codes: SPONDYLOSIS,
    withRadiculopathy: SPONDYLOSIS_WITH_RADICULOPATHY,
    withMyelopathy: SPONDYLOSIS_WITH_MYELOPATHY,
  },
  {
    id: "spondylolisthesis",
    label: "Spondylolisthesis / antero- or retrolisthesis",
    terms: ["spondylolisthesis", "anterolisthesis", "retrolisthesis", "listhesis"],
    codes: {
      Cervical: c("M43.12", "Spondylolisthesis, cervical region"),
      Cervicothoracic: c("M43.13", "Spondylolisthesis, cervicothoracic region"),
      Thoracic: c("M43.14", "Spondylolisthesis, thoracic region"),
      Thoracolumbar: c("M43.15", "Spondylolisthesis, thoracolumbar region"),
      Lumbar: c("M43.16", "Spondylolisthesis, lumbar region"),
      Lumbosacral: c("M43.17", "Spondylolisthesis, lumbosacral region"),
    },
  },
  {
    id: "spondylolysis",
    label: "Spondylolysis (pars defect)",
    terms: ["spondylolys[ie]s", "pars (?:interarticularis )?defects?", "pars defects?"],
    codes: {
      Cervical: c("M43.02", "Spondylolysis, cervical region"),
      Cervicothoracic: c("M43.03", "Spondylolysis, cervicothoracic region"),
      Thoracic: c("M43.04", "Spondylolysis, thoracic region"),
      Thoracolumbar: c("M43.05", "Spondylolysis, thoracolumbar region"),
      Lumbar: c("M43.06", "Spondylolysis, lumbar region"),
      Lumbosacral: c("M43.07", "Spondylolysis, lumbosacral region"),
    },
  },
  {
    id: "schmorl",
    label: "Schmorl's node",
    terms: ["schmorl'?s? nodes?", "schmorl'?s? nodules?"],
    codes: {
      Thoracic: c("M51.44", "Schmorl's nodes, thoracic region"),
      Thoracolumbar: c("M51.45", "Schmorl's nodes, thoracolumbar region"),
      Lumbar: c("M51.46", "Schmorl's nodes, lumbar region"),
      Lumbosacral: c("M51.47", "Schmorl's nodes, lumbosacral region"),
    },
  },
];

// --- Clinical support (read from notes, SOAP, specialist reports) ----------

/** Words in the notes that support radiculopathy. Region comes from the same sentence. */
export const RADICULOPATHY_TERMS = [
  "radiculopath\\w*",
  "radiculitis",
  "radicular",
  "sciatica",
  "radiat\\w*",
  "shooting",
  "numbness",
  "tingling",
  "paresthesi\\w*",
  "pins and needles",
];

/** Limb words that place radicular symptoms in a region. */
export const LIMB_REGION: Array<[family: "Cervical" | "Lumbar", pattern: string]> = [
  ["Cervical", "arms?|hands?|fingers?|forearms?|upper extremit\\w*|ue|shoulder blades?|elbows?|wrists?"],
  ["Lumbar", "legs?|foot|feet|toes?|thighs?|calf|calves|buttocks?|glute\\w*|lower extremit\\w*|le|sciatica|knees?"],
];

/** Words that, on their own, place radiculopathy ("lumbar radiculopathy"). */
export const MYELOPATHY_TERMS = ["myelopath\\w*"];

export const CLAUDICATION_TERMS = ["neurogenic claudication", "pseudoclaudication", "pseudo-claudication"];
