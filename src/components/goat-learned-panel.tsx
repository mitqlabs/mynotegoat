"use client";

import { useEffect, useState } from "react";
import { onLocalChange } from "@/lib/local-sync";
import { GOAT_ACTIONS, GOAT_BUILTIN_PHRASES } from "@/lib/goat-library-builtin";
import { GOAT_LEARNED_KEY, loadLearned, officePhrases, saveLearned, withoutEntry, type Learned } from "@/lib/goat-learned";

const label = (id: string) => GOAT_ACTIONS.find((a) => a.id === id)?.label ?? (id === "reply" ? "An answer" : id.replace(/^om:/, "Office change: "));
const shown = (t: string) => t.replace(/\{patient\}|\{name\}/g, "‹patient›").replace(/\{date\}/g, "‹day›").replace(/\{time\}/g, "‹time›").replace(/\{n\}/g, "‹number›");
const when = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-US", { month: "2-digit", day: "2-digit", year: "numeric" });
};
const row = "flex items-start gap-2 border-b border-[var(--line-soft)] px-2 py-1.5 last:border-0";
const box = "mt-2 rounded-xl border border-[var(--line-soft)] bg-white";

/** Settings → G.O.A.T. Library: learned in your office (cloud, deletable) and built in (read-only). */
export function GoatLearnedPanel() {
  const [l, setL] = useState<Learned>(() => loadLearned());
  const [showBuiltin, setShowBuiltin] = useState(false);
  useEffect(() => onLocalChange(GOAT_LEARNED_KEY, () => setL(loadLearned())), []);
  const del = (kind: "phrase" | "miss", id: string) => setL(saveLearned((cur) => withoutEntry(cur, kind, id)));
  const phrases = officePhrases(l);
  const misses = l.misses.filter((m) => !m.deleted).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const builtinCount = GOAT_BUILTIN_PHRASES.length + GOAT_ACTIONS.length;
  return (
    <div className="space-y-5" data-goat-library>
      <section>
        <h4 className="text-base font-semibold">Learned in your office</h4>
        <p className="text-xs text-[var(--text-muted)]">Saved when someone corrects G.O.A.T. (👎 then pick, or typing &ldquo;no, I meant a to-do&rdquo;). Shared by everyone in the office. Names, days and times are stored as blanks.</p>
        <div className="mt-2 grid gap-4 md:grid-cols-2">
          <div>
            <p className="text-sm font-semibold">Phrases ({phrases.length})</p>
            <div className={box}>
              {phrases.length === 0 ? (
                <p className="px-2 py-2 text-xs text-[var(--text-muted)]">Nothing learned yet.</p>
              ) : (
                phrases.map((p) => (
                  <div className={row} key={p.id}>
                    <div className="min-w-0 flex-1 text-xs">
                      <p className="font-medium">&ldquo;{shown(p.id)}&rdquo;</p>
                      <p className="text-[var(--text-muted)]">→ {label(p.action)}{p.count > 1 ? ` · ${p.count}×` : ""} · {when(p.updatedAt)}</p>
                    </div>
                    <button className="text-xs font-semibold text-red-700 hover:underline" onClick={() => del("phrase", p.id)} type="button">Delete</button>
                  </div>
                ))
              )}
            </div>
          </div>
          <div>
            <p className="text-sm font-semibold">Misses ({misses.length})</p>
            <div className={box}>
              {misses.length === 0 ? (
                <p className="px-2 py-2 text-xs text-[var(--text-muted)]">No misses.</p>
              ) : (
                misses.map((m) => (
                  <div className={row} key={m.id}>
                    <div className="min-w-0 flex-1 text-xs">
                      <p className="font-medium">&ldquo;{shown(m.template)}&rdquo;</p>
                      <p className="text-[var(--text-muted)]">G.O.A.T. did: {label(m.did)} · {when(m.updatedAt)}</p>
                    </div>
                    <button className="text-xs font-semibold text-red-700 hover:underline" onClick={() => del("miss", m.id)} type="button">Delete</button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </section>
      <section>
        <div className="flex items-baseline justify-between gap-2">
          <h4 className="text-base font-semibold">Built in ({builtinCount})</h4>
          <button className="text-xs font-semibold text-[var(--brand-primary)] hover:underline" onClick={() => setShowBuiltin((v) => !v)} type="button">{showBuiltin ? "Hide list" : "Show list"}</button>
        </div>
        <p className="text-xs text-[var(--text-muted)]">Comes with NoteGoat: {GOAT_ACTIONS.length} actions and {GOAT_BUILTIN_PHRASES.length} reviewed phrases. Read-only. Office phrases that match one of these are merged away.</p>
        {showBuiltin && (
          <div className={box}>
            {GOAT_ACTIONS.map((a) => (
              <div className={row} key={a.id}>
                <div className="min-w-0 flex-1 text-xs">
                  <p className="font-medium">{a.label}</p>
                  <p className="text-[var(--text-muted)]">e.g. &ldquo;{a.examples.slice(0, 2).join("” · “")}&rdquo;</p>
                </div>
              </div>
            ))}
            {GOAT_BUILTIN_PHRASES.map((p) => (
              <div className={row} key={p.template}>
                <div className="min-w-0 flex-1 text-xs">
                  <p className="font-medium">&ldquo;{shown(p.template)}&rdquo;</p>
                  <p className="text-[var(--text-muted)]">→ {label(p.action)}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
