/** Order answer items / blocks by the office's region order (Settings → G.O.A.T.); default head to toe. */
const DEFAULT_ORDER = ["Cervical", "Thoracic", "Lumbar", "Shoulder", "Elbow", "Wrist/Hand", "Hip", "Knee", "Ankle/Foot"];
const RE: Record<string, RegExp> = {
  Cervical: /\b(cervical|c[- ]?spine|neck|c\d\b)/i,
  Thoracic: /\b(thoracic|t[- ]?spine|mid[- ]?back)/i,
  Lumbar: /\b(lumbar|l[- ]?spine|low(?:er)? back|lumbosacral|l\d\b)/i,
  Shoulder: /\bshoulders?\b/i,
  Elbow: /\belbows?\b/i,
  "Wrist/Hand": /\b(wrists?|hands?|fingers?)\b/i,
  Hip: /\bhips?\b/i,
  Knee: /\bknees?\b/i,
  "Ankle/Foot": /\b(ankles?|foot|feet|toes?)\b/i,
};

/** Rank of a heading / line: the first region it names (spine before extremities by default); unknown / "Extremity" last. */
export function regionRank(text: string, order: string[] = DEFAULT_ORDER): number {
  const ord = order.length ? order : DEFAULT_ORDER;
  const lead = text.slice(0, 60);
  const i = ord.findIndex((r) => RE[r]?.test(lead));
  if (i >= 0) return i;
  if (/\bextremit/i.test(lead)) return ord.length; // generic extremity block after named regions
  return ord.length + 1;
}

/** Stable sort by region order. */
export function sortByRegion<T>(items: T[], textOf: (t: T) => string, order?: string[]): T[] {
  return items.map((x, i) => ({ x, i, r: regionRank(textOf(x), order) })).sort((a, b) => a.r - b.r || a.i - b.i).map((e) => e.x);
}
