/**
 * G.O.A.T. Library → Learned in your office: what G.O.A.T. learned from use, shared by the office (workspace cloud
 * settings: workspace_kv row "casemate.goat-learned.v1", dual-written on every
 * change, pulled and union-merged by id on boot — see cloud-state.ts).
 *
 *  - phrases: a message template → the action it meant ("squeeze {patient} in {date}" → book).
 *    Templates never hold patient names: names, dates, times and numbers are slots.
 *  - misses: replies someone marked "that's not what I meant" (template + what G.O.A.T. did).
 *
 * Deletes are kept as tombstones (deleted: true, newer updatedAt) so a delete on
 * one computer isn't undone by another computer's older copy.
 */
import type { ActionId } from "@/lib/goat-understand";
import { builtinMap } from "@/lib/goat-library-builtin";

export const GOAT_LEARNED_KEY = "casemate.goat-learned.v1";

export interface LearnedPhrase {
  id: string; // the template
  action: ActionId;
  count: number;
  updatedAt: string;
  deleted?: boolean;
}
export interface LearnedMiss {
  id: string;
  template: string;
  /** What G.O.A.T. did (action id or "reply"), never the reply text. */
  did: string;
  updatedAt: string;
  deleted?: boolean;
}
export interface Learned {
  phrases: LearnedPhrase[];
  misses: LearnedMiss[];
}

export const emptyLearned = (): Learned => ({ phrases: [], misses: [] });

function byId<T extends { id: string; updatedAt: string }>(a: T[], b: T[]): T[] {
  const out = new Map<string, T>();
  for (const x of [...a, ...b]) {
    if (!x || typeof x.id !== "string") continue;
    const cur = out.get(x.id);
    if (!cur || (x.updatedAt ?? "") > (cur.updatedAt ?? "")) out.set(x.id, x);
  }
  return [...out.values()];
}

/** Merge two copies: union by id, newest change wins (deletes included). */
export function mergeLearned(a: Partial<Learned> | null | undefined, b: Partial<Learned> | null | undefined): Learned {
  return {
    phrases: byId(a?.phrases ?? [], b?.phrases ?? []).slice(-500),
    misses: byId(a?.misses ?? [], b?.misses ?? []).slice(-300),
  };
}

/** Template → action map for understand() (live entries only). */
export function learnedMap(l: Learned): Record<string, ActionId> {
  const out: Record<string, ActionId> = {};
  for (const p of l.phrases) if (!p.deleted && !isBuiltinDuplicate(p.id, p.action)) out[p.id] = p.action;
  return out;
}

/** True when the Built-in list already maps this wording to the same action. */
export function isBuiltinDuplicate(template: string, action: string): boolean {
  return builtinMap()[template] === action;
}

/** Office phrases to show in the Library: live, newest first, built-in duplicates merged away. */
export function officePhrases(l: Learned): LearnedPhrase[] {
  return l.phrases.filter((p) => !p.deleted && !isBuiltinDuplicate(p.id, p.action)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function withPhrase(l: Learned, template: string, action: ActionId, now = new Date().toISOString()): Learned {
  // Already built in → nothing new to learn (keeps the office list free of duplicates).
  if (isBuiltinDuplicate(template, action)) return l;
  const cur = l.phrases.find((p) => p.id === template && !p.deleted);
  const next: LearnedPhrase = { id: template, action, count: cur && cur.action === action ? cur.count + 1 : 1, updatedAt: now };
  return mergeLearned(l, { phrases: [next], misses: [] });
}

export function withMiss(l: Learned, template: string, did: string, now = new Date().toISOString()): Learned {
  return mergeLearned(l, { phrases: [], misses: [{ id: `${template}|${did}`, template, did, updatedAt: now }] });
}

export function withoutEntry(l: Learned, kind: "phrase" | "miss", id: string, now = new Date().toISOString()): Learned {
  if (kind === "phrase") {
    const cur = l.phrases.find((p) => p.id === id);
    return cur ? mergeLearned(l, { phrases: [{ ...cur, deleted: true, updatedAt: now }] }) : l;
  }
  const cur = l.misses.find((m) => m.id === id);
  return cur ? mergeLearned(l, { misses: [{ ...cur, deleted: true, updatedAt: now }] }) : l;
}

/** A template is only kept if it holds no capitalized words or digits (names / numbers are slots). */
export function safeTemplate(t: string): boolean {
  return Boolean(t) && t.length <= 160 && !/[A-Z0-9]/.test(t);
}

// --- Storage (browser) ------------------------------------------------------

export function loadLearned(): Learned {
  if (typeof window === "undefined") return emptyLearned();
  try {
    return mergeLearned(JSON.parse(window.localStorage.getItem(GOAT_LEARNED_KEY) ?? "null"), null);
  } catch {
    return emptyLearned();
  }
}

/** Re-reads the saved copy first, merges, saves, and dual-writes to the workspace cloud row. */
export function saveLearned(update: (l: Learned) => Learned): Learned {
  const next = update(loadLearned());
  const merged = mergeLearned(loadLearned(), next);
  if (typeof window === "undefined") return merged;
  window.localStorage.setItem(GOAT_LEARNED_KEY, JSON.stringify(merged));
  void import("@/lib/kv-cloud").then((m) => m.dualWriteKv(GOAT_LEARNED_KEY, "tasks", merged));
  void import("@/lib/local-sync").then((m) => m.notifyChange(GOAT_LEARNED_KEY));
  return merged;
}
