/**
 * Offline search over the FULL Handbook (the same chapters /handbook renders), for
 * G.O.A.T.'s "how do I… / where is… / how to…" questions. No cloud AI: keywords +
 * a small synonym list, scored per Handbook section (task). New chapters and sections
 * are picked up automatically because the index is built from the chapter arrays.
 * Audience rules match the Handbook page: admin-only stays admin-only.
 */
import { handbookChapters, handbookChaptersClinical, handbookChaptersOffice, type HandbookChapter, type HandbookTask } from "@/lib/handbook-content";

export const allHandbookChapters = (): HandbookChapter[] => [...handbookChapters, ...handbookChaptersClinical, ...handbookChaptersOffice];

export function slugify(t: string): string {
  return t.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
}
/** DOM id of one Handbook section (the /handbook page uses this too). */
export const taskAnchorId = (chapterId: string, heading: string) => `task-${chapterId}-${slugify(heading)}`;
export const taskHref = (chapterId: string, heading: string) => `/handbook#${taskAnchorId(chapterId, heading)}`;

const STOP = new Set("a an and are as at be by can do does for from get go how i if in into is it its me my of on or our so that the their them then there this to too up use using want we what when where which who why will with you your do does did should could would please pls".split(" "));

/** Everyday words → words the Handbook uses. */
const SYNONYMS: Record<string, string[]> = {
  send: ["email", "text", "share", "link"], form: ["forms", "questionnaire", "intake"], questionnaire: ["form", "forms"],
  case: ["cases", "attorney", "injury"], add: ["new", "create"], create: ["new", "add"], new: ["add", "create"],
  change: ["edit", "settings", "set"], edit: ["change"], hours: ["office", "schedule"], office: ["location", "settings"],
  merge: ["combine", "duplicate"], duplicate: ["duplicates", "merge", "twice"], encounter: ["encounters", "visit", "note"], encounters: ["encounter", "visits"],
  appointment: ["appointments", "schedule", "book", "visit"], appt: ["appointment", "schedule", "book"], book: ["schedule", "appointment"], schedule: ["appointment", "book"],
  delete: ["remove", "trash"], remove: ["delete"], bill: ["billing", "charges", "balance"], money: ["payment", "paid", "billing"],
  todo: ["to-do", "task"], task: ["to-do", "todo"], reminder: ["remind", "text"], patient: ["patients"], doc: ["document", "file"], document: ["file", "files"],
  print: ["pdf", "report"], letter: ["letters", "report"], macro: ["macros", "template"], template: ["templates", "macro"], password: ["login", "account"], user: ["team", "role", "member"],
};

const stem = (w: string) => w.replace(/'s$/, "").replace(/(?:ing|es|s)$/, "") || w;
export function words(t: string): string[] {
  return (t.toLowerCase().replace(/\+\s*(?=[a-z])/g, "add ").replace(/[^a-z0-9\s-]/g, " ").match(/[a-z0-9][a-z0-9-]*/g) ?? []).filter((w) => w.length > 1 && !STOP.has(w));
}

export interface HandbookHit {
  chapterId: string;
  chapterTitle: string;
  task: HandbookTask;
  href: string;
  score: number;
}

export interface Reader { admin: boolean; manager: boolean; canView?: (feature: string) => boolean }

function visible(c: HandbookChapter, r: Reader): boolean {
  if (c.audience === "admin" && !r.admin) return false;
  if (c.audience === "manager" && !(r.manager || r.admin)) return false;
  if (c.feature && r.canView && !r.canView(c.feature)) return false;
  return true;
}

/** Best Handbook sections for a question, best first. */
export function searchHandbook(question: string, reader: Reader, chapters: HandbookChapter[] = allHandbookChapters()): HandbookHit[] {
  const qs = words(question.replace(/^(how (do|can|should) (i|we|you)|how to|where (is|are|do i|can i)|what'?s the way to)\s+/i, ""));
  if (!qs.length) return [];
  const want = qs.map((w) => ({ w: stem(w), alt: (SYNONYMS[w] ?? SYNONYMS[stem(w)] ?? []).map(stem) }));
  const out: HandbookHit[] = [];
  for (const c of chapters) {
    if (!visible(c, reader)) continue;
    const chap = new Set(words(`${c.title} ${c.summary}`).map(stem));
    for (const t of c.tasks) {
      const head = new Set(words(t.heading).map(stem));
      const body = new Set(words([...(t.steps ?? []), t.why ?? "", t.watchOut ?? ""].join(" ")).map(stem));
      let score = 0;
      let matched = 0;
      for (const { w, alt } of want) {
        let s = head.has(w) ? 3 : body.has(w) ? 1 : chap.has(w) ? 0.8 : 0;
        if (!s) s = alt.some((a) => head.has(a)) ? 1.5 : alt.some((a) => body.has(a) || chap.has(a)) ? 0.4 : 0;
        if (s) matched++;
        score += s;
      }
      // Phrases ("office hours", "add case") count extra when they appear together.
      const text = ` ${words([t.heading, ...(t.steps ?? []), t.why ?? "", t.watchOut ?? ""].join(" ")).map(stem).join(" ")} `;
      for (let i = 0; i + 1 < want.length; i++) if (text.includes(` ${want[i].w} ${want[i + 1].w} `)) score += 3;
      // Most of the question's words should fit.
      if (!matched || matched / want.length < 0.5) continue;
      score *= matched / want.length;
      out.push({ chapterId: c.id, chapterTitle: c.title, task: t, href: taskHref(c.id, t.heading), score });
    }
  }
  return out.sort((a, b) => b.score - a.score);
}

/** A short plain-words answer from one section (2–4 steps or sentences). */
export function summarizeSection(h: HandbookHit): string {
  const steps = (h.task.steps ?? []).slice(0, 4);
  const lines = steps.length ? steps.map((s, i) => `${i + 1}. ${s}`) : [h.task.why ?? h.task.watchOut ?? ""];
  if (steps.length && h.task.watchOut) lines.push(`Watch out: ${h.task.watchOut}`);
  return [`${h.task.heading} (${h.chapterTitle}):`, ...lines.filter(Boolean)].join("\n");
}

export type HandbookAnswer =
  | { kind: "answer"; text: string; links: Array<{ label: string; href: string }> }
  | { kind: "choose"; text: string; choices: Array<{ label: string; href: string }> }
  | { kind: "unsure"; text: string };

export function answerFromHandbook(question: string, reader: Reader, chapters?: HandbookChapter[]): HandbookAnswer {
  const hits = searchHandbook(question, reader, chapters);
  if (!hits.length || hits[0].score < 2) return { kind: "unsure", text: "I couldn't find that in the Handbook. What are you trying to do, and on which page?" };
  const [top, ...rest] = hits;
  const close = rest.filter((h) => h.score >= top.score * 0.85).slice(0, 2);
  if (close.length) {
    return { kind: "choose", text: "A few Handbook sections fit. Which one?", choices: [top, ...close].map((h) => ({ label: `${h.task.heading} (${h.chapterTitle})`, href: h.href })) };
  }
  return { kind: "answer", text: summarizeSection(top), links: [{ label: `Handbook → ${top.task.heading}`, href: top.href }] };
}
