/**
 * What G.O.A.T. remembers between visits, saved to the user's cloud prefs
 * (both keys are "user" keys in cloud-key-registry.ts, so every write is
 * backed up to Supabase by user-prefs-cloud.ts — never browser-only).
 *  - the last patient + action you worked on ("Last time: booked John")
 *  - heads-ups you hid (kept 30 days, merged so nothing is lost)
 */
export const GOAT_RECALL_KEY = "casemate.goat-recall.v1";
export const GOAT_DISMISSED_KEY = "casemate.goat-nudges-dismissed.v1";

export type Recall = { patientId: string; patientName: string; action: string; at: string };
export type Dismissed = Record<string, string>; // nudge id → ISO time hidden

const KEEP_MS = 30 * 24 * 3600 * 1000;

export function mergeDismissed(a: Dismissed, b: Dismissed, now = Date.now()): Dismissed {
  const out: Dismissed = {};
  for (const m of [a ?? {}, b ?? {}]) {
    for (const [id, at] of Object.entries(m)) {
      const t = Date.parse(at);
      if (!Number.isFinite(t) || now - t > KEEP_MS) continue;
      if (!out[id] || at > out[id]) out[id] = at;
    }
  }
  return out;
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = typeof window === "undefined" ? null : window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function readDismissed(): Dismissed {
  return mergeDismissed(readJson<Dismissed>(GOAT_DISMISSED_KEY, {}), {});
}

/** Re-reads the saved list first, so a hide from another tab/device that already synced is kept. */
export function dismissNudge(id: string): Dismissed {
  const next = mergeDismissed(readJson<Dismissed>(GOAT_DISMISSED_KEY, {}), { [id]: new Date().toISOString() });
  try {
    window.localStorage.setItem(GOAT_DISMISSED_KEY, JSON.stringify(next));
  } catch {
    /* storage full: still hidden for this chat */
  }
  return next;
}

export function readRecall(): Recall | null {
  const r = readJson<Recall | null>(GOAT_RECALL_KEY, null);
  return r && typeof r.patientId === "string" && typeof r.patientName === "string" ? r : null;
}

export function saveRecall(r: Omit<Recall, "at">): void {
  const prev = readRecall();
  if (prev && prev.patientId === r.patientId && prev.action === r.action) return;
  try {
    window.localStorage.setItem(GOAT_RECALL_KEY, JSON.stringify({ ...r, at: new Date().toISOString() }));
  } catch {
    /* ignore */
  }
}

/** "Last time we were on John's booking — want to pick up there?" (only if within 14 days). */
export function recallLine(r: Recall | null, now = Date.now()): string | null {
  if (!r) return null;
  const t = Date.parse(r.at);
  if (!Number.isFinite(t) || now - t > 14 * 24 * 3600 * 1000) return null;
  const first = r.patientName.includes(",") ? r.patientName.split(",")[1].trim().split(/\s+/)[0] : r.patientName.trim().split(/\s+/)[0];
  return `Last time we were on ${first}'s ${r.action}. Just say "his" or "her" and I'll know who you mean.`;
}
