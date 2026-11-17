"use client";

import { type Dispatch, type SetStateAction } from "react";
import { formatUsDateInput } from "@/components/us-date-input";
import {
  macroOptionChecked,
  macroOtherEditText,
  toggleAllMacroCheckboxes,
  toggleMacroCheckbox,
} from "@/lib/macro-multiselect";
import type { MacroAnswerMap, MacroQuestion } from "@/lib/macro-templates";
import { isDecompressionSinglePick } from "@/lib/treatment-plans";

/**
 * One question inside the encounter macro picker: options, and the
 * Other / edit box that mirrors them. Multi-choice checkbox groups accept
 * a tap or click on the title to select every option, or to clear them
 * when they are already all selected. The title does not gain a label.
 */
export function MacroPromptQuestion({
  question,
  buttonName,
  answers,
  setAnswers,
}: {
  question: MacroQuestion;
  buttonName: string;
  answers: MacroAnswerMap;
  setAnswers: Dispatch<SetStateAction<MacroAnswerMap>>;
}) {
  const normalizedOptions = question.options
    .map((option) => option.trim())
    .filter((option): option is string => Boolean(option));
  const answerValue = answers[question.id];
  const selectedAnswers = Array.isArray(answerValue)
    ? answerValue.map((option) => option.trim()).filter((option) => option.length > 0)
    : typeof answerValue === "string" && answerValue.trim()
      ? [answerValue.trim()]
      : [];
  const selectedAnswer = selectedAnswers[0] ?? "";
  // Decompression "Targeted Segment" / "Which program": one pick
  // per section even if the saved macro question is multi-select.
  const singlePick =
    Boolean(question.multiSelect) && isDecompressionSinglePick(buttonName, question.label);
  const freeTextValue = macroOtherEditText(answerValue);
  const numericOptions = Array.from(
    new Set(
      normalizedOptions
        .filter((option) => /^\d+$/.test(option))
        .map((option) => Number(option)),
    ),
  ).sort((left, right) => left - right);
  const nonNumericOptions = normalizedOptions.filter((option) => !/^\d+$/.test(option));
  const usePainScaleColumns = numericOptions.length >= 5;
  const midPoint = usePainScaleColumns ? Math.ceil(numericOptions.length / 2) : 0;
  const leftPainScaleOptions = usePainScaleColumns
    ? numericOptions.slice(0, midPoint).map(String)
    : [];
  const rightPainScaleOptions = usePainScaleColumns
    ? numericOptions.slice(midPoint).map(String)
    : [];
  const selectableOptions = normalizedOptions.length > 0 ? normalizedOptions : question.options;
  const useMultiColumn = !usePainScaleColumns && selectableOptions.length >= 5;
  // Hidden gesture: title tap selects every checkbox, or clears them when
  // they are already all on. Single-pick groups stay radios.
  const canToggleAll = Boolean(question.multiSelect) && !singlePick && selectableOptions.length > 0;
  const renderOptionRow = (option: string) => (
    <label
      key={`${question.id}-${option}`}
      className="inline-flex w-full items-center gap-2 rounded-lg border border-[var(--line-soft)] bg-[var(--bg-soft)] px-3 py-2 text-sm"
    >
      {singlePick ? (
        <input
          checked={selectedAnswers.includes(option)}
          onChange={() =>
            setAnswers((current) => ({ ...current, [question.id]: [option] }))
          }
          type="radio"
        />
      ) : question.multiSelect ? (
        <input
          checked={macroOptionChecked(answerValue, option)}
          onChange={() =>
            setAnswers((current) => ({
              ...current,
              [question.id]: toggleMacroCheckbox(current[question.id], option, question.options),
            }))
          }
          type="checkbox"
        />
      ) : (
        <input
          checked={selectedAnswer === option}
          onChange={() =>
            setAnswers((current) => ({
              ...current,
              [question.id]: option,
            }))
          }
          type="radio"
        />
      )}
      {option}
    </label>
  );

  // The free-text field below the options always shows the current
  // answer (or the joined multi-select answers) so the user can edit
  // it like a "live preview". Picking a radio overwrites the field
  // with that option text; the user can then click into the field
  // and append a detail (e.g. "Yes" -> "Yes - Glendale Adventist").
  const freeTextEditableValue = macroOtherEditText(answerValue);

  return (
    <div className="theme-surface rounded-xl border border-[var(--line-soft)] p-3">
      <p
        className={`text-sm font-semibold${canToggleAll ? " cursor-pointer touch-manipulation" : ""}`}
        onClick={
          canToggleAll
            ? () =>
                setAnswers((current) => ({
                  ...current,
                  [question.id]: toggleAllMacroCheckboxes(current[question.id], question.options),
                }))
            : undefined
        }
      >
        {question.label}
        {singlePick ? " (pick one)" : ""}
      </p>
      {question.options.length > 0 ? (
        <>
          {usePainScaleColumns ? (
            <div className="mt-2 space-y-2">
              <div className="grid gap-2 md:grid-cols-2">
                <div className="grid gap-2">{leftPainScaleOptions.map(renderOptionRow)}</div>
                <div className="grid gap-2">{rightPainScaleOptions.map(renderOptionRow)}</div>
              </div>
              {nonNumericOptions.length > 0 && (
                <div className="grid gap-2">{nonNumericOptions.map(renderOptionRow)}</div>
              )}
            </div>
          ) : useMultiColumn ? (
            // Auto-balanced multi-column: the browser fits as
            // many equal ~11rem columns as the width allows and
            // balances their heights, so options read A,B,C DOWN
            // each column with no lopsided last column.
            // break-inside-avoid keeps each chip whole.
            <div className="mt-2" style={{ columnWidth: "11rem", columnGap: "0.5rem" }}>
              {selectableOptions.map((option) => (
                <div
                  key={`${question.id}-opt-${option}`}
                  className="mb-2 break-inside-avoid"
                >
                  {renderOptionRow(option)}
                </div>
              ))}
            </div>
          ) : (
            <div className="mt-2 grid gap-2">{selectableOptions.map(renderOptionRow)}</div>
          )}
          {/* Live-preview / edit field — always shows the current
              answer and is always editable. Picking a radio above
              updates this field; typing here overwrites the answer.
              Lets the user pick "Yes" then type " - Glendale Adventist"
              to end up with "Yes - Glendale Adventist" without losing
              the macro structure. */}
          <div className="mt-2">
            <label className="flex items-start gap-2 rounded-lg border border-[var(--line-soft)] bg-[var(--bg-soft)] px-3 py-2 text-sm">
              <span className="pt-1 text-xs font-semibold text-[var(--text-muted)]">
                Other / edit:
              </span>
              <textarea
                className="flex-1 resize-y rounded-lg border border-[var(--line-soft)] bg-white px-2 py-1 text-sm"
                onChange={(event) =>
                  setAnswers((current) => ({
                    ...current,
                    [question.id]: event.target.value,
                  }))
                }
                placeholder="Pick an option above to start, or type your own"
                rows={1}
                value={freeTextEditableValue}
              />
            </label>
          </div>
        </>
      ) : (
        <input
          className="mt-2 w-full rounded-xl border border-[var(--line-soft)] px-3 py-2"
          inputMode={question.dateInput ? "numeric" : undefined}
          maxLength={question.dateInput ? 10 : undefined}
          placeholder={question.dateInput ? "MM/DD/YYYY" : undefined}
          onChange={(event) =>
            setAnswers((current) => ({
              ...current,
              [question.id]: question.dateInput
                ? formatUsDateInput(event.target.value)
                : event.target.value,
            }))
          }
          value={freeTextValue}
        />
      )}
    </div>
  );
}
