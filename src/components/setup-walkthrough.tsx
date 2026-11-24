"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ScrollLock } from "@/components/scroll-lock";
import { isBlankStarterWorkspace } from "@/lib/workspace-starter";
import {
  OPEN_SETUP_EVENT,
  SETUP_STEPS,
  doneCount,
  isStepDone,
  loadProgress,
  pullProgress,
  saveProgress,
  withDismissed,
  withStep,
  type SetupProgress,
} from "@/lib/setup-walkthrough";

export function SetupWalkthrough({
  autoOpen = false,
  forceOpen = false,
  initialStepId,
  initialProgress,
}: {
  autoOpen?: boolean;
  /** Preview and tests. The live app opens from the event or a new office. */
  forceOpen?: boolean;
  initialStepId?: string;
  initialProgress?: SetupProgress;
}) {
  const [progress, setProgress] = useState<SetupProgress>(() => initialProgress ?? loadProgress());
  const [ready, setReady] = useState(false);
  const [forced, setForced] = useState(false);
  const [closed, setClosed] = useState(false);
  const [stepId, setStepId] = useState(
    initialStepId && SETUP_STEPS.some((step) => step.id === initialStepId) ? initialStepId : SETUP_STEPS[0].id,
  );
  const [saveError, setSaveError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let live = true;
    if (initialProgress) {
      setReady(true);
    } else {
      void pullProgress().then((next) => {
        if (!live) return;
        setProgress(next);
        setReady(true);
      });
    }
    const open = () => {
      setForced(true);
      setClosed(false);
    };
    window.addEventListener(OPEN_SETUP_EVENT, open);
    if (forceOpen || new URLSearchParams(window.location.search).get("setup") === "1") open();
    return () => {
      live = false;
      window.removeEventListener(OPEN_SETUP_EVENT, open);
    };
  }, []);

  const show =
    ready &&
    !closed &&
    (forced || (autoOpen && isBlankStarterWorkspace() && !progress.dismissedAt));

  if (!show) return null;

  const step = SETUP_STEPS.find((item) => item.id === stepId) ?? SETUP_STEPS[0];
  const finished = doneCount(progress);
  const total = SETUP_STEPS.length;
  const pct = Math.round((finished / total) * 100);

  const persist = async (next: SetupProgress) => {
    setSaving(true);
    setSaveError("");
    setProgress(next);
    try {
      const saved = await saveProgress(next);
      setProgress(saved);
    } catch {
      setSaveError("Not saved. Check the connection and try the checkbox again.");
    } finally {
      setSaving(false);
    }
  };

  const close = () => {
    setClosed(true);
    setForced(false);
    if (!progress.dismissedAt) void persist(withDismissed(progress));
  };

  return (
    <div className="modal-overlay fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-black/55 px-3 py-6">
      <ScrollLock />
      <div className="panel-card flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden" data-testid="setup-walkthrough">
        <div className="flex items-center justify-between gap-3 border-b border-[var(--line-soft)] px-4 py-3">
          <h2 className="text-2xl font-semibold">Setup</h2>
          <div className="flex items-center gap-2">
            <button className="btn btn-secondary btn-sm" onClick={close} type="button">
              Not now
            </button>
            <button aria-label="Close setup" className="btn btn-secondary btn-sm" onClick={close} type="button">
              ×
            </button>
          </div>
        </div>

        <div className="border-b border-[var(--line-soft)] px-4 py-3">
          <div className="mb-1 flex items-center justify-between text-sm font-semibold">
            <span>
              {finished} of {total}
            </span>
            <span>{pct}%</span>
          </div>
          <div aria-hidden className="h-2 overflow-hidden rounded-full bg-[var(--line-soft)]">
            <div className="h-full rounded-full bg-[var(--brand-primary)]" style={{ width: `${pct}%` }} />
          </div>
          <div
            aria-label={`Setup progress, ${finished} of ${total} steps marked done`}
            aria-valuemax={total}
            aria-valuemin={0}
            aria-valuenow={finished}
            className="sr-only"
            role="progressbar"
          />
        </div>

        <div className="grid min-h-0 flex-1 md:grid-cols-[280px_1fr]">
          <ol className="max-h-[50vh] overflow-y-auto border-b border-[var(--line-soft)] md:max-h-[64vh] md:border-b-0 md:border-r">
            {SETUP_STEPS.map((item, index) => {
              const on = isStepDone(progress, item.id);
              const selected = item.id === step.id;
              return (
                <li
                  className={`flex items-start gap-2 px-3 py-2 ${selected ? "bg-[var(--bg-soft)]" : ""}`}
                  key={item.id}
                >
                  <input
                    aria-label={`Mark ${item.title} done`}
                    checked={on}
                    className="mt-1"
                    onChange={(event) => void persist(withStep(progress, item.id, event.target.checked))}
                    type="checkbox"
                  />
                  <button
                    className={`flex-1 text-left text-sm ${selected ? "font-semibold" : ""}`}
                    onClick={() => setStepId(item.id)}
                    type="button"
                  >
                    <span className="text-[var(--text-muted)]">{index + 1}. </span>
                    {item.title}
                  </button>
                </li>
              );
            })}
          </ol>

          <div className="max-h-[64vh] overflow-y-auto px-4 py-4">
            <h3 className="text-xl font-semibold">{step.title}</h3>
            <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm leading-6">
              {step.lines.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ol>
            {step.example ? (
              <figure className="mt-4 overflow-hidden rounded-xl border border-[var(--line-soft)]">
                <img alt={step.example.alt} className="w-full" src={step.example.src} />
                <figcaption className="border-t border-[var(--line-soft)] px-3 py-2 text-xs font-semibold text-[var(--text-muted)]">
                  Example
                </figcaption>
              </figure>
            ) : null}
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <Link className="btn btn-primary" href={step.href} onClick={() => setClosed(true)}>
                {step.openLabel}
              </Link>
              <label className="inline-flex items-center gap-2 text-sm font-semibold">
                <input
                  checked={isStepDone(progress, step.id)}
                  disabled={saving}
                  onChange={(event) => void persist(withStep(progress, step.id, event.target.checked))}
                  type="checkbox"
                />
                Mark done
              </label>
              {saveError ? (
                <p className="text-sm font-semibold text-red-700" role="alert">
                  {saveError}
                </p>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
