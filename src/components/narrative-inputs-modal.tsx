"use client";

import { ScrollLock } from "@/components/scroll-lock";
import {
  applyNarrativeAnswers,
  correctNarrativeAmountTypos,
  narrativeAnswerSkipsToReport,
  promptInputKind,
  visibleNarrativePrompts,
} from "@/lib/narrative-inputs";
import type { NarrativeReportPrompt } from "@/lib/report-templates";

/**
 * Questions a narrative asks before it generates. A Yes/No answer can hide
 * the questions an office attached to it. "No" on the last question generates
 * the report without those follow-ups.
 */
export function NarrativeInputsModal({
  templateName,
  prompts,
  values,
  error,
  onChange,
  onContinue,
  onClose,
}: {
  templateName: string;
  prompts: NarrativeReportPrompt[];
  values: Record<string, string>;
  error: string;
  onChange: (values: Record<string, string>) => void;
  onContinue: (values: Record<string, string>) => void;
  onClose: () => void;
}) {
  const visible = visibleNarrativePrompts(prompts, values);
  const choose = (prompt: NarrativeReportPrompt, option: string) => {
    const next = applyNarrativeAnswers(prompts, {
      ...values,
      [prompt.token]: correctNarrativeAmountTypos(option),
    });
    onChange(next);
    if (narrativeAnswerSkipsToReport(prompts, next, prompt.id)) onContinue(next);
  };

  return (
    <div className="modal-overlay fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/45 px-4 py-8" data-narrative-inputs>
      <ScrollLock />
      <div className="panel-card mx-auto w-full max-w-3xl overflow-auto p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div>
            <h3 className="text-xl font-semibold">Narrative Inputs</h3>
            <p className="text-sm text-[var(--text-muted)]">{templateName}</p>
          </div>
          <button className="btn btn-secondary btn-sm" onClick={onClose} type="button">
            Close
          </button>
        </div>

        <div className="space-y-3">
          {visible.map((prompt) => (
            <NarrativePromptField
              key={prompt.id}
              onChoose={(option) => choose(prompt, option)}
              onType={(text) => onChange({ ...values, [prompt.token]: text })}
              prompt={prompt}
              value={values[prompt.token] ?? ""}
            />
          ))}
        </div>

        {error && <p className="mt-3 text-sm font-semibold text-[#b43b34]">{error}</p>}

        <div className="mt-4 flex justify-end gap-2">
          <button className="btn btn-secondary btn-sm" onClick={onClose} type="button">
            Cancel
          </button>
          <button className="btn btn-primary btn-sm" onClick={() => onContinue(applyNarrativeAnswers(prompts, values))} type="button">
            Continue
          </button>
        </div>
      </div>
    </div>
  );
}

function NarrativePromptField({
  prompt,
  value,
  onChoose,
  onType,
}: {
  prompt: NarrativeReportPrompt;
  value: string;
  onChoose: (option: string) => void;
  onType: (text: string) => void;
}) {
  const kind = promptInputKind(prompt);
  const selected = correctNarrativeAmountTypos(value);
  return (
    <article
      className="rounded-xl border border-[var(--line-soft)] bg-[var(--bg-soft)] p-3"
      data-narrative-prompt={prompt.token}
    >
      <p className="text-sm font-semibold">
        {prompt.label}
        {prompt.required ? " *" : ""}
      </p>
      {kind === "text" ? (
        <input
          className="mt-2 w-full rounded-xl border border-[var(--line-soft)] bg-[var(--bg-panel)] px-3 py-2 text-[var(--text-main)]"
          onChange={(event) => onType(event.target.value)}
          placeholder="Enter value"
          value={value}
        />
      ) : (
        <div className="mt-2 space-y-2" role="group" aria-label={prompt.label}>
          {(kind === "yesno" && prompt.options.length === 0 ? ["Yes", "No"] : prompt.options).map((option) => {
            const label = correctNarrativeAmountTypos(option);
            const checked = selected === label;
            return (
              <button
                aria-pressed={checked}
                className={`w-full rounded-xl border px-3 py-2 text-left text-sm font-semibold ${
                  checked
                    ? "border-[var(--brand-primary)] bg-[color-mix(in_srgb,var(--brand-primary)_12%,transparent)] text-[var(--brand-primary)]"
                    : "border-[var(--line-soft)] bg-[var(--bg-panel)] text-[var(--text-main)]"
                }`}
                key={`${prompt.id}-${option}`}
                onClick={() => onChoose(option)}
                type="button"
              >
                {label}
              </button>
            );
          })}
          {kind === "choices" && (
            <input
              className="w-full rounded-xl border border-[var(--line-soft)] bg-[var(--bg-panel)] px-3 py-2 text-[var(--text-main)]"
              onChange={(event) => onType(event.target.value)}
              placeholder="Or type custom value"
              value={value}
            />
          )}
        </div>
      )}
    </article>
  );
}
