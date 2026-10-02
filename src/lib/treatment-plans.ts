/**
 * Per-patient treatment plans.
 *
 * A plan covers a date range and says, for each weekday, which regions get
 * which treatments. A "region" is a Plan-section macro (configured in
 * Settings → Macros → Treatment Plan Settings); "treatments" are that
 * macro's charge-linked "Treatments Performed" options. On an encounter
 * inside the range, the matching weekday's regions auto-apply into the Plan
 * section (text + charges).
 *
 * One blob per workspace, dual-written to the "billing" KV namespace.
 */

const STORAGE_KEY = "casemate.treatment-plans.v1";
export const STORAGE_KEY_TREATMENT_PLANS = STORAGE_KEY;

export interface WeekdayRegion {
  /** The region's Plan-section macro id. */
  macroId: string;
  /** Selected "Treatments Performed" option labels for this region/day. */
  treatments: string[];
  /**
   * Pre-picked answers to the macro's OTHER options-questions (e.g. a
   * Left/Right laterality picker), keyed by question id → selected option
   * labels. The charge-linked treatments question stays in `treatments`;
   * everything else lives here so auto-apply fills the note completely.
   */
  answers?: Record<string, string[]>;
  /**
   * Treatments that apply to ONE side only. `treatments` above stays the
   * shared list — what's done to both sides (or to a region with no sides
   * at all). A day can therefore say "EMS and LLLT to both knees, plus
   * shockwave to the right one" without repeating the region.
   *
   * Absent on every plan written before per-side existed, which is the
   * same as "nothing side-specific" — those plans behave exactly as they
   * always did.
   */
  sideTreatments?: { left: string[]; right: string[] };
}

/**
 * Spinal Decompression weight progression. One config per plan (applies to the
 * whole decompression macro, not per region). The weight steps up by `increase`
 * each decompression visit, starting from `startWeight` — e.g. start 12,
 * increase 2 → 12, 14, 16 … on successive covered encounters. `cycles` is a
 * static per-session value printed alongside the weight. All stored as the
 * user-typed strings so blanks/partial entry don't get coerced to 0.
 */
export interface DecompressionProgression {
  startWeight: string;
  increase: string;
  cycles: string;
  /** Cap — the stepped weight never exceeds this (e.g. start 12, increase 2,
   *  max 20 → 12, 14, 16, 18, 20, 20 …). Blank = no cap. */
  maxWeight?: string;
  /**
   * The decompression region — macro id + picked segment/program answers —
   * configured ONCE per plan and auto-applied to every encounter in the plan's
   * date range (not tied to weekdays, unlike the per-day `days` regions). The
   * charge-linked "Disc Level / segment" question lives in `treatments`; the
   * program (and any other options-questions) live in `answers`.
   */
  region?: WeekdayRegion;
}

export interface TreatmentPlan {
  id: string;
  patientId: string;
  /** US MM/DD/YYYY (inclusive). */
  startDate: string;
  endDate: string;
  /** weekday 0=Sunday … 6=Saturday → the regions applied that day. */
  days: Record<number, WeekdayRegion[]>;
  /** Spinal Decompression weight progression (optional; see type). */
  decompression?: DecompressionProgression;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Detect the Spinal Decompression macro by its button name — the weight-
 *  progression feature keys off this (the macro itself is user data). */
export function isDecompressionMacroName(name: string): boolean {
  return /decompress/i.test(name);
}

/**
 * Stepped weight for a decompression visit. `visitIndex` is 0-based (first
 * covered encounter = 0 → startWeight). Returns null when no usable start
 * weight is configured.
 */
export function computeDecompressionWeight(
  config: DecompressionProgression | undefined,
  visitIndex: number,
): number | null {
  if (!config) return null;
  const start = Number(config.startWeight);
  if (!Number.isFinite(start) || config.startWeight.trim() === "") return null;
  const incRaw = Number(config.increase);
  const increase = Number.isFinite(incRaw) ? incRaw : 0;
  let weight = start + increase * Math.max(0, visitIndex);
  const max = Number(config.maxWeight);
  if ((config.maxWeight ?? "").trim() !== "" && Number.isFinite(max)) {
    weight = Math.min(weight, max);
  }
  return weight;
}

export type TreatmentPlansByPatient = Record<string, TreatmentPlan[]>;

export function createTreatmentPlanId(): string {
  return `TP-${Date.now()}-${Math.floor(Math.random() * 1000)
    .toString()
    .padStart(3, "0")}`;
}

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of value) {
    const t = normalizeText(v);
    if (t && !seen.has(t)) {
      seen.add(t);
      out.push(t);
    }
  }
  return out;
}

function normalizeAnswers(value: unknown): Record<string, string[]> | undefined {
  if (!value || typeof value !== "object") return undefined;
  const out: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    const key = normalizeText(k);
    if (!key) continue;
    const arr = normalizeStringArray(v);
    if (arr.length) out[key] = arr;
  }
  return Object.keys(out).length ? out : undefined;
}

function normalizeRegion(value: unknown): WeekdayRegion | null {
  if (!value || typeof value !== "object") return null;
  const macroId = normalizeText((value as { macroId?: unknown }).macroId);
  if (!macroId) return null;
  const answers = normalizeAnswers((value as { answers?: unknown }).answers);
  const rawSides = (value as { sideTreatments?: unknown }).sideTreatments;
  const sides =
    rawSides && typeof rawSides === "object"
      ? {
          left: normalizeStringArray((rawSides as { left?: unknown }).left),
          right: normalizeStringArray((rawSides as { right?: unknown }).right),
        }
      : null;
  return {
    macroId,
    treatments: normalizeStringArray((value as { treatments?: unknown }).treatments),
    ...(answers ? { answers } : {}),
    ...(sides && (sides.left.length || sides.right.length) ? { sideTreatments: sides } : {}),
  };
}

function normalizeDays(value: unknown): Record<number, WeekdayRegion[]> {
  const out: Record<number, WeekdayRegion[]> = {};
  if (!value || typeof value !== "object") return out;
  for (const [k, list] of Object.entries(value as Record<string, unknown>)) {
    const day = Number(k);
    if (!Number.isInteger(day) || day < 0 || day > 6 || !Array.isArray(list)) continue;
    const regions: WeekdayRegion[] = [];
    for (const r of list) {
      const region = normalizeRegion(r);
      if (region) regions.push(region);
    }
    if (regions.length) out[day] = regions;
  }
  return out;
}

function nowIso() {
  return new Date().toISOString();
}

function normalizeDecompression(value: unknown): DecompressionProgression | undefined {
  if (!value || typeof value !== "object") return undefined;
  const row = value as Partial<DecompressionProgression> & { region?: unknown };
  const startWeight = normalizeText(row.startWeight);
  const increase = normalizeText(row.increase);
  const cycles = normalizeText(row.cycles);
  const maxWeight = normalizeText((row as { maxWeight?: unknown }).maxWeight);
  const region = normalizeRegion(row.region) ?? undefined;
  if (!startWeight && !increase && !cycles && !maxWeight && !region) return undefined;
  return {
    startWeight,
    increase,
    cycles,
    ...(maxWeight ? { maxWeight } : {}),
    ...(region ? { region } : {}),
  };
}

function normalizePlan(value: unknown): TreatmentPlan | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Partial<TreatmentPlan>;
  const id = normalizeText(row.id);
  const patientId = normalizeText(row.patientId);
  if (!id || !patientId) return null;
  const decompression = normalizeDecompression(row.decompression);
  return {
    id,
    patientId,
    startDate: normalizeText(row.startDate),
    endDate: normalizeText(row.endDate),
    days: normalizeDays(row.days),
    ...(decompression ? { decompression } : {}),
    active: row.active !== false,
    createdAt: normalizeText(row.createdAt) || nowIso(),
    updatedAt: normalizeText(row.updatedAt) || nowIso(),
  };
}

function normalizeMap(value: unknown): TreatmentPlansByPatient {
  if (!value || typeof value !== "object") return {};
  const out: TreatmentPlansByPatient = {};
  for (const [patientId, list] of Object.entries(value as Record<string, unknown>)) {
    const key = normalizeText(patientId);
    if (!key || !Array.isArray(list)) continue;
    const plans = list.map(normalizePlan).filter((p): p is TreatmentPlan => Boolean(p));
    if (plans.length) out[key] = plans;
  }
  return out;
}

export function loadTreatmentPlans(): TreatmentPlansByPatient {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    return normalizeMap(JSON.parse(raw));
  } catch {
    return {};
  }
}

export function saveTreatmentPlans(map: TreatmentPlansByPatient) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  void import("@/lib/kv-cloud").then((m) => m.dualWriteKv(STORAGE_KEY, "billing", map));
}

// ── Carry-over: start a new plan from the patient's last one ───────────────

/** US MM/DD/YYYY → UTC Date, or null if malformed. */
function parseUsDateUtc(us: string): Date | null {
  const m = us.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  const date = new Date(Date.UTC(Number(m[3]), Number(m[1]) - 1, Number(m[2])));
  return date.getUTCMonth() === Number(m[1]) - 1 ? date : null;
}

function formatUsDateUtc(date: Date): string {
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  return `${mm}/${dd}/${date.getUTCFullYear()}`;
}

const DAY_MS = 86_400_000;

/**
 * The plan a new plan should be copied from: the one with the LATEST end
 * date (ties → later start date, then most recently edited). Plans without
 * a valid end date sort by start date. Inactive plans count too — "the last
 * plan" is about time, not the on/off switch.
 */
export function pickCarryoverSourcePlan(plans: TreatmentPlan[]): TreatmentPlan | null {
  const stamp = (us: string) => parseUsDateUtc(us)?.getTime() ?? -Infinity;
  let best: TreatmentPlan | null = null;
  for (const plan of plans) {
    if (!best) {
      best = plan;
      continue;
    }
    const a = [stamp(plan.endDate) === -Infinity ? stamp(plan.startDate) : stamp(plan.endDate), stamp(plan.startDate), plan.updatedAt];
    const b = [stamp(best.endDate) === -Infinity ? stamp(best.startDate) : stamp(best.endDate), stamp(best.startDate), best.updatedAt];
    if (a[0] !== b[0] ? a[0] > b[0] : a[1] !== b[1] ? a[1] > b[1] : String(a[2]) > String(b[2])) best = plan;
  }
  return best;
}

/**
 * The weekdays (0=Sun … 6=Sat) the plan's weekly pattern actually uses:
 * every weekday with at least one region that has a macro picked.
 */
export function planPatternWeekdays(plan: TreatmentPlan): number[] {
  return Object.entries(plan.days)
    .filter(([, regions]) => regions.some((r) => r.macroId))
    .map(([day]) => Number(day))
    .filter((day) => day >= 0 && day <= 6)
    .sort((a, b) => a - b);
}

/**
 * Suggested dates for a plan continuing from `source`.
 *
 * Start: the first date AFTER the source's last date that falls on the
 * FIRST weekday of the source's weekly pattern, so the copied schedule
 * lines up from the top of the week instead of starting mid-pattern
 * (e.g. pattern Mon/Wed/Thu, last date Thu 08/27 → Mon 08/31).
 * "First" follows the app's weekday order (Sun=0 … Sat=6, same order as the
 * weekday tabs), so in practice Monday unless the pattern starts later.
 * No weekday pattern (empty days) → the next office-open day after the
 * last date (`openDays`, falling back to the very next day).
 *
 * End: keeps the source plan's length (start→end span), or "" if unknown.
 * Missing/invalid source end date → empty strings (caller falls back).
 */
export function carryoverDates(
  source: TreatmentPlan,
  openDays: number[] = [0, 1, 2, 3, 4, 5, 6],
): { startDate: string; endDate: string } {
  const start = parseUsDateUtc(source.startDate);
  const end = parseUsDateUtc(source.endDate);
  if (!end) return { startDate: "", endDate: "" };
  const pattern = planPatternWeekdays(source);
  const targets = pattern.length ? [pattern[0]] : openDays.length ? openDays : [0, 1, 2, 3, 4, 5, 6];
  let nextStart = new Date(end.getTime() + DAY_MS);
  for (let i = 0; i < 7 && !targets.includes(nextStart.getUTCDay()); i++) {
    nextStart = new Date(nextStart.getTime() + DAY_MS);
  }
  const lengthDays = start && start <= end ? Math.round((end.getTime() - start.getTime()) / DAY_MS) : null;
  return {
    startDate: formatUsDateUtc(nextStart),
    endDate: lengthDays !== null ? formatUsDateUtc(new Date(nextStart.getTime() + lengthDays * DAY_MS)) : "",
  };
}

function cloneRegion(region: WeekdayRegion): WeekdayRegion {
  return {
    macroId: region.macroId,
    treatments: [...region.treatments],
    ...(region.answers
      ? { answers: Object.fromEntries(Object.entries(region.answers).map(([k, v]) => [k, [...v]])) }
      : {}),
    ...(region.sideTreatments
      ? { sideTreatments: { left: [...region.sideTreatments.left], right: [...region.sideTreatments.right] } }
      : {}),
  };
}

/**
 * The CONTENT of a plan, deep-copied for a new plan: the weekday regions
 * (treatments, answers, per-side picks) and the decompression settings.
 * Never the id, patient, dates, active flag or timestamps.
 */
export function cloneTreatmentPlanContent(
  source: TreatmentPlan,
): Pick<TreatmentPlan, "days" | "decompression"> {
  const days: Record<number, WeekdayRegion[]> = {};
  for (const [day, regions] of Object.entries(source.days)) {
    if (regions.length) days[Number(day)] = regions.map(cloneRegion);
  }
  const d = source.decompression;
  return {
    days,
    ...(d
      ? {
          decompression: {
            startWeight: d.startWeight,
            increase: d.increase,
            cycles: d.cycles,
            ...(d.maxWeight !== undefined ? { maxWeight: d.maxWeight } : {}),
            ...(d.region ? { region: cloneRegion(d.region) } : {}),
          },
        }
      : {}),
  };
}
