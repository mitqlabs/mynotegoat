"use client";

import { useEffect, useState } from "react";
import { GOAT_AI_MODELS, downloadedGoatAiModels, hasGoatAiDownload, loadGoatAi, refreshGoatAiSupport, removeGoatAiModels, setGoatAiModel, type GoatAiModel } from "@/lib/goat-ai/engine";
import { GOAT_SMART_AVAILABLE } from "@/lib/goat-ai/flag";
import { useGoatAiState, usePlusIntro, useSmartMode } from "@/components/goat-smart";

const btn = "rounded-lg border border-[var(--line-soft)] bg-white px-2.5 py-1 text-sm font-semibold disabled:opacity-40";
const primary = "rounded-lg bg-[var(--brand-primary)] px-2.5 py-1 text-sm font-semibold text-white disabled:opacity-40";

function size(mb: number): string {
  return mb >= 1000 ? `${(mb / 1000).toFixed(1)} GB` : `${mb} MB`;
}

/**
 * Settings → G.O.A.T.: the only Smart mode on/off switch (per computer, since
 * the model lives on this computer). On: one-time download with progress.
 * Off: offers to remove the model. "Remove downloaded model" frees the space.
 */
export function GoatSmartSettings() {
  const [on, setOn] = useSmartMode();
  // A choice made here counts as the answer to the one-time card in the G.O.A.T. panels.
  const intro = usePlusIntro();
  const ai = useGoatAiState();
  const [step, setStep] = useState<"" | "download" | "offRemove" | "confirmRemove">("");
  const [downloaded, setDownloaded] = useState<GoatAiModel[]>([]);
  const [removing, setRemoving] = useState(false);
  const [removedMsg, setRemovedMsg] = useState("");

  // Off: nothing of + mode loads here (no WebGPU check, no WebLLM code); only storage names are looked at.
  const [hasDownload, setHasDownload] = useState(false);
  useEffect(() => {
    if (on) {
      void refreshGoatAiSupport();
      void downloadedGoatAiModels().then((d) => {
        setDownloaded(d);
        setHasDownload(d.length > 0);
      });
    } else void hasGoatAiDownload().then(setHasDownload);
  }, [on]);
  useEffect(() => {
    if (ai.status === "ready") void downloadedGoatAiModels().then(setDownloaded);
  }, [ai.status]);
  // On and already downloaded: open it in the background.
  useEffect(() => {
    if (on && ai.status === "idle" && ai.cached) void loadGoatAi().catch((e) => console.error("[goat+] + mode failed to load", e));
  }, [on, ai.status, ai.cached]);

  if (!GOAT_SMART_AVAILABLE) return null;

  const remove = async () => {
    setRemoving(true);
    try {
      const r = await removeGoatAiModels();
      setRemovedMsg(r.removed.length || r.freedMb ? `Removed the + mode model. Freed about ${size(r.freedMb)} on this computer.` : "Nothing to remove: no + mode model is downloaded on this computer.");
      setDownloaded([]);
      setHasDownload(false);
    } finally {
      setRemoving(false);
      setStep("");
    }
  };

  const toggle = () => {
    setRemovedMsg("");
    intro.answer(on ? "later" : "on");
    if (on) {
      setOn(false);
      setStep(downloaded.length || hasDownload ? "offRemove" : "");
      return;
    }
    if (ai.cached || ai.status === "ready") {
      setOn(true);
      void loadGoatAi().catch((e) => console.error("[goat+] + mode failed to load", e));
      return;
    }
    setStep("download");
    void refreshGoatAiSupport();
  };

  const pct = Math.round(ai.progress * 100);
  return (
    <div className="space-y-3 text-sm">
      <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-[var(--line-soft)] bg-white p-3">
        <button
          aria-checked={on}
          className={`relative mt-0.5 inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${on ? "bg-[var(--brand-primary)]" : "bg-slate-300"}`}
          onClick={toggle}
          role="switch"
          type="button"
        >
          <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${on ? "translate-x-4" : "translate-x-0.5"}`} />
        </button>
        <span onClick={toggle}>
          <span className="block font-semibold">+ mode on this computer</span>
          <span className="block text-xs text-[var(--text-muted)]">
            Off unless you turn it on. G.O.A.T. answers the same way, and a private AI model running only on this computer fills in what the rules miss (for example, reading a whole
            report for its recommendations). Questions and patient information are never sent anywhere.
          </span>
        </span>
      </label>

      {step === "download" && !on && (
        <div className="rounded-xl border border-[#72bdcf] bg-[#eef8fb] p-3">
          {ai.status === "unsupported" ? (
            <>
              <p>{ai.message}</p>
              <button className={`${btn} mt-2`} onClick={() => setStep("")} type="button">
                OK
              </button>
            </>
          ) : (
            <>
              <p>Turning on + mode downloads the model once. It stays on this computer.</p>
              <div className="mt-2 space-y-1">
                {(Object.keys(GOAT_AI_MODELS) as GoatAiModel[]).map((m) => (
                  <label key={m} className="flex cursor-pointer items-start gap-2">
                    <input checked={ai.model === m} className="mt-1" name="goat-ai-model" onChange={() => setGoatAiModel(m)} type="radio" />
                    <span>
                      <strong>{GOAT_AI_MODELS[m].label}</strong> · about {size(GOAT_AI_MODELS[m].downloadMb)}
                      {m === "accurate" ? " · best answers, needs a newer computer" : " · for older or slower computers"}
                    </span>
                  </label>
                ))}
              </div>
              <div className="mt-2 flex gap-2">
                <button
                  className={primary}
                  disabled={ai.status === "checking"}
                  onClick={() => {
                    setStep("");
                    setOn(true);
                    void loadGoatAi().catch((e) => console.error("[goat+] + mode failed to load", e));
                  }}
                  type="button"
                >
                  Download and turn on
                </button>
                <button className={btn} onClick={() => setStep("")} type="button">
                  Not now
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {on && ai.status === "checking" && <p className="rounded-xl bg-[var(--bg-soft)] px-3 py-2 text-[var(--text-muted)]">Checking this computer…</p>}
      {on && ai.status === "loading" && (
        <div className="rounded-xl bg-[var(--bg-soft)] px-3 py-2 text-[var(--text-muted)]">
          <div className="flex justify-between gap-2">
            <span>{ai.cached ? "Opening + mode…" : `Downloading ${pct}%… (one time, stays on this computer)`}</span>
            <span className="font-semibold">{pct}%</span>
          </div>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white">
            <div className="h-full rounded-full bg-[#72bdcf] transition-all" style={{ width: `${Math.max(3, pct)}%` }} />
          </div>
        </div>
      )}
      {on && (ai.status === "unsupported" || ai.status === "error") && <p className="rounded-xl bg-amber-50 px-3 py-2 font-semibold text-amber-800">{ai.message}</p>}
      {on && ai.status === "ready" && (
        <p className="text-xs text-[var(--text-muted)]">
          Ready ({GOAT_AI_MODELS[ai.model].label.toLowerCase()} model, {GOAT_AI_MODELS[ai.model].name}).{" "}
          <button
            className="font-semibold text-[var(--brand-primary)] hover:underline"
            onClick={() => {
              setGoatAiModel(ai.model === "accurate" ? "fast" : "accurate");
              setOn(false);
              setStep("download");
            }}
            style={{ fontSize: 12 }}
            type="button"
          >
            Use {GOAT_AI_MODELS[ai.model === "accurate" ? "fast" : "accurate"].label.toLowerCase()} instead
          </button>
        </p>
      )}

      {step === "offRemove" && (
        <div className="rounded-xl border border-[var(--line-soft)] bg-white p-3">
          <p>+ mode is off. Also remove its downloaded model from this computer? You can download it again later.</p>
          <div className="mt-2 flex gap-2">
            <button className={primary} disabled={removing} onClick={() => void remove()} type="button">
              {removing ? "Removing…" : "Remove from this computer"}
            </button>
            <button className={btn} onClick={() => setStep("")} type="button">
              Keep it
            </button>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-[var(--line-soft)] bg-white p-3">
        <div className="min-w-0 flex-1">
          <div className="font-semibold">+ mode downloaded model</div>
          <div className="text-xs text-[var(--text-muted)]">
            {downloaded.length
              ? `${downloaded.map((m) => `${GOAT_AI_MODELS[m].label} (about ${size(GOAT_AI_MODELS[m].downloadMb)})`).join(", ")} on this computer.`
              : hasDownload
                ? "A + mode model is downloaded on this computer."
                : "No + mode model downloaded on this computer."}
          </div>
        </div>
        {step === "confirmRemove" ? (
          <span className="flex items-center gap-2">
            <span className="text-xs">Remove it{on ? " and turn + mode off" : ""}?</span>
            <button
              className={primary}
              disabled={removing}
              onClick={() => {
                setOn(false);
                void remove();
              }}
              type="button"
            >
              {removing ? "Removing…" : "Remove"}
            </button>
            <button className={btn} onClick={() => setStep("")} type="button">
              Cancel
            </button>
          </span>
        ) : (
          <button className={btn} disabled={removing || (!downloaded.length && !hasDownload)} onClick={() => setStep("confirmRemove")} type="button">
            Remove downloaded model
          </button>
        )}
      </div>
      {removedMsg && <p className="text-xs font-semibold text-[#2f7f93]">{removedMsg}</p>}
    </div>
  );
}
