"use client";

import { useCallback, useEffect, useState } from "react";
import { mergeNarrativeInputDefaults, RECOMMEND_DECOMPRESSION_TOKEN } from "@/lib/narrative-inputs";
import {
  createPromptTokenFromLabel,
  getDefaultNarrativeReportLibrary,
  loadNarrativeReportLibrary,
  saveNarrativeReportLibrary,
  type NarrativePromptInput,
  type NarrativePromptShowWhen,
  type NarrativeReportLibrary,
  type NarrativeReportPrompt,
  type NarrativeReportTemplate,
} from "@/lib/report-templates";

const STORAGE_KEY = "casemate.report-templates.v1";

function createTemplateId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function createPromptId() {
  return `prompt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function readLibrary() {
  return mergeNarrativeInputDefaults(loadNarrativeReportLibrary());
}

export function useReportTemplates() {
  const [reportTemplates, setReportTemplates] = useState<NarrativeReportLibrary>(() => readLibrary());

  // Re-read when the cloud fallback writes the template data
  useEffect(() => {
    const handler = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) {
        setReportTemplates(readLibrary());
      }
    };
    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
  }, []);

  const updateLibrary = useCallback((updater: (current: NarrativeReportLibrary) => NarrativeReportLibrary) => {
    setReportTemplates((current) => {
      const next = updater(current);
      saveNarrativeReportLibrary(next);
      return next;
    });
  }, []);

  const addTemplate = useCallback(
    (nameDraft: string, bodyDraft: string) => {
      const name = nameDraft.trim();
      const body = bodyDraft.trim();
      if (!name || !body) {
        return null;
      }

      let createdId: string | null = null;
      updateLibrary((current) => {
        const duplicate = current.templates.some(
          (entry) => entry.name.toLowerCase() === name.toLowerCase(),
        );
        if (duplicate) {
          return current;
        }
        createdId = createTemplateId("report");
        return {
          ...current,
          templates: [
            ...current.templates,
            {
              id: createdId,
              name,
              body,
              fontFamily: current.templates[0]?.fontFamily ?? "Georgia, 'Times New Roman', serif",
              active: true,
              prompts: [],
            },
          ],
        };
      });

      return createdId;
    },
    [updateLibrary],
  );

  const updateTemplate = useCallback(
    (id: string, patch: Partial<Omit<NarrativeReportTemplate, "id" | "prompts">>) => {
      updateLibrary((current) => ({
        ...current,
        templates: current.templates.map((entry) => {
          if (entry.id !== id) {
            return entry;
          }
          return {
            ...entry,
            ...patch,
            name: patch.name === undefined ? entry.name : patch.name.trim(),
            body: patch.body === undefined ? entry.body : patch.body,
          };
        }),
      }));
    },
    [updateLibrary],
  );

  const removeTemplate = useCallback(
    (id: string) => {
      updateLibrary((current) => {
        const nextTemplates = current.templates.filter((entry) => entry.id !== id);
        if (!nextTemplates.length) {
          return getDefaultNarrativeReportLibrary();
        }
        return {
          ...current,
          templates: nextTemplates,
        };
      });
    },
    [updateLibrary],
  );

  const addPrompt = useCallback(
    (templateId: string, labelDraft: string, options: string[], required: boolean, input?: NarrativePromptInput) => {
      const label = labelDraft.trim();
      if (!label) {
        return false;
      }
      updateLibrary((current) => ({
        ...current,
        templates: current.templates.map((template) => {
          if (template.id !== templateId) {
            return template;
          }

          const tokenBase = createPromptTokenFromLabel(label);
          const usedTokens = new Set(template.prompts.map((entry) => entry.token));
          let token = tokenBase;
          let sequence = 2;
          while (usedTokens.has(token)) {
            token = `${tokenBase}_${sequence}`;
            sequence += 1;
          }

          const nextPrompt: NarrativeReportPrompt = {
            id: createPromptId(),
            label,
            token,
            options: input === "yesno" && options.length === 0 ? ["Yes", "No"] : options,
            required,
            ...(input ? { input } : {}),
          };

          return {
            ...template,
            prompts: [...template.prompts, nextPrompt],
          };
        }),
      }));
      return true;
    },
    [updateLibrary],
  );

  const updatePrompt = useCallback(
    (
      templateId: string,
      promptId: string,
      patch: Partial<Pick<NarrativeReportPrompt, "label" | "required" | "options" | "input">> & {
        showWhen?: NarrativePromptShowWhen | null;
      },
    ) => {
      updateLibrary((current) => ({
        ...current,
        templates: current.templates.map((template) => {
          if (template.id !== templateId) {
            return template;
          }
          const prior = template.prompts.find((prompt) => prompt.id === promptId);
          const nextOptions = patch.options ?? prior?.options ?? [];
          const renames = new Map<string, string>();
          const renamedOptions = patch.options;
          if (renamedOptions && prior && prior.options.length === renamedOptions.length) {
            prior.options.forEach((old, index) => {
              const next = renamedOptions[index];
              if (old && next && old !== next) renames.set(old, next);
            });
          }
          return {
            ...template,
            prompts: template.prompts.map((prompt) => {
              if (prompt.id === promptId) {
                const next: NarrativeReportPrompt = {
                  ...prompt,
                  label: patch.label === undefined ? prompt.label : patch.label,
                  required: patch.required === undefined ? prompt.required : patch.required,
                  options: patch.options === undefined ? prompt.options : patch.options,
                };
                if (patch.input) next.input = patch.input;
                if (patch.showWhen === null) delete next.showWhen;
                else if (patch.showWhen) next.showWhen = patch.showWhen;
                return next;
              }
              if (!patch.options || prompt.showWhen?.promptId !== promptId) return prompt;
              const answers = prompt.showWhen.answers
                .map((answer) => renames.get(answer) ?? answer)
                .filter((answer) => nextOptions.includes(answer));
              if (!answers.length) {
                const { showWhen: _dropped, ...rest } = prompt;
                return rest;
              }
              return { ...prompt, showWhen: { promptId, answers } };
            }),
          };
        }),
      }));
    },
    [updateLibrary],
  );

  const movePrompt = useCallback(
    (templateId: string, promptId: string, direction: -1 | 1) => {
      updateLibrary((current) => ({
        ...current,
        templates: current.templates.map((template) => {
          if (template.id !== templateId) return template;
          const index = template.prompts.findIndex((prompt) => prompt.id === promptId);
          const nextIndex = index + direction;
          if (index < 0 || nextIndex < 0 || nextIndex >= template.prompts.length) return template;
          const prompts = [...template.prompts];
          const [row] = prompts.splice(index, 1);
          prompts.splice(nextIndex, 0, row);
          return { ...template, prompts };
        }),
      }));
    },
    [updateLibrary],
  );

  const removePrompt = useCallback(
    (templateId: string, promptId: string) => {
      updateLibrary((current) => ({
        ...current,
        templates: current.templates.map((template) => {
          if (template.id !== templateId) {
            return template;
          }
          const removed = template.prompts.find((prompt) => prompt.id === promptId);
          const skipped =
            removed?.token === RECOMMEND_DECOMPRESSION_TOKEN
              ? Array.from(new Set([...(template.skippedDefaultTokens ?? []), removed.token]))
              : template.skippedDefaultTokens;
          return {
            ...template,
            ...(skipped?.length ? { skippedDefaultTokens: skipped } : {}),
            prompts: template.prompts
              .filter((prompt) => prompt.id !== promptId)
              .map((prompt) => {
                if (prompt.showWhen?.promptId !== promptId) return prompt;
                const { showWhen: _dropped, ...rest } = prompt;
                return rest;
              }),
          };
        }),
      }));
    },
    [updateLibrary],
  );

  const resetToDefaults = useCallback(() => {
    const defaults = getDefaultNarrativeReportLibrary();
    setReportTemplates(defaults);
    saveNarrativeReportLibrary(defaults);
  }, []);

  return {
    reportTemplates,
    addTemplate,
    updateTemplate,
    removeTemplate,
    addPrompt,
    updatePrompt,
    movePrompt,
    removePrompt,
    resetToDefaults,
  };
}
