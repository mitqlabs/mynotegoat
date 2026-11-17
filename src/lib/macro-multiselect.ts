import type { MacroAnswerValue } from "@/lib/macro-templates";

/**
 * Checkbox options for a SOAP macro prompt, in the same list the encounter
 * picker renders. Blank entries are dropped; if that leaves nothing, the
 * original list is kept (same fallback as the question card).
 */
export function macroCheckboxOptions(options: readonly string[]): string[] {
  const normalized = options.map((option) => option.trim()).filter((option) => option.length > 0);
  return normalized.length > 0 ? normalized : [...options];
}

/** Whether a checkbox in the encounter picker shows as checked. */
export function macroOptionChecked(currentValue: MacroAnswerValue | undefined, option: string): boolean {
  const selected = Array.isArray(currentValue)
    ? currentValue.map((entry) => entry.trim()).filter((entry) => entry.length > 0)
    : typeof currentValue === "string" && currentValue.trim()
      ? [currentValue.trim()]
      : [];
  return selected.includes(option);
}

/**
 * The Other / edit box. Multi-select answers are joined in stored order
 * with a comma and a space — the same string the picker shows while the
 * boxes are being checked.
 */
export function macroOtherEditText(value: MacroAnswerValue | undefined): string {
  return Array.isArray(value) ? value.join(", ") : (value ?? "");
}

function sortByOptionOrder(values: string[], optionOrder: readonly string[]): string[] {
  return values.slice().sort((a, b) => {
    const ai = optionOrder.indexOf(a);
    const bi = optionOrder.indexOf(b);
    // Items not in the predefined list go to the end
    return (ai === -1 ? Infinity : ai) - (bi === -1 ? Infinity : bi);
  });
}

/**
 * One checkbox click. A non-array answer (the Other / edit box was typed
 * into) is treated as empty, then the pick is added. Results are sorted
 * into option order, not click order.
 */
export function toggleMacroCheckbox(
  currentValue: MacroAnswerValue | undefined,
  option: string,
  optionOrder: readonly string[],
): string[] {
  const currentValues = Array.isArray(currentValue) ? currentValue : [];
  const toggled = currentValues.includes(option)
    ? currentValues.filter((entry) => entry !== option)
    : [...currentValues, option];
  return sortByOptionOrder(toggled, optionOrder);
}

/**
 * Title tap on a multi-choice checkbox group.
 *
 * Not every option selected: check each option that is not already in the
 * answer, in option order. That is the same sequence as checking those
 * boxes one at a time, so the Other / edit text and the saved SOAP answer
 * match.
 *
 * Every option already selected: clear those options (a second tap).
 */
export function toggleAllMacroCheckboxes(
  currentValue: MacroAnswerValue | undefined,
  optionOrder: readonly string[],
): string[] {
  const choices = macroCheckboxOptions(optionOrder);
  const allOn = choices.length > 0 && choices.every((option) => macroOptionChecked(currentValue, option));
  if (allOn) {
    const currentValues = Array.isArray(currentValue) ? currentValue : [];
    const next = currentValues.filter((entry) => !choices.includes(entry.trim()));
    return sortByOptionOrder(next, optionOrder);
  }
  let next: MacroAnswerValue | undefined = currentValue;
  for (const option of choices) {
    const raw = Array.isArray(next) ? next : [];
    if (!raw.includes(option)) {
      next = toggleMacroCheckbox(next, option, optionOrder);
    }
  }
  return Array.isArray(next) ? next : [];
}
