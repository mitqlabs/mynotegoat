"use client";

import { useEffect, useState } from "react";
import { onLocalChange } from "@/lib/local-sync";
import { GOAT_ACTIONS } from "@/lib/goat-understand";
import { GOAT_LEARNED_KEY, loadLearned, saveLearned, withoutEntry, type Learned } from "@/lib/goat-learned";

const label = (id: string) => GOAT_ACTIONS.find((a) => a.id === id)?.label ?? (id === "reply" ? "An answer" : id.replace(/^om:/, "Office change: "));
const shown = (t: string) => t.replace(/\{patient\}|\{name\}/g, "‹patient›").replace(/\{date\}/g, "‹day›").replace(/\{time\}/g, "‹time›").replace(/\{n\}/g, "‹number›");
const when = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-US", { month: "2-digit", day: "2-digit", year: "numeric" });
};

/** Settings → G.O.A.T.: phrases G.O.A.T. learned, and replies marked "not what I meant". Shared by the office. */
export function GoatLearnedPanel() {
  const [l, setL] = useState<Learned>(() => loadLearned());
  useEffect(() => onLocalChange(GOAT_LEARNED_KEY, () => setL(loadLearned())), []);
  const del = (kind: "phrase" | "miss", id: string) => setL(saveLearned((cur) => withoutEntry(cur, kind, id)));
  const phrases = l.phrases.filter((p) => !p.deleted).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const misses = l.misses.filter((m) => !m.deleted).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const row = "flex items-start gap-2 border-b border-[var(--line-soft)] px-2 py-1.5 last:border-0";
  return (
    <div className="grid gap-4 md:grid-cols-2" data-goat-learned>
      <div>
        <p className="text-sm font-semibold">Learned phrases ({phrases.length})</p>
        <p className="text-xs text-[var(--text-muted)]">When you correct G.O.A.T. (👎 then pick, or type When you pick the right action after &ldquo;that&apos;s not what I meant&rdquo;, G.O.A.T. reads that wording that way next time. Names, days and times are stored as blanks.ldquo;no, I meant a to-doWhen you pick the right action after &ldquo;that&apos;s not what I meant&rdquo;, G.O.A.T. reads that wording that way next time. Names, days and times are stored as blanks.rdquo;), it reads that wording that way next time. Names, days and times are stored as blanks.</p>
        <div className="mt-2 rounded-xl border border-[var(--line-soft)] bg-white">
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
        <p className="text-xs text-[var(--text-muted)]">Replies someone marked &ldquo;that&apos;s not what I meant&rdquo; (👎), with what G.O.A.T. did.</p>
        <div className="mt-2 rounded-xl border border-[var(--line-soft)] bg-white">
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
  );
}
