/**
 * G.O.A.T. Dx suggestion "Ignore" (Diagnosis Codes box, MRI and X-ray lists).
 * An ignored suggestion stops showing for that patient on every device; it
 * is not deleted, and "Show ignored" can restore it (ignored:false, newer stamp).
 *
 * Stored in the cloud (workspace_kv) as [{ id, ignored, by, updatedAt }] so the
 * boot merge (kv-merge unionMerge, UNION_MERGE_KEYS) keeps both sides per id,
 * newest wins. Same pattern as cleared-tasks.ts. localStorage is only a cache.
 *
 * Id: "<patientId>|<mri|xray>|<code>" — ignoring a code from the X-ray list
 * doesn't hide it from the MRI list (and vice versa).
 */
import { unionMerge } from "@/lib/kv-merge";
import { diagnosisCodeKey } from "@/lib/patient-diagnoses";

export const DX_IGNORES_KEY = "casemate.dx-suggestion-ignores.v1";

export type DxSuggestSource = "mri" | "xray";

export interface DxIgnoreRecord {
  id: string;
  ignored: boolean;
  by: string;
  updatedAt: string;
  /** Code — description, for the "Show ignored" list. */
  label?: string;
}

export const dxIgnoreId = (patientId: string, source: DxSuggestSource, code: string) => `${patientId}|${source}|${diagnosisCodeKey(code)}`;

function normalize(v: unknown): DxIgnoreRecord[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((r): r is DxIgnoreRecord => !!r && typeof r === "object" && typeof (r as DxIgnoreRecord).id === "string")
    .map((r) => ({
      id: r.id,
      ignored: r.ignored !== false,
      by: typeof r.by === "string" ? r.by : "",
      updatedAt: typeof r.updatedAt === "string" ? r.updatedAt : "",
      ...(typeof r.label === "string" && r.label ? { label: r.label } : {}),
    }));
}

export function loadDxIgnores(): DxIgnoreRecord[] {
  if (typeof window === "undefined") return [];
  try {
    return normalize(JSON.parse(window.localStorage.getItem(DX_IGNORES_KEY) ?? "[]"));
  } catch {
    return [];
  }
}

/** Pure: set one id ignored / restored. */
export function setDxIgnored(records: DxIgnoreRecord[], id: string, ignored: boolean, by: string, now: string, label?: string): DxIgnoreRecord[] {
  const rest = records.filter((r) => r.id !== id);
  const prev = records.find((r) => r.id === id);
  const keepLabel = label ?? prev?.label;
  return [...rest, { id, ignored, by, updatedAt: now, ...(keepLabel ? { label: keepLabel } : {}) }];
}

export function mergeDxIgnores(local: DxIgnoreRecord[], cloud: unknown): DxIgnoreRecord[] {
  return normalize(unionMerge(local, normalize(cloud)));
}

/** Save locally, then merge with the cloud copy before writing it (never drops another device's ignores). */
export async function saveDxIgnores(records: DxIgnoreRecord[]): Promise<void> {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(DX_IGNORES_KEY, JSON.stringify(records));
  } catch {
    // Cache only; the cloud write below is the record.
  }
  try {
    const kv = await import("@/lib/kv-cloud");
    const remote = await kv.fetchKvValue<unknown>(DX_IGNORES_KEY).catch(() => null);
    const merged = mergeDxIgnores(records, remote);
    try {
      window.localStorage.setItem(DX_IGNORES_KEY, JSON.stringify(merged));
    } catch {
      /* cache only */
    }
    await kv.dualWriteKv(DX_IGNORES_KEY, "billing", merged);
  } catch {
    // Local copy stands; the boot merge reconciles later.
  }
}
