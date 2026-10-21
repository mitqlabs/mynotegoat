/**
 * G.O.A.T. — "Suggested from X-ray" diagnosis codes (pure, no I/O).
 *
 * Mirrors the MRI suggestions (dx-suggest.ts): same engine, same rules for
 * the findings an X-ray can show (disc degeneration / disc-space narrowing,
 * spondylosis, facet arthrosis, spondylolisthesis, spondylolysis), plus the
 * X-ray-only ones: loss of lordosis and scoliosis. Shoulder and knee findings
 * (osteoarthritis, effusion) are coded only when the side is stated.
 * A fracture is never coded here (it needs site, type and the 7th-character
 * encounter); it is listed under "Not suggested" with the line.
 *
 * Every code is billable in the official FY2026 ICD-10-CM list with its exact
 * description (checked by scripts/tests/dx-suggest-xray.test.ts). Unspecified
 * codes that payers often flag (M41.9, M19.019, M17.10, M43.8X9) are avoided.
 * It only suggests; nothing is added unless the user clicks Add.
 */
import type { GoatContext } from "@/lib/goat";
import { plainText } from "@/lib/goat";
import { docUnits, isImagingReport, type GoatFile } from "@/lib/goat-docs";
import { regionsNamedIn, splitFindings } from "@/lib/goat-regions";
import { DX_RULES, type DxCode, type DxRule } from "@/lib/dx-suggest-map";
import {
  positiveMatch,
  suggestDiagnosesDetailed,
  type DxEvidence,
  type DxHeldBack,
  type DxSourceText,
  type DxSuggestion,
} from "@/lib/dx-suggest";

export type XraySuggestion = Omit<DxSuggestion, "segment"> & { segment: string };

const c = (code: string, description: string): DxCode[] => [{ code, description }];

/** MRI rules an X-ray can support (no herniation, bulge, annular tear or stenosis). */
const SHARED_IDS = ["disc-degeneration", "spondylosis", "facet-arthropathy", "spondylolisthesis", "spondylolysis"];

export const XRAY_ONLY_RULES: DxRule[] = [
  {
    id: "xray-lordosis",
    label: "Loss / reversal of lordosis",
    terms: [
      "loss of (?:the )?(?:normal )?(?:cervical |lumbar )?lordo\\w*(?: curv\\w*)?",
      "(?:decreased|diminished|reduced) (?:the )?(?:normal )?(?:cervical |lumbar )?lordo\\w*",
      "straighten\\w* of (?:the )?(?:normal )?(?:cervical |lumbar )?(?:lordo\\w*|curv\\w*|spine)",
      "(?:reversal|reversed) of (?:the )?(?:normal )?(?:cervical |lumbar )?(?:lordo\\w*|curv\\w*)",
      "reversed (?:cervical |lumbar )?lordo\\w*",
      "hypolordo\\w*",
      "kyphotic (?:reversal|angulation|curv\\w*)",
      "straightened (?:cervical |lumbar )?(?:spine|lordo\\w*|curv\\w*)",
    ],
    codes: {
      Cervical: c("M43.8X2", "Other specified deforming dorsopathies, cervical region"),
      Cervicothoracic: c("M43.8X3", "Other specified deforming dorsopathies, cervicothoracic region"),
      Thoracic: c("M43.8X4", "Other specified deforming dorsopathies, thoracic region"),
      Thoracolumbar: c("M43.8X5", "Other specified deforming dorsopathies, thoracolumbar region"),
      Lumbar: c("M43.8X6", "Other specified deforming dorsopathies, lumbar region"),
      Lumbosacral: c("M43.8X7", "Other specified deforming dorsopathies, lumbosacral region"),
    },
    why: "ICD-10-CM: loss or reversal of the normal curve is a deforming dorsopathy → M43.8X- (other specified) by region. Postural lordosis codes (M40.4-) are for an increased curve, so they don't fit.",
    others: {
      Cervical: c("M62.830", "Muscle spasm of back"),
      Thoracic: c("M62.830", "Muscle spasm of back"),
      Lumbar: c("M62.830", "Muscle spasm of back"),
      Lumbosacral: c("M62.830", "Muscle spasm of back"),
    },
    note: "After an injury, loss of lordosis is often from muscle spasm. If the exam notes spasm, M62.830 may fit better.",
  },
  {
    id: "xray-scoliosis",
    label: "Scoliosis",
    terms: ["scolio\\w*", "levoscolio\\w*", "dextroscolio\\w*", "(?:levo|dextro)[- ]?convex curv\\w*", "(?:levo|dextro)curv\\w*"],
    codes: {
      Cervical: c("M41.82", "Other forms of scoliosis, cervical region"),
      Cervicothoracic: c("M41.83", "Other forms of scoliosis, cervicothoracic region"),
      Thoracic: c("M41.84", "Other forms of scoliosis, thoracic region"),
      Thoracolumbar: c("M41.85", "Other forms of scoliosis, thoracolumbar region"),
      Lumbar: c("M41.86", "Other forms of scoliosis, lumbar region"),
      Lumbosacral: c("M41.87", "Other forms of scoliosis, lumbosacral region"),
    },
    why: "ICD-10-CM Index: Scoliosis, specified NEC → M41.8- by region. The region comes from the X-ray. M41.9 (unspecified) is avoided because payers often flag it.",
    note: "If the doctor calls it idiopathic, use M41.2- for that region instead.",
  },
];

export const XRAY_RULES: DxRule[] = [
  ...XRAY_ONLY_RULES,
  ...DX_RULES.filter((r) => SHARED_IDS.includes(r.id)),
];

// --- Shoulder / knee --------------------------------------------------------

type Joint = "Shoulder" | "Knee";
type Side = "Right" | "Left" | "Bilateral";
const OA_RE = /(?<![A-Za-z])(?:osteoarthrit\w*|arthros[ie]s|degenerative (?:joint )?(?:disease|changes?|arthritis)|djd|joint space (?:narrowing|loss)|narrowing of the (?:\w+ )?joint space|marginal osteophyt\w*|osteophyt\w*|arthropath\w*)(?![A-Za-z])/gi;
const EFFUSION_RE = /(?<![A-Za-z])(?:joint effusion|effusion|suprapatellar fluid)(?![A-Za-z])/gi;
const FRACTURE_RE = /(?<![A-Za-z])(?:fractur\w*|fx)(?![A-Za-z])/gi;
const AC_RE = /(?<![A-Za-z])(?:acromioclavicular|a\.?c\.? joint|glenohumeral)(?![A-Za-z])/i;

const JOINT_CODES: Record<Joint, Record<"oa" | "effusion", Partial<Record<Side, DxCode[]>>>> = {
  Shoulder: {
    oa: {
      Right: c("M19.011", "Primary osteoarthritis, right shoulder"),
      Left: c("M19.012", "Primary osteoarthritis, left shoulder"),
      Bilateral: [{ code: "M19.011", description: "Primary osteoarthritis, right shoulder" }, { code: "M19.012", description: "Primary osteoarthritis, left shoulder" }],
    },
    effusion: {
      Right: c("M25.411", "Effusion, right shoulder"),
      Left: c("M25.412", "Effusion, left shoulder"),
      Bilateral: [{ code: "M25.411", description: "Effusion, right shoulder" }, { code: "M25.412", description: "Effusion, left shoulder" }],
    },
  },
  Knee: {
    oa: {
      Right: c("M17.11", "Unilateral primary osteoarthritis, right knee"),
      Left: c("M17.12", "Unilateral primary osteoarthritis, left knee"),
      Bilateral: c("M17.0", "Bilateral primary osteoarthritis of knee"),
    },
    effusion: {
      Right: c("M25.461", "Effusion, right knee"),
      Left: c("M25.462", "Effusion, left knee"),
      Bilateral: [{ code: "M25.461", description: "Effusion, right knee" }, { code: "M25.462", description: "Effusion, left knee" }],
    },
  },
};

const JOINT_WHY = {
  oa: "ICD-10-CM Index: Osteoarthritis (arthrosis, degenerative joint disease) → shoulder M19.01-, knee M17.- by side. Joint-space narrowing and osteophytes are how X-rays describe it. The side comes from the X-ray.",
  effusion: "ICD-10-CM Index: Effusion, joint → M25.4- by joint and side.",
};

function sideOf(text: string): Side | null {
  const t = text.toLowerCase();
  if (/\b(?:bilateral|bilat|both|b\/l)\b/.test(t)) return "Bilateral";
  const r = /\b(?:right|rt)\b/.test(t);
  const l = /\b(?:left|lt)\b/.test(t);
  if (r && l) return "Bilateral";
  return r ? "Right" : l ? "Left" : null;
}

function jointOf(text: string): Joint | null {
  if (AC_RE.test(text)) return "Shoulder";
  const named = regionsNamedIn(text).filter((r): r is Joint => r === "Shoulder" || r === "Knee");
  return named.length === 1 ? named[0] : null;
}

const clauses = (text: string) => text.split(/(?<!\d)\.(?!\d)|;|\n/).map((s) => s.trim()).filter(Boolean);
const shortLine = (t: string) => {
  const s = t.replace(/\s+/g, " ").replace(/^\s*\(?\d{1,2}[.)]\s+/, "").trim();
  return s.length > 220 ? `${s.slice(0, 217).trimEnd()}…` : s;
};
const rawc = (code: string) => code.toUpperCase().replace(/[^A-Z0-9]/g, "");

interface Item {
  text: string;
  source: string;
  /** Heading / record context ("Left Knee"). */
  context: string;
}

function itemsOf(sources: DxSourceText[], files: GoatFile[] | null | undefined): Item[] {
  const out: Item[] = [];
  for (const src of sources) {
    for (const s of splitFindings(plainText(src.text), src.regions ?? [])) {
      for (const item of s.items) out.push({ text: item, source: src.source, context: `${s.label} ${(src.regions ?? []).join(" ")}` });
    }
  }
  for (const f of files ?? []) {
    if (f.status !== "read" || !f.pages?.length || !isXrayFile(f)) continue;
    for (const u of docUnits(f)) {
      if (u.heading || u.section === "boiler" || u.section === "header") continue;
      out.push({ text: u.text, source: `${f.name} (p. ${u.page})`, context: `${u.region ?? ""} ${f.name}` });
    }
  }
  return out;
}

const isXrayFile = (f: GoatFile) => isImagingReport(f, ["X-Ray"]) && !isImagingReport(f, ["MRI", "CT"]);

// --- Main -------------------------------------------------------------------

export interface XrayInput {
  /** X-ray findings text (Imaging panel X-ray records + the X-Ray findings box). */
  xray: DxSourceText[];
  files?: GoatFile[] | null;
  clinical: DxSourceText[];
  library: Array<{ code: string; description: string }>;
  existing: Array<{ code: string }>;
  /** Codes the MRI list already suggests (not repeated here). */
  alsoSuggested?: string[];
}

export function suggestXrayDiagnoses(input: XrayInput): { list: XraySuggestion[]; heldBack: DxHeldBack[] } {
  const spine = suggestDiagnosesDetailed({
    imaging: input.xray,
    files: input.files,
    clinical: input.clinical,
    library: input.library,
    existing: input.existing,
    rules: XRAY_RULES,
    fileKinds: ["X-Ray"],
  });
  const existing = new Set([...input.existing.map((d) => rawc(d.code)), ...(input.alsoSuggested ?? []).map(rawc)]);
  const lib = new Set(input.library.map((d) => rawc(d.code)));
  const list: XraySuggestion[] = spine.list.filter((s) => !existing.has(rawc(s.code))).map((s) => ({ ...s, why: s.why.replace(/MRI reports describe/g, "imaging reports describe") }));
  const heldBack: DxHeldBack[] = [...spine.heldBack];
  const seen = new Set(list.map((s) => rawc(s.code)));

  const joints = new Map<string, { joint: Joint; side: Side; kind: "oa" | "effusion"; evidence: DxEvidence[] }>();
  const noSide = new Map<string, DxHeldBack>();
  let fracture: DxEvidence | null = null;
  for (const it of itemsOf(input.xray, input.files)) {
    for (const clause of clauses(it.text)) {
      FRACTURE_RE.lastIndex = 0;
      if (!fracture && positiveMatch(clause, FRACTURE_RE)) fracture = { text: shortLine(it.text), source: it.source };
      const joint = jointOf(clause) ?? jointOf(it.text) ?? jointOf(it.context);
      if (!joint) continue;
      for (const kind of ["oa", "effusion"] as const) {
        const re = kind === "oa" ? OA_RE : EFFUSION_RE;
        re.lastIndex = 0;
        if (!positiveMatch(clause, re)) continue;
        const side = sideOf(clause) ?? sideOf(it.text) ?? sideOf(it.context);
        const ev = { text: shortLine(it.text), source: it.source };
        if (!side) {
          noSide.set(`${joint}-${kind}`, {
            code: joint === "Knee" ? (kind === "oa" ? "M17.-" : "M25.46-") : kind === "oa" ? "M19.01-" : "M25.41-",
            description: `${kind === "oa" ? "Osteoarthritis" : "Effusion"}, ${joint.toLowerCase()}`,
            reason: `The side isn't stated ("${shortLine(it.text).slice(0, 60)}"). Unspecified-side codes are often denied, so add the side or pick the code by hand.`,
          });
          continue;
        }
        const key = `${joint}-${side}-${kind}`;
        const cur = joints.get(key) ?? { joint, side, kind, evidence: [] };
        if (!cur.evidence.some((e) => e.text === ev.text)) cur.evidence.push(ev);
        joints.set(key, cur);
      }
    }
  }
  const hasOa = (j: Joint, s: Side) => [...joints.values()].some((x) => x.kind === "oa" && x.joint === j && (x.side === s || x.side === "Bilateral" || s === "Bilateral"));
  for (const j of joints.values()) {
    // Effusion with osteoarthritis of the same joint is part of the arthritis: not coded separately.
    if (j.kind === "effusion" && hasOa(j.joint, j.side)) continue;
    for (const code of JOINT_CODES[j.joint][j.kind][j.side] ?? []) {
      const k = rawc(code.code);
      if (existing.has(k) || seen.has(k)) continue;
      seen.add(k);
      const sideWord = code.description.match(/\b(right|left)\b/i)?.[1] ?? j.side;
      list.push({
        code: code.code,
        description: code.description,
        segment: `${sideWord[0].toUpperCase()}${sideWord.slice(1).toLowerCase()} ${j.joint}`.replace(/^Bilateral (\w+)/, "Both $1s"),
        labels: [j.kind === "oa" ? "Osteoarthritis / joint-space narrowing" : "Joint effusion"],
        evidence: j.evidence,
        inLibrary: lib.has(k),
        others: [],
        why: JOINT_WHY[j.kind],
        note: j.kind === "oa" ? "Primary osteoarthritis is the default. If the doctor says it's from this injury, post-traumatic codes (M19.11-, M17.3-) fit instead." : undefined,
      });
    }
  }
  for (const h of noSide.values()) heldBack.push(h);
  if (fracture) {
    heldBack.push({
      code: "Fracture",
      description: "Fracture on the X-ray",
      reason: `"${fracture.text.slice(0, 80)}" — ${fracture.source}. Fracture codes need the exact bone, type and visit (7th character), so code it by hand.`,
    });
  }
  return { list, heldBack };
}

/** X-ray input from the patient page's (privacy-filtered) G.O.A.T. snapshot. */
export function xrayInputFromGoat(
  ctx: Pick<GoatContext, "imaging" | "xrayFindings" | "notes" | "encounters" | "specialists" | "specialistRecommendations" | "files">,
  library: XrayInput["library"],
  existing: XrayInput["existing"],
  alsoSuggested: string[] = [],
): XrayInput {
  const xray: DxSourceText[] = [];
  for (const i of ctx.imaging) {
    if (i.refused || !/x-?ray/i.test(i.modality) || !i.findings.trim()) continue;
    xray.push({ text: i.findings, source: `X-ray findings${i.center ? ` · ${i.center}` : ""} (Imaging panel)`, regions: i.regions });
  }
  if (ctx.xrayFindings.trim() && !ctx.imaging.some((i) => /x-?ray/i.test(i.modality) && i.findings.trim() === ctx.xrayFindings.trim())) {
    xray.push({ text: ctx.xrayFindings, source: "X-Ray findings (Imaging panel)" });
  }
  const clinical: DxSourceText[] = [];
  if (ctx.notes) clinical.push({ text: ctx.notes, source: "Case notes" });
  for (const e of ctx.encounters ?? []) {
    clinical.push({ text: e.soap.subjective, source: `SOAP ${e.date} · S` });
    clinical.push({ text: e.soap.objective, source: `SOAP ${e.date} · O` });
    clinical.push({ text: e.soap.assessment, source: `SOAP ${e.date} · A` });
  }
  for (const s of ctx.specialists) if (s.recommendations.trim()) clinical.push({ text: s.recommendations, source: s.name ? `Specialist · ${s.name}` : "Specialist" });
  if (ctx.specialistRecommendations.trim()) clinical.push({ text: ctx.specialistRecommendations, source: "Specialist recommendations" });
  return { xray, files: (ctx.files ?? []).filter(isXrayFile), clinical, library, existing, alsoSuggested };
}
