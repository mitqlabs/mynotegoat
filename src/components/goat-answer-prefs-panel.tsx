"use client";

import { useGoatAnswerPrefs } from "@/hooks/use-goat-answer-prefs";
import { DEFAULT_GOAT_REGION_ORDER } from "@/lib/goat-answer-prefs";

const buttonClass =
  "rounded-lg border border-[var(--line-soft)] bg-white px-2 py-0.5 text-xs font-semibold disabled:opacity-30";

function Switch({ on, onChange, label, hint }: { on: boolean; onChange: (on: boolean) => void; label: string; hint: string }) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-[var(--line-soft)] bg-white p-3">
      <button
        aria-checked={on}
        className={`relative mt-0.5 inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${on ? "bg-[var(--brand-primary)]" : "bg-slate-300"}`}
        onClick={() => onChange(!on)}
        role="switch"
        type="button"
      >
        <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${on ? "translate-x-4" : "translate-x-0.5"}`} />
      </button>
      <span>
        <span className="block text-sm font-semibold">{label}</span>
        <span className="block text-xs text-[var(--text-muted)]">{hint}</span>
      </span>
    </label>
  );
}

/** Settings → G.O.A.T.: how Smart mode (beta) writes its answers. Shared by the office. */
export function GoatAnswerPrefsPanel() {
  const { prefs, update } = useGoatAnswerPrefs();
  const move = (i: number, dir: -1 | 1) => {
    const next = [...prefs.regionOrder];
    const j = i + dir;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    update({ regionOrder: next });
  };
  return (
    <div className="space-y-3">
      <Switch
        hint="Include fees and costs written in reports (e.g. professional fees, surgical center fees, cost per session)."
        label="Show costs / fees"
        on={prefs.showCosts}
        onChange={(showCosts) => update({ showCosts })}
      />
      <Switch
        hint={'Start each line with its body region, e.g. "Cervical: Left C7/T1 interlaminar epidural steroid injection", in the order below.'}
        label="Group answers by body region"
        on={prefs.groupByRegion}
        onChange={(groupByRegion) => update({ groupByRegion })}
      />
      {prefs.groupByRegion && (
        <div className="rounded-xl border border-[var(--line-soft)] bg-white p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-semibold">Region order</span>
            <button className={buttonClass} onClick={() => update({ regionOrder: DEFAULT_GOAT_REGION_ORDER })} type="button">
              Reset order
            </button>
          </div>
          <ol className="mt-2 space-y-1">
            {prefs.regionOrder.map((r, i) => (
              <li key={r} className="flex items-center justify-between gap-2 rounded-lg bg-[var(--bg-soft)] px-2.5 py-1 text-sm">
                <span>
                  <span className="mr-2 text-xs text-[var(--text-muted)]">{i + 1}.</span>
                  {r}
                </span>
                <span className="flex gap-1">
                  <button aria-label={`Move ${r} up`} className={buttonClass} disabled={i === 0} onClick={() => move(i, -1)} type="button">
                    ↑
                  </button>
                  <button aria-label={`Move ${r} down`} className={buttonClass} disabled={i === prefs.regionOrder.length - 1} onClick={() => move(i, 1)} type="button">
                    ↓
                  </button>
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}
