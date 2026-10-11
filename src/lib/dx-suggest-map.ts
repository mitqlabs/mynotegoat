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
 *  - `biomechanical`: the M99.5-/M99.6-/M99.7- codes. ICD-10-CM M99 says
 *    "This category should not be used if the condition can be classified
 *    elsewhere", so they're suggested only when the office's own list uses the
 *    code AND the report's sentence ties the stenosis to its cause (`when`).
 *    Otherwise stenosis is M48.0- by region.
 *  - `why`: the "why this code" line shown on the suggestion (ICD-10-CM Index
 *    path / tabular note). Level and notes support are added to it.
 *  - Level-specific cervical codes (C4-C5, C5-C6, C6-C7, high cervical) are
 *    used only when the level is stated in that finding; otherwise the
 *    unspecified-region code.
 *  - `EXCLUDES1` (bottom): code pairs ICD-10-CM says are never coded together.
 *    Suggestions never contain such a pair, or one with a code already on
 *    the patient.
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
  /** Shown on the suggestion ("Disc herniation / protrusion"). */
  label: string;
  terms: string[];
  codes: DxCodeMap;
  /** "Why this code": the ICD-10-CM Index path / tabular note for `codes`. */
  why: string;
  withRadiculopathy?: DxCodeMap;
  withMyelopathy?: DxCodeMap;
  /**
   * M99.5-/M99.6-/M99.7- alternatives: used only if the office's list has the
   * code and the finding's own sentence matches `when` (the cause is stated).
   */
  biomechanical?: Array<{ when: string; codes: DxCodeMap; why: string }>;
  /** Lumbar spinal stenosis with neurogenic claudication documented in the notes. */
  withClaudication?: DxCodeMap;
  /** Shown as "other options" (e.g. the M51.36- sixth characters). */
  others?: DxCodeMap;
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

const DISPLACEMENT: DxCodeMap = {
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
};

const SPINAL_STENOSIS: DxCodeMap = {
  Cervical: c("M48.02", "Spinal stenosis, cervical region"),
  Cervicothoracic: c("M48.03", "Spinal stenosis, cervicothoracic region"),
  Thoracic: c("M48.04", "Spinal stenosis, thoracic region"),
  Thoracolumbar: c("M48.05", "Spinal stenosis, thoracolumbar region"),
  Lumbar: c("M48.061", "Spinal stenosis, lumbar region without neurogenic claudication"),
  Lumbosacral: c("M48.07", "Spinal stenosis, lumbosacral region"),
};

/** The cause has to be stated with a cause word ("due to", "causing"…); "with" alone doesn't count. */
const CAUSE = String.raw`(?:due to|secondary to|caused by|related to|from|causing|causes|resulting in|results in|producing|produces|which narrows)`;
const DISC_WORD = String.raw`(?:dis[ck]|herniat\w*|protru\w*|extru\w*|bulg\w*)`;
const OSSEOUS_WORD = String.raw`(?:osteophyt\w*|spur\w*|uncovertebral|facet\w*|bony|osseous|hypertroph\w*|arthropath\w*|arthros[ie]s|listhesis|spondylolisthesis|anterolisthesis)`;
const CANAL_WORD = String.raw`(?:canal|thecal sac|central) (?:stenosis|narrowing|compromise)|stenosis of the (?:central|spinal|neural) canal|(?:spinal|canal) stenosis`;
const FORAMEN_WORD = String.raw`foramin\w* (?:stenosis|narrowing|encroachment|compromise)|(?:stenosis|narrowing|encroachment) of the (?:\w+ )?(?:neural )?foramina?`;
const causedBy = (finding: string, cause: string) =>
  String.raw`(?:${finding})[^.;]{0,60}?\b${CAUSE}\b[^.;]{0,40}?${cause}|${cause}[^.;]{0,60}?\b${CAUSE}\b[^.;]{0,40}?(?:${finding})`;

export const DX_RULES: DxRule[] = [
  {
    id: "disc-displacement",
    label: "Disc herniation / protrusion / extrusion",
    terms: ["herniat\\w*", "hnp", "protru\\w*", "extru\\w*", "sequest\\w*", "dis[ck] displacement"],
    codes: DISPLACEMENT,
    why: "ICD-10-CM Index: Herniation, nucleus pulposus / Protrusion, intervertebral disc → see Displacement, intervertebral disc → M50.2- (cervical) or M51.2- (thoracic/lumbar).",
    withRadiculopathy: DISC_WITH_RADICULOPATHY,
    withMyelopathy: DISC_WITH_MYELOPATHY,
    disc: true,
    compressive: true,
  },
  {
    id: "disc-bulge",
    label: "Disc bulge",
    terms: ["bulg\\w*"],
    codes: DISPLACEMENT,
    why: "“Bulge” is not an ICD-10-CM Index term. Disc displacement (M50.2-/M51.2-) is the closest code; confirm the radiologist means a displaced disc before billing.",
    withRadiculopathy: DISC_WITH_RADICULOPATHY,
    withMyelopathy: DISC_WITH_MYELOPATHY,
    disc: true,
    compressive: true,
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
    why: "ICD-10-CM Index: Degeneration, intervertebral disc → cervical M50.3-, thoracic M51.34, lumbar M51.36-, lumbosacral M51.37-. Desiccation and disc-height loss are how MRI reports describe degeneration.",
    others: DISC_DEGENERATION_OTHERS,
    withRadiculopathy: DISC_WITH_RADICULOPATHY,
    withMyelopathy: DISC_WITH_MYELOPATHY,
    disc: true,
    note: "Lumbar M51.36-/M51.37-: the 6th character is for back/leg pain. Pick 0, 1 or 2 if the notes document it; 9 means no mention.",
  },
  {
    id: "annular-tear",
    label: "Annular tear / fissure",
    terms: ["annular (?:tear|fissure)s?", "annulus fibrosus (?:tear|fissure)s?", "tear of the annulus"],
    // Index: "Tear, annular fibrosis" → M51.35 (disc degeneration). Coded to the stated
    // thoracic/lumbar region. No cervical Index entry, so no cervical suggestion.
    // M51.A- (annulus fibrosus defect) is for post-discectomy defects ("code first" a herniation).
    codes: {
      Thoracic: DISC_DEGENERATION.Thoracic,
      Thoracolumbar: DISC_DEGENERATION.Thoracolumbar,
      Lumbar: DISC_DEGENERATION.Lumbar,
      Lumbosacral: DISC_DEGENERATION.Lumbosacral,
    },
    why: "ICD-10-CM Index: Tear, annular fibrosis → M51.35, other intervertebral disc degeneration. It's coded to the stated region (M51.3-). Cervical annular tears have no Index entry, so they aren't suggested.",
    others: DISC_DEGENERATION_OTHERS,
    withRadiculopathy: { Thoracic: DISC_WITH_RADICULOPATHY.Thoracic, Thoracolumbar: DISC_WITH_RADICULOPATHY.Thoracolumbar, Lumbar: DISC_WITH_RADICULOPATHY.Lumbar, Lumbosacral: DISC_WITH_RADICULOPATHY.Lumbosacral },
    withMyelopathy: { Thoracic: DISC_WITH_MYELOPATHY.Thoracic, Thoracolumbar: DISC_WITH_MYELOPATHY.Thoracolumbar, Lumbar: DISC_WITH_MYELOPATHY.Lumbar },
    disc: true,
    note: "Lumbar M51.36-/M51.37-: the 6th character is for back/leg pain. Pick 0, 1 or 2 if the notes document it; 9 means no mention.",
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
    codes: SPINAL_STENOSIS,
    why: "ICD-10-CM Index: Stenosis, spinal → M48.0- by region. In the lumbar region, “without neurogenic claudication” unless the notes document claudication.",
    biomechanical: [
      {
        when: causedBy(CANAL_WORD, DISC_WORD),
        codes: {
          Cervical: c("M99.51", "Intervertebral disc stenosis of neural canal of cervical region"),
          Cervicothoracic: c("M99.51", "Intervertebral disc stenosis of neural canal of cervical region"),
          Thoracic: c("M99.52", "Intervertebral disc stenosis of neural canal of thoracic region"),
          Thoracolumbar: c("M99.52", "Intervertebral disc stenosis of neural canal of thoracic region"),
          Lumbar: c("M99.53", "Intervertebral disc stenosis of neural canal of lumbar region"),
          Lumbosacral: c("M99.53", "Intervertebral disc stenosis of neural canal of lumbar region"),
        },
        why: "ICD-10-CM Index: Stenosis, neural canal, intervertebral disc → M99.5-. It's suggested because your code list uses it and the report says the disc causes the canal stenosis. M99 note: “should not be used if the condition can be classified elsewhere”, so M48.0- is the usual choice.",
      },
    ],
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
    codes: SPINAL_STENOSIS,
    why: "Foraminal narrowing is coded as spinal stenosis by region (M48.0-). The ICD-10-CM foramina codes (M99.6-/M99.7-) are suggested only when your list uses them and the report names the cause.",
    biomechanical: [
      {
        when: causedBy(FORAMEN_WORD, OSSEOUS_WORD),
        codes: {
          Cervical: c("M99.61", "Osseous and subluxation stenosis of intervertebral foramina of cervical region"),
          Cervicothoracic: c("M99.61", "Osseous and subluxation stenosis of intervertebral foramina of cervical region"),
          Thoracic: c("M99.62", "Osseous and subluxation stenosis of intervertebral foramina of thoracic region"),
          Thoracolumbar: c("M99.62", "Osseous and subluxation stenosis of intervertebral foramina of thoracic region"),
          Lumbar: c("M99.63", "Osseous and subluxation stenosis of intervertebral foramina of lumbar region"),
          Lumbosacral: c("M99.63", "Osseous and subluxation stenosis of intervertebral foramina of lumbar region"),
        },
        why: "ICD-10-CM Index: Stenosis, intervertebral foramina, osseous → M99.6-. It's suggested because your code list uses it and the report says bone (osteophyte, facet or uncovertebral) causes the narrowing. M99 note: “should not be used if the condition can be classified elsewhere.”",
      },
      {
        when: causedBy(FORAMEN_WORD, DISC_WORD),
        codes: {
          Cervical: c("M99.71", "Connective tissue and disc stenosis of intervertebral foramina of cervical region"),
          Cervicothoracic: c("M99.71", "Connective tissue and disc stenosis of intervertebral foramina of cervical region"),
          Thoracic: c("M99.72", "Connective tissue and disc stenosis of intervertebral foramina of thoracic region"),
          Thoracolumbar: c("M99.72", "Connective tissue and disc stenosis of intervertebral foramina of thoracic region"),
          Lumbar: c("M99.73", "Connective tissue and disc stenosis of intervertebral foramina of lumbar region"),
          Lumbosacral: c("M99.73", "Connective tissue and disc stenosis of intervertebral foramina of lumbar region"),
        },
        why: "ICD-10-CM Index: Stenosis, intervertebral foramina, disc → M99.7-. It's suggested because your code list uses it and the report says the disc causes the narrowing. M99 note: “should not be used if the condition can be classified elsewhere.”",
      },
    ],
    compressive: true,
  },
  {
    id: "spondylosis",
    label: "Spondylosis",
    terms: [
      "spondylos[ie]s",
      "spondylotic",
      "degenerative changes (?:of|in) the (?:cervical |thoracic |lumbar )?spine",
      "dis[ck][- ]osteophyte complex(?:es)?",
      "uncovertebral (?:joint )?(?:hypertroph\\w*|arthropathy|arthrosis|degenerat\\w*)",
    ],
    codes: SPONDYLOSIS,
    why: "ICD-10-CM Index: Spondylosis → M47.81- (without myelopathy or radiculopathy) by region. M47 includes arthrosis/osteoarthritis of the spine. A lone osteophyte isn't suggested (Index: Osteophyte, vertebrae → M25.78).",
    withRadiculopathy: SPONDYLOSIS_WITH_RADICULOPATHY,
    withMyelopathy: SPONDYLOSIS_WITH_MYELOPATHY,
  },
  {
    id: "facet-arthropathy",
    label: "Facet arthropathy",
    terms: [
      "facet (?:joint )?(?:arthropathy|arthrosis|hypertroph\\w*|osteoarthritis|arthritis|degenerat\\w*|disease)",
      "hypertrophic facet\\w*",
      "facet(?: joint)? (?:and ligamentum flavum )?hypertrophy",
    ],
    codes: SPONDYLOSIS,
    why: "ICD-10-CM Index: Arthropathy, facet joint / Hypertrophy, facet joint → M47.819, see also Spondylosis → M47.81- by region. M47 includes degeneration of facet joints.",
    withRadiculopathy: SPONDYLOSIS_WITH_RADICULOPATHY,
    withMyelopathy: SPONDYLOSIS_WITH_MYELOPATHY,
  },
  {
    id: "spondylolisthesis",
    label: "Spondylolisthesis / anterolisthesis",
    // Retrolisthesis isn't an Index term and isn't a forward slip; it isn't suggested.
    terms: ["spondylolisthesis", "anterolisthesis"],
    codes: {
      Cervical: c("M43.12", "Spondylolisthesis, cervical region"),
      Cervicothoracic: c("M43.13", "Spondylolisthesis, cervicothoracic region"),
      Thoracic: c("M43.14", "Spondylolisthesis, thoracic region"),
      Thoracolumbar: c("M43.15", "Spondylolisthesis, thoracolumbar region"),
      Lumbar: c("M43.16", "Spondylolisthesis, lumbar region"),
      Lumbosacral: c("M43.17", "Spondylolisthesis, lumbosacral region"),
    },
    why: "ICD-10-CM Index: Spondylolisthesis → M43.1- by region.",
    note: "M43.1 Excludes1: acute traumatic spondylolisthesis (lumbosacral S33.1-, other levels a vertebra fracture code) and congenital (Q76.2). If the slip is from this injury, code the injury instead.",
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
    why: "ICD-10-CM Index: Spondylolysis → M43.0- by region. Excludes1: spondylolisthesis (M43.1), so it isn't suggested with one.",
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
    why: "ICD-10-CM Index: Schmorl's disease or nodes → M51.4- by region.",
  },
];

/** "Why" lines for the codes the engine adds on top of a rule. */
export const WHY = {
  radiculopathyCombo:
    "Radiculopathy is documented in the notes (below), so the combination code is used (Index: Disorder, disc / Spondylosis, with radiculopathy). M54.1- is never added with it (Excludes1).",
  myelopathyCombo: "Myelopathy is documented (below), so the “with myelopathy” combination code is used.",
  claudication: "Neurogenic claudication is documented (below) → M48.062 (Index: Stenosis, spinal, lumbar region, with neurogenic claudication).",
  radiculopathyAlone:
    "The notes document radiculopathy (below) and the MRI shows a compressive finding in this region, but there's no disc or spondylosis code to combine it with → M54.1- by region.",
};

/**
 * ICD-10-CM Excludes1 pairs relevant to these codes (FY2026 tabular). Raw code
 * prefixes; a pair is never suggested together, and a suggestion that pairs
 * with a code already on the patient is held back with this reason.
 */
export const EXCLUDES1: Array<{ a: string; b: string; note: string }> = [
  { a: "M541", b: "M501", note: "M54.1 Excludes1: radiculopathy with cervical disc disorder (M50.1)" },
  { a: "M541", b: "M511", note: "M54.1 Excludes1: radiculopathy with lumbar and other intervertebral disc disorder (M51.1-)" },
  { a: "M541", b: "M472", note: "M54.1 Excludes1: radiculopathy with spondylosis (M47.2-)" },
  { a: "M511", b: "M543", note: "M51.1 Excludes1: sciatica NOS (M54.3)" },
  { a: "M430", b: "M431", note: "M43.0 Excludes1: spondylolysis with spondylolisthesis (M43.1)" },
  { a: "M471", b: "M433", note: "M47.1 Excludes1: vertebral subluxation (M43.3–M43.5X9)" },
  { a: "M471", b: "M434", note: "M47.1 Excludes1: vertebral subluxation (M43.3–M43.5X9)" },
  { a: "M471", b: "M435", note: "M47.1 Excludes1: vertebral subluxation (M43.3–M43.5X9)" },
  { a: "M431", b: "S331", note: "M43.1 Excludes1: acute traumatic spondylolisthesis of lumbosacral region (S33.1-)" },
  // Block M50–M54 Excludes1: current injury, see injury of spine by body region.
  { a: "M50", b: "S130", note: "M50–M54 Excludes1: current injury (traumatic rupture of cervical disc, S13.0-)" },
  { a: "M51", b: "S230", note: "M50–M54 Excludes1: current injury (traumatic rupture of thoracic disc, S23.0-)" },
  { a: "M51", b: "S330", note: "M50–M54 Excludes1: current injury (traumatic rupture of lumbar disc, S33.0-)" },
  { a: "M541", b: "S142", note: "M50–M54 Excludes1: current injury (cervical nerve root injury, S14.2-)" },
  { a: "M541", b: "S242", note: "M50–M54 Excludes1: current injury (thoracic nerve root injury, S24.2-)" },
  { a: "M541", b: "S342", note: "M50–M54 Excludes1: current injury (lumbar/sacral nerve root injury, S34.2-)" },
];

/** The Excludes1 note if two codes may not be coded together, else null. */
export function excludes1(codeA: string, codeB: string): string | null {
  const a = codeA.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const b = codeB.toUpperCase().replace(/[^A-Z0-9]/g, "");
  for (const p of EXCLUDES1) {
    if ((a.startsWith(p.a) && b.startsWith(p.b)) || (a.startsWith(p.b) && b.startsWith(p.a))) return p.note;
  }
  return null;
}

// --- Clinical support (read from notes, SOAP, specialist reports) ----------

/** Words in the notes that support radiculopathy. Region comes from the same sentence. */
// Conservative: the notes must name radiculopathy (or sciatica). Symptoms alone
// (radiating pain, numbness, tingling) are not a radiculopathy diagnosis.
export const RADICULOPATHY_TERMS = ["radiculopath\\w*", "radiculitis", "radicular", "sciatica"];

/** Limb words that place radicular symptoms in a region. */
export const LIMB_REGION: Array<[family: "Cervical" | "Lumbar", pattern: string]> = [
  ["Cervical", "arms?|hands?|fingers?|forearms?|upper extremit\\w*|ue|shoulder blades?|elbows?|wrists?"],
  ["Lumbar", "legs?|foot|feet|toes?|thighs?|calf|calves|buttocks?|glute\\w*|lower extremit\\w*|le|sciatica|knees?"],
];

/** Words that, on their own, place radiculopathy ("lumbar radiculopathy"). */
export const MYELOPATHY_TERMS = ["myelopath\\w*"];

export const CLAUDICATION_TERMS = ["neurogenic claudication", "pseudoclaudication", "pseudo-claudication"];
