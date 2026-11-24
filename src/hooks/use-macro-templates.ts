"use client";

import { useCallback, useState } from "react";
import {
  createEmptyMacro,
  getDefaultMacroLibrary,
  loadMacroLibrary,
  macroAutoFields,
  saveMacroLibrary,
  type MacroAutoField,
  type MacroLibraryConfig,
  type MacroQuestion,
  type MacroSection,
  type MacroTemplate,
} from "@/lib/macro-templates";
import { sanitizeMacroShowIf } from "@/lib/macro-show-if";

export function useMacroTemplates() {
  const [macroLibrary, setMacroLibrary] = useState<MacroLibraryConfig>(() => loadMacroLibrary());

  const updateLibrary = useCallback((updater: (current: MacroLibraryConfig) => MacroLibraryConfig) => {
    setMacroLibrary((current) => {
      const next = updater(current);
      saveMacroLibrary(next);
      return next;
    });
  }, []);

  const setSetName = useCallback(
    (setName: string) => {
      updateLibrary((current) => ({
        ...current,
        setName,
      }));
    },
    [updateLibrary],
  );

  const toggleAutoField = useCallback(
    (field: MacroAutoField) => {
      updateLibrary((current) => {
        const exists = current.enabledAutoFields.includes(field);
        const next = exists
          ? current.enabledAutoFields.filter((entry) => entry !== field)
          : [...current.enabledAutoFields, field];

        if (!next.length) {
          return current;
        }

        const rank = new Map(macroAutoFields.map((entry, index) => [entry, index]));
        next.sort((left, right) => (rank.get(left) ?? 0) - (rank.get(right) ?? 0));

        return {
          ...current,
          enabledAutoFields: next,
        };
      });
    },
    [updateLibrary],
  );

  const addMacro = useCallback(
    (section: MacroSection, folder?: string) => {
      const newMacro = createEmptyMacro(section, folder);
      updateLibrary((current) => ({
        ...current,
        templates: [...current.templates, newMacro],
      }));
      return newMacro.id;
    },
    [updateLibrary],
  );

  const updateMacro = useCallback(
    (macroId: string, updater: (current: MacroTemplate) => MacroTemplate) => {
      updateLibrary((current) => ({
        ...current,
        templates: current.templates.map((template) => {
          if (template.id !== macroId) {
            return template;
          }
          const next = updater(template);
          const questions = sanitizeMacroShowIf(next.questions);
          const same =
            questions.length === next.questions.length &&
            questions.every((question, index) => question === next.questions[index]);
          return same ? next : { ...next, questions };
        }),
      }));
    },
    [updateLibrary],
  );

  const deleteMacro = useCallback(
    (macroId: string) => {
      updateLibrary((current) => ({
        ...current,
        templates: current.templates.filter((template) => template.id !== macroId),
      }));
    },
    [updateLibrary],
  );

  const addQuestion = useCallback(
    (macroId: string, question: MacroQuestion) => {
      updateMacro(macroId, (current) => {
        if (current.questions.some((entry) => entry.id === question.id)) {
          return current;
        }
        return {
          ...current,
          questions: [...current.questions, question],
        };
      });
    },
    [updateMacro],
  );

  const updateQuestion = useCallback(
    (macroId: string, questionId: string, updater: (current: MacroQuestion) => MacroQuestion) => {
      updateMacro(macroId, (current) => ({
        ...current,
        questions: current.questions.map((question) =>
          question.id === questionId ? updater(question) : question,
        ),
      }));
    },
    [updateMacro],
  );

  const removeQuestion = useCallback(
    (macroId: string, questionId: string) => {
      updateMacro(macroId, (current) => ({
        ...current,
        questions: current.questions.filter((question) => question.id !== questionId),
      }));
    },
    [updateMacro],
  );

  const moveQuestion = useCallback(
    (macroId: string, questionId: string, direction: "up" | "down") => {
      updateMacro(macroId, (current) => {
        const idx = current.questions.findIndex((q) => q.id === questionId);
        if (idx < 0) return current;
        const targetIdx = direction === "up" ? idx - 1 : idx + 1;
        if (targetIdx < 0 || targetIdx >= current.questions.length) return current;
        const next = [...current.questions];
        [next[idx], next[targetIdx]] = [next[targetIdx], next[idx]];
        return { ...current, questions: next };
      });
    },
    [updateMacro],
  );

  /**
   * Move a question's option from `fromIndex` to land immediately before
   * `toIndex` in the options array. Used by drag-to-reorder of the option
   * pills under each prompt. optionCharges links live on the option label,
   * so reordering does NOT touch optionCharges — the linked CPT follows
   * the option to its new position automatically.
   */
  const moveOption = useCallback(
    (macroId: string, questionId: string, fromIndex: number, toIndex: number) => {
      if (fromIndex === toIndex) return;
      updateMacro(macroId, (current) => ({
        ...current,
        questions: current.questions.map((question) => {
          if (question.id !== questionId) return question;
          if (
            fromIndex < 0 ||
            fromIndex >= question.options.length ||
            toIndex < 0 ||
            toIndex >= question.options.length
          ) {
            return question;
          }
          const next = [...question.options];
          const [moved] = next.splice(fromIndex, 1);
          next.splice(toIndex, 0, moved);
          return { ...question, options: next };
        }),
      }));
    },
    [updateMacro],
  );

  /**
   * Move macro `sourceId` so it sits immediately before `targetId` in the
   * templates array. Only reorders within the same section + folder —
   * cross-folder drags are ignored (those need a folder reassignment,
   * which is a different flow). This is what drives drag-to-reorder of
   * the macro chips shown while writing an encounter: new macros no
   * longer have to stay pinned at the end of the list.
   */
  const reorderMacroInSection = useCallback(
    (sourceId: string, targetId: string) => {
      updateLibrary((current) => {
        if (sourceId === targetId) return current;
        const source = current.templates.find((t) => t.id === sourceId);
        const target = current.templates.find((t) => t.id === targetId);
        if (!source || !target) return current;
        if (source.section !== target.section) return current;
        if ((source.folder ?? "") !== (target.folder ?? "")) return current;
        const without = current.templates.filter((t) => t.id !== sourceId);
        const targetIdx = without.findIndex((t) => t.id === targetId);
        if (targetIdx < 0) return current;
        const next = [...without];
        next.splice(targetIdx, 0, source);
        return { ...current, templates: next };
      });
    },
    [updateLibrary],
  );

  const resetToDefaults = useCallback(() => {
    const defaults = getDefaultMacroLibrary();
    setMacroLibrary(defaults);
    saveMacroLibrary(defaults);
  }, []);

  return {
    macroLibrary,
    setSetName,
    setSaltOnCreateDefault: (enabled: boolean) =>
      updateLibrary((current) => ({
        ...current,
        saltDefaults: {
          ...current.saltDefaults,
          enabled,
        },
      })),
    toggleSaltSectionDefault: (section: MacroSection) =>
      updateLibrary((current) => ({
        ...current,
        saltDefaults: {
          ...current.saltDefaults,
          sections: {
            ...current.saltDefaults.sections,
            [section]: !current.saltDefaults.sections[section],
          },
        },
      })),
    toggleAutoField,
    addMacro,
    updateMacro,
    deleteMacro,
    addQuestion,
    updateQuestion,
    removeQuestion,
    moveQuestion,
    moveOption,
    reorderMacroInSection,
    resetToDefaults,
  };
}
