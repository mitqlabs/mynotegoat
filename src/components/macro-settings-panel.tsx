"use client";

import { useRef, useMemo, useState } from "react";
import { useBillingMacros } from "@/hooks/use-billing-macros";
import { useMacroTemplates } from "@/hooks/use-macro-templates";
import { RichTextTemplateEditor, type RichTextTemplateEditorHandle } from "@/components/rich-text-template-editor";
import {
  createQuestionId,
  getQuestionIdsFromBody,
  getMacroFolderNames,
  groupMacrosByFolder,
  insertAutoFieldToken,
  insertQuestionToken,
  macroAutoFields,
  macroAutoFieldLabels,
  macroSectionLabels,
  macroSections,
  renderMacroTemplate,
  type MacroAnswerMap,
  type MacroSection,
} from "@/lib/macro-templates";

type MacroTestContext = {
  id: string;
  label: string;
  context: Record<string, string>;
};

const macroTestContexts: MacroTestContext[] = [
  {
    id: "john-doe",
    label: "John Doe",
    context: {
      FIRST_NAME: "John",
      LAST_NAME: "Doe",
      FULL_NAME: "John Doe",
      AGE: "35",
      SEX: "Male",
      DOB: "05/12/1990",
      INJURY_DATE: "03/01/2026",
      ATTORNEY: "Doe & Associates",
      HE_SHE: "he",
      HIM_HER: "him",
      HIS_HER: "his",
      MR_MRS_MS_LAST_NAME: "Mr. Doe",
    },
  },
  {
    id: "jane-doe",
    label: "Jane Doe",
    context: {
      FIRST_NAME: "Jane",
      LAST_NAME: "Doe",
      FULL_NAME: "Jane Doe",
      AGE: "34",
      SEX: "Female",
      DOB: "09/23/1991",
      INJURY_DATE: "02/14/2026",
      ATTORNEY: "Acme Legal Group",
      HE_SHE: "she",
      HIM_HER: "her",
      HIS_HER: "her",
      MR_MRS_MS_LAST_NAME: "Ms. Doe",
    },
  },
];

function buildMacroContext(patientId: string): Record<string, string> {
  const selectedContext = macroTestContexts.find((entry) => entry.id === patientId);
  return selectedContext?.context ?? macroTestContexts[0]?.context ?? {};
}

export function MacroSettingsPanel() {
  const {
    macroLibrary,
    setSetName,
    setSaltOnCreateDefault,
    toggleSaltSectionDefault,
    toggleAutoField,
    addMacro,
    updateMacro,
    deleteMacro,
    addQuestion,
    updateQuestion,
    removeQuestion,
    moveQuestion,
    resetToDefaults,
  } = useMacroTemplates();

  const editorRef = useRef<RichTextTemplateEditorHandle>(null);

  // Source of truth for the linked-charge picker: the same Billing Macro
  // treatment list the encounter workspace uses. Keeping this in sync means
  // a CPT/price change in Billing Macros automatically flows through to
  // anything this macro links to — no duplicate typing, no drift.
  const { billingMacros } = useBillingMacros();
  const activeTreatments = useMemo(
    () => billingMacros.treatments.filter((t) => t.active),
    [billingMacros.treatments],
  );
  // Which option pill currently has its charge-picker popover open.
  // Tracked by questionId + option label so each pill can independently
  // show its own picker without a mess of per-option state.
  const [chargePickerFor, setChargePickerFor] = useState<
    { questionId: string; option: string } | null
  >(null);
  const [chargePickerSearch, setChargePickerSearch] = useState("");
  const [activeSection, setActiveSection] = useState<MacroSection>("subjective");
  const [selectedMacroId, setSelectedMacroId] = useState<string | null>(null);
  const [questionLabelDraft, setQuestionLabelDraft] = useState("");
  const [questionOptionsDraft, setQuestionOptionsDraft] = useState("");
  const [questionMultiSelectDraft, setQuestionMultiSelectDraft] = useState(false);
  const [questionOptionsDrafts, setQuestionOptionsDrafts] = useState<Record<string, string>>({});
  const [newChoiceDrafts, setNewChoiceDrafts] = useState<Record<string, string>>({});

  const [testPatientId, setTestPatientId] = useState(macroTestContexts[0]?.id ?? "");
  const [runOpen, setRunOpen] = useState(false);
  const [answers, setAnswers] = useState<MacroAnswerMap>({});
  const [generatedOutput, setGeneratedOutput] = useState("");
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(new Set());
  const [newFolderDraft, setNewFolderDraft] = useState("");
  const [showNewFolderInput, setShowNewFolderInput] = useState(false);

  const sectionMacros = useMemo(
    () => macroLibrary.templates.filter((template) => template.section === activeSection),
    [activeSection, macroLibrary.templates],
  );

  const sectionFolderGroups = useMemo(
    () => groupMacrosByFolder(sectionMacros),
    [sectionMacros],
  );

  const sectionFolderNames = useMemo(
    () => getMacroFolderNames(sectionMacros),
    [sectionMacros],
  );

  const toggleFolderCollapse = (folderName: string) => {
    setCollapsedFolders((current) => {
      const next = new Set(current);
      if (next.has(folderName)) {
        next.delete(folderName);
      } else {
        next.add(folderName);
      }
      return next;
    });
  };

  const handleAddFolder = () => {
    const name = newFolderDraft.trim();
    if (!name) return;
    // Create a new macro inside the folder so the folder appears
    const newId = addMacro(activeSection, name);
    setSelectedMacroId(newId);
    setNewFolderDraft("");
    setShowNewFolderInput(false);
  };

  const resolvedSelectedMacroId = useMemo(() => {
    if (selectedMacroId && sectionMacros.some((macro) => macro.id === selectedMacroId)) {
      return selectedMacroId;
    }
    return sectionMacros[0]?.id ?? null;
  }, [sectionMacros, selectedMacroId]);

  const selectedMacro = useMemo(
    () => macroLibrary.templates.find((template) => template.id === resolvedSelectedMacroId) ?? null,
    [macroLibrary.templates, resolvedSelectedMacroId],
  );

  const questionIdsInBody = useMemo(
    () => (selectedMacro ? getQuestionIdsFromBody(selectedMacro.body) : []),
    [selectedMacro],
  );
  const unknownQuestionIds = useMemo(() => {
    if (!selectedMacro) {
      return [];
    }
    const knownIds = new Set(selectedMacro.questions.map((question) => question.id));
    return questionIdsInBody.filter((questionId) => !knownIds.has(questionId));
  }, [questionIdsInBody, selectedMacro]);

  const enabledAutoFields = useMemo(
    () =>
      macroLibrary.enabledAutoFields.length > 0 ? macroLibrary.enabledAutoFields : [...macroAutoFields],
    [macroLibrary.enabledAutoFields],
  );

  const appendToBody = (snippet: string) => {
    if (!selectedMacro) {
      return;
    }
    if (editorRef.current) {
      editorRef.current.insertText(snippet);
    } else {
      updateMacro(selectedMacro.id, (current) => ({
        ...current,
        body: current.body ? `${current.body}${current.body.endsWith("\n") ? "" : " "}${snippet}` : snippet,
      }));
    }
  };

  const parseQuestionOptions = (value: string) =>
    value
      .split(",")
      .map((option) => option.trim())
      .filter((option) => option.length > 0);

  const getQuestionDraftKey = (macroId: string, questionId: string) => `${macroId}::${questionId}`;

  const commitQuestionOptionsDraft = (macroId: string, questionId: string) => {
    const key = getQuestionDraftKey(macroId, questionId);
    const draft = questionOptionsDrafts[key];
    if (draft === undefined) {
      return;
    }
    updateQuestion(macroId, questionId, (current) => ({
      ...current,
      options: parseQuestionOptions(draft),
    }));
    setQuestionOptionsDrafts((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
  };

  const handleAddMacro = () => {
    const newId = addMacro(activeSection);
    setSelectedMacroId(newId);
  };

  const handleCopyMacro = () => {
    if (!selectedMacro) return;
    const newId = addMacro(activeSection);
    updateMacro(newId, () => ({
      ...selectedMacro,
      id: newId,
      buttonName: `${selectedMacro.buttonName} (copy)`,
      questions: selectedMacro.questions.map((q) => ({ ...q })),
    }));
    setSelectedMacroId(newId);
  };

  const handleDeleteMacro = () => {
    if (!selectedMacro) {
      return;
    }
    if (!window.confirm(`Delete macro "${selectedMacro.buttonName}"? This cannot be undone.`)) {
      return;
    }
    deleteMacro(selectedMacro.id);
  };

  const handleAddQuestion = () => {
    if (!selectedMacro) {
      return;
    }
    const label = questionLabelDraft.trim();
    if (!label) {
      return;
    }
    const id = createQuestionId(label);
    const options = parseQuestionOptions(questionOptionsDraft);
    addQuestion(selectedMacro.id, {
      id,
      label,
      options,
      multiSelect: questionMultiSelectDraft,
    });
    appendToBody(insertQuestionToken(id));
    setQuestionLabelDraft("");
    setQuestionOptionsDraft("");
    setQuestionMultiSelectDraft(false);
  };

  const openRunModal = () => {
    if (!selectedMacro) {
      return;
    }
    const initialAnswers: MacroAnswerMap = {};
    selectedMacro.questions.forEach((question) => {
      if (question.multiSelect) {
        initialAnswers[question.id] = [];
        return;
      }
      initialAnswers[question.id] = question.options[0] ?? "";
    });
    setAnswers(initialAnswers);
    setRunOpen(true);
  };

  const runMacro = () => {
    if (!selectedMacro) {
      return;
    }
    const context = buildMacroContext(testPatientId);
    setGeneratedOutput(renderMacroTemplate(selectedMacro.body, answers, context));
    setRunOpen(false);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <button
          className="rounded-xl border border-[var(--line-soft)] bg-white px-4 py-2 font-semibold transition-all active:scale-[0.97] active:shadow-inner"
          onClick={() => { if (window.confirm("Are you sure you want to reset to defaults? This will overwrite your current settings.")) resetToDefaults(); }}
          type="button"
        >
          Reset Macro Defaults
        </button>
      </div>

      <div className="grid gap-3 rounded-xl border border-[var(--line-soft)] bg-white p-3 md:grid-cols-[200px_1fr]">
        <label className="grid gap-1">
          <span className="text-sm font-semibold text-[var(--text-muted)]">Set Name</span>
          <input
            className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
            onChange={(event) => setSetName(event.target.value)}
            value={macroLibrary.setName}
          />
        </label>

        <label className="grid gap-1">
          <span className="text-sm font-semibold text-[var(--text-muted)]">Test Patient Context</span>
          <select
            className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
            onChange={(event) => setTestPatientId(event.target.value)}
            value={testPatientId}
          >
            {macroTestContexts.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="rounded-xl border border-[var(--line-soft)] bg-[var(--bg-soft)] p-3">
        <p className="text-sm font-semibold">Encounter SALT Defaults</p>
        <p className="mt-1 text-xs text-[var(--text-muted)]">
          Controls which SOAP sections are auto-carried from the most recent prior encounter when creating a new
          encounter from Patient File.
        </p>
        <label className="mt-3 inline-flex items-center gap-2 text-sm font-semibold">
          <input
            checked={macroLibrary.saltDefaults.enabled}
            onChange={(event) => setSaltOnCreateDefault(event.target.checked)}
            type="checkbox"
          />
          SALT from most recent prior encounter when creating new encounter
        </label>
        <div className="mt-2 flex flex-wrap gap-2">
          {macroSections.map((section) => (
            <label
              key={`macro-settings-default-salt-${section}`}
              className="inline-flex items-center gap-2 rounded-lg border border-[var(--line-soft)] bg-white px-2 py-1 text-sm font-semibold"
            >
              <input
                checked={macroLibrary.saltDefaults.sections[section]}
                disabled={!macroLibrary.saltDefaults.enabled}
                onChange={() => toggleSaltSectionDefault(section)}
                type="checkbox"
              />
              {macroSectionLabels[section]}
            </label>
          ))}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {macroSections.map((section) => (
          <button
            key={section}
            className={`rounded-xl px-4 py-2 text-sm font-semibold ${
              activeSection === section ? "bg-[var(--brand-primary)] text-white" : "bg-[var(--bg-soft)]"
            }`}
            onClick={() => setActiveSection(section)}
            type="button"
          >
            {macroSectionLabels[section]}
          </button>
        ))}
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[1fr_1.5fr]">
        <article className="rounded-xl border border-[var(--line-soft)] bg-white p-3">
          <div className="mb-3 flex items-center justify-between">
            <h4 className="text-lg font-semibold">{macroSectionLabels[activeSection]} Macros</h4>
            <div className="flex gap-1">
              <button
                className="rounded-lg border border-[var(--line-soft)] px-3 py-1 text-sm font-semibold"
                onClick={() => { setShowNewFolderInput(true); setNewFolderDraft(""); }}
                type="button"
              >
                + Folder
              </button>
              <button
                className="rounded-lg border border-[var(--line-soft)] px-3 py-1 text-sm font-semibold"
                onClick={handleAddMacro}
                type="button"
              >
                + Macro
              </button>
            </div>
          </div>

          {/* New folder input */}
          {showNewFolderInput && (
            <form
              className="mb-3 flex items-center gap-2"
              onSubmit={(e) => { e.preventDefault(); handleAddFolder(); }}
            >
              <input
                autoFocus
                className="w-full rounded-lg border border-[var(--line-soft)] bg-white px-2 py-1.5 text-sm"
                onChange={(e) => setNewFolderDraft(e.target.value)}
                placeholder="Folder name (e.g., Treatments)"
                value={newFolderDraft}
              />
              <button className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white" type="submit">Create</button>
              <button className="rounded-lg border border-[var(--line-soft)] px-3 py-1.5 text-sm" onClick={() => setShowNewFolderInput(false)} type="button">Cancel</button>
            </form>
          )}

          {/* Folder-grouped macro list */}
          <div className="space-y-3">
            {sectionFolderGroups.map((group) => {
              const isUngrouped = group.folder === "";
              const isCollapsed = !isUngrouped && collapsedFolders.has(group.folder);

              return (
                <div key={group.folder || "__ungrouped__"}>
                  {/* Folder header */}
                  {!isUngrouped && (
                    <button
                      className="mb-1.5 flex w-full items-center gap-1.5 rounded-lg bg-[var(--bg-soft)] px-2 py-1.5 text-left text-xs font-bold uppercase tracking-wide text-[var(--text-muted)] hover:bg-blue-50"
                      onClick={() => toggleFolderCollapse(group.folder)}
                      type="button"
                    >
                      <svg
                        className={`h-3 w-3 shrink-0 transition-transform ${isCollapsed ? "" : "rotate-90"}`}
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={2.5}
                        viewBox="0 0 24 24"
                      >
                        <path d="m9 5 7 7-7 7" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                      {group.folder}
                      <span className="ml-auto text-[10px] font-medium text-[var(--text-muted)]">{group.macros.length}</span>
                    </button>
                  )}

                  {/* Macro buttons */}
                  {!isCollapsed && (
                    <div className="grid gap-2 sm:grid-cols-2">
                      {group.macros.map((macro) => (
                        <button
                          key={macro.id}
                          className={`rounded-xl border px-3 py-2 text-left font-semibold text-sm ${
                            selectedMacroId === macro.id
                              ? "border-[var(--brand-primary)] bg-[var(--bg-soft)]"
                              : "border-[var(--line-soft)] bg-white"
                          }`}
                          onClick={() => setSelectedMacroId(macro.id)}
                          type="button"
                        >
                          {macro.buttonName}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {sectionMacros.length === 0 && (
            <p className="mt-3 text-sm text-[var(--text-muted)]">No macros in this section yet.</p>
          )}
        </article>

        <article className="rounded-xl border border-[var(--line-soft)] bg-white p-3">
          {!selectedMacro && <p className="text-sm text-[var(--text-muted)]">Select or create a macro to edit.</p>}

          {selectedMacro && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h4 className="text-lg font-semibold">Edit Macro</h4>
                <div className="flex gap-2">
                  <button
                    className="rounded-lg border border-[var(--line-soft)] px-3 py-1 text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                    onClick={handleCopyMacro}
                    type="button"
                  >
                    Copy Macro
                  </button>
                  <button
                    className="rounded-lg border border-[var(--line-soft)] px-3 py-1 text-sm font-semibold"
                    onClick={openRunModal}
                    type="button"
                  >
                    Run Macro
                  </button>
                  <button
                    className="rounded-lg border border-[var(--line-soft)] px-3 py-1 text-sm font-semibold"
                    onClick={handleDeleteMacro}
                    type="button"
                  >
                    Delete
                  </button>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="grid gap-1">
                  <span className="text-sm font-semibold text-[var(--text-muted)]">Button Name</span>
                  <input
                    className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
                    onChange={(event) =>
                      updateMacro(selectedMacro.id, (current) => ({
                        ...current,
                        buttonName: event.target.value,
                      }))
                    }
                    value={selectedMacro.buttonName}
                  />
                </label>
                <label className="grid gap-1">
                  <span className="text-sm font-semibold text-[var(--text-muted)]">Folder</span>
                  <div className="flex gap-1">
                    <input
                      className="flex-1 rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
                      list={`folder-suggestions-${selectedMacro.id}`}
                      onChange={(event) =>
                        updateMacro(selectedMacro.id, (current) => ({
                          ...current,
                          folder: event.target.value.trim() || undefined,
                        }))
                      }
                      placeholder="None (top-level)"
                      value={selectedMacro.folder ?? ""}
                    />
                    <datalist id={`folder-suggestions-${selectedMacro.id}`}>
                      {sectionFolderNames.map((name) => (
                        <option key={name} value={name} />
                      ))}
                    </datalist>
                    {selectedMacro.folder && (
                      <button
                        className="rounded-lg border border-[var(--line-soft)] px-2 py-1 text-xs text-[var(--text-muted)] hover:text-[var(--text-heading)]"
                        onClick={() => updateMacro(selectedMacro.id, (current) => ({ ...current, folder: undefined }))}
                        title="Remove from folder"
                        type="button"
                      >
                        &times;
                      </button>
                    )}
                  </div>
                </label>
              </div>

              <div className="grid gap-1">
                <span className="text-sm font-semibold text-[var(--text-muted)]">Template Body</span>
                <RichTextTemplateEditor
                  ref={editorRef}
                  value={selectedMacro.body}
                  onChange={(nextValue) =>
                    updateMacro(selectedMacro.id, (current) => ({
                      ...current,
                      body: nextValue,
                    }))
                  }
                  minHeightClassName="min-h-44"
                  placeholder="Write your macro template..."
                />
              </div>

              <div className="rounded-xl border border-[var(--line-soft)] bg-[var(--bg-soft)] p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold">Choose Your Auto Fields</p>
                  <p className="text-xs text-[var(--text-muted)]">Selected: {enabledAutoFields.length}</p>
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {macroAutoFields.map((field) => {
                    const selected = enabledAutoFields.includes(field);
                    return (
                      <button
                        key={`enable-${field}`}
                        className={`rounded-lg border px-2 py-1 text-xs font-semibold ${
                          selected
                            ? "border-[var(--brand-primary)] bg-[#e9f4fb] text-[var(--brand-primary)]"
                            : "border-[var(--line-soft)] bg-white text-[var(--text-main)]"
                        }`}
                        onClick={() => toggleAutoField(field)}
                        title={macroAutoFieldLabels[field]}
                        type="button"
                      >
                        {selected ? "✓ " : ""}
                        {field}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="rounded-xl border border-[var(--line-soft)] bg-[var(--bg-soft)] p-3">
                <p className="text-sm font-semibold">Insert Auto Fields</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {enabledAutoFields.map((field) => (
                    <button
                      key={field}
                      className="rounded-lg border border-[var(--line-soft)] bg-white px-2 py-1 text-xs font-semibold"
                      onClick={() => appendToBody(insertAutoFieldToken(field))}
                      title={macroAutoFieldLabels[field]}
                      type="button"
                    >
                      {field}
                    </button>
                  ))}
                </div>
              </div>

              <div className="rounded-xl border border-[var(--line-soft)] bg-[var(--bg-soft)] p-3">
                <p className="text-sm font-semibold">Question Prompts</p>
                <div className="mt-2 grid gap-2 md:grid-cols-[1fr_1fr_auto_auto]">
                  <input
                    className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
                    onChange={(event) => setQuestionLabelDraft(event.target.value)}
                    placeholder="Question label (e.g. Where were you seated?)"
                    value={questionLabelDraft}
                  />
                  <input
                    className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
                    onChange={(event) => setQuestionOptionsDraft(event.target.value)}
                    placeholder="Options comma-separated (optional)"
                    value={questionOptionsDraft}
                  />
                  <label className="inline-flex items-center gap-2 rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2 text-sm font-semibold">
                    <input
                      checked={questionMultiSelectDraft}
                      onChange={(event) => setQuestionMultiSelectDraft(event.target.checked)}
                      type="checkbox"
                    />
                    Multi-select
                  </label>
                  <button
                    className="rounded-xl border border-[var(--line-soft)] bg-white px-4 py-2 font-semibold transition-all active:scale-[0.97] active:shadow-inner"
                    onClick={handleAddQuestion}
                    type="button"
                  >
                    Add
                  </button>
                </div>

                <div className="mt-3 space-y-2">
                  {selectedMacro.questions.map((question, questionIndex) => {
                    const choiceKey = `${selectedMacro.id}::${question.id}`;
                    const choiceDraft = newChoiceDrafts[choiceKey] ?? "";
                    const isFirst = questionIndex === 0;
                    const isLast = questionIndex === selectedMacro.questions.length - 1;
                    const addChoice = () => {
                      const value = choiceDraft.trim();
                      if (!value) return;
                      updateQuestion(selectedMacro.id, question.id, (current) => ({
                        ...current,
                        options: [...current.options, value],
                      }));
                      setNewChoiceDrafts((c) => ({ ...c, [choiceKey]: "" }));
                    };
                    return (
                    <div
                      key={question.id}
                      className="rounded-xl border border-[var(--line-soft)] bg-white p-2 space-y-2"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        {/* Move up/down arrows */}
                        <div className="flex flex-col gap-0.5">
                          <button
                            className="rounded border border-[var(--line-soft)] px-1 py-0 text-xs leading-none text-[var(--text-muted)] hover:bg-[var(--bg-soft)] disabled:opacity-30"
                            disabled={isFirst}
                            onClick={() => moveQuestion(selectedMacro.id, question.id, "up")}
                            title="Move up"
                            type="button"
                          >
                            ▲
                          </button>
                          <button
                            className="rounded border border-[var(--line-soft)] px-1 py-0 text-xs leading-none text-[var(--text-muted)] hover:bg-[var(--bg-soft)] disabled:opacity-30"
                            disabled={isLast}
                            onClick={() => moveQuestion(selectedMacro.id, question.id, "down")}
                            title="Move down"
                            type="button"
                          >
                            ▼
                          </button>
                        </div>
                        <input
                          className="flex-1 rounded-lg border border-[var(--line-soft)] px-2 py-1 font-semibold"
                          onChange={(event) =>
                            updateQuestion(selectedMacro.id, question.id, (current) => ({
                              ...current,
                              label: event.target.value,
                            }))
                          }
                          value={question.label}
                        />
                        <label className="inline-flex items-center gap-1.5 text-xs font-semibold">
                          <input
                            checked={question.multiSelect === true}
                            onChange={(event) =>
                              updateQuestion(selectedMacro.id, question.id, (current) => ({
                                ...current,
                                multiSelect: event.target.checked,
                              }))
                            }
                            type="checkbox"
                          />
                          Multi
                        </label>
                        {/* Opt-in: only questions marked "Links charges" show
                            the per-option $ picker below. Hides visual clutter
                            for the vast majority of questions that don't trigger
                            encounter charges (e.g. "Patient reports:"). */}
                        <label
                          className="inline-flex items-center gap-1.5 text-xs font-semibold"
                          title="Enable per-option encounter charge linking for this question"
                        >
                          <input
                            checked={question.linksCharges === true}
                            onChange={(event) =>
                              updateQuestion(selectedMacro.id, question.id, (current) => ({
                                ...current,
                                linksCharges: event.target.checked || undefined,
                              }))
                            }
                            type="checkbox"
                          />
                          Links charges
                        </label>
                        <button
                          className="rounded-lg border border-[var(--line-soft)] px-2 py-0.5 text-xs"
                          onClick={() => appendToBody(insertQuestionToken(question.id))}
                          type="button"
                        >
                          Insert Token
                        </button>
                        <button
                          className="rounded-lg border border-[var(--line-soft)] px-2 py-0.5 text-xs text-[#b43b34]"
                          onClick={() => { if (window.confirm(`Remove question "${question.label}"?`)) removeQuestion(selectedMacro.id, question.id); }}
                          type="button"
                        >
                          Remove
                        </button>
                      </div>

                      {/* Option pills with per-option linked-charge support.
                          Each pill shows its option text and a small "$" badge
                          whose color indicates whether a charge is linked.
                          Clicking the $ opens a popover picker for THIS option
                          only — picking a Billing Macro treatment writes it
                          into optionCharges[optionLabel] so that at macro run
                          time this specific answer auto-adds that charge. */}
                      <div className="flex flex-wrap gap-1">
                        {question.options.map((option, optIndex) => {
                          // Only treat as "linked" visually if the question
                          // has opted into charge linking. Stale optionCharges
                          // data from a toggled-off question should look neutral.
                          const rawLink = question.optionCharges?.[option];
                          const linked = question.linksCharges ? rawLink : undefined;
                          const pickerOpen =
                            chargePickerFor?.questionId === question.id &&
                            chargePickerFor?.option === option;
                          return (
                            <span
                              key={`${question.id}-opt-${optIndex}`}
                              className={`inline-flex items-center gap-1 rounded-lg border px-2 py-0.5 text-xs ${
                                linked
                                  ? "border-emerald-400 bg-emerald-50"
                                  : "border-[var(--line-soft)] bg-[var(--bg-soft)]"
                              }`}
                              title={
                                linked
                                  ? `Linked charge: ${linked.procedureCode} ${linked.name} — $${linked.unitPrice.toFixed(2)}`
                                  : "No linked charge"
                              }
                            >
                              {option}
                              {/* $ picker and linked-CPT badge only render
                                  when this question has opted in via the
                                  "Links charges" toggle. Keeps unrelated
                                  questions visually clean. */}
                              {question.linksCharges && linked && (
                                <span className="rounded bg-emerald-200 px-1 py-0 font-mono text-[10px] font-semibold text-emerald-900">
                                  {linked.procedureCode}
                                </span>
                              )}
                              {question.linksCharges && (
                                <button
                                  className={`ml-0.5 text-xs font-bold ${
                                    linked
                                      ? "text-emerald-700 hover:text-emerald-900"
                                      : "text-[var(--text-muted)] hover:text-[var(--brand-primary)]"
                                  }`}
                                  onClick={() => {
                                    if (pickerOpen) {
                                      setChargePickerFor(null);
                                    } else {
                                      setChargePickerFor({
                                        questionId: question.id,
                                        option,
                                      });
                                      setChargePickerSearch("");
                                    }
                                  }}
                                  title={linked ? "Change or unlink charge" : "Link a charge"}
                                  type="button"
                                >
                                  $
                                </button>
                              )}
                              <button
                                className="ml-0.5 text-[var(--text-muted)] hover:text-[#b43b34]"
                                onClick={() =>
                                  updateQuestion(selectedMacro.id, question.id, (current) => {
                                    const nextOptionCharges = { ...(current.optionCharges ?? {}) };
                                    delete nextOptionCharges[option];
                                    const hasAny = Object.keys(nextOptionCharges).length > 0;
                                    return {
                                      ...current,
                                      options: current.options.filter((_, i) => i !== optIndex),
                                      ...(hasAny ? { optionCharges: nextOptionCharges } : { optionCharges: undefined }),
                                    };
                                  })
                                }
                                type="button"
                              >
                                ×
                              </button>
                            </span>
                          );
                        })}
                      </div>

                      {/* Per-option charge picker popover. Shows below the
                          options row for the currently-selected option only.
                          Search by name / CPT and click a treatment to link.
                          "Unlink" clears the entry. Only renders when this
                          question has opted in via "Links charges". */}
                      {question.linksCharges &&
                        chargePickerFor?.questionId === question.id &&
                        question.options.includes(chargePickerFor.option) && (
                          <div className="rounded-xl border border-emerald-300 bg-white p-2">
                            <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs">
                              <span className="font-semibold">
                                Link charge to option:{" "}
                                <span className="rounded bg-emerald-100 px-1.5 py-0.5">
                                  {chargePickerFor.option}
                                </span>
                              </span>
                              <div className="flex gap-1">
                                {question.optionCharges?.[chargePickerFor.option] && (
                                  <button
                                    className="rounded-lg border border-[var(--line-soft)] bg-white px-2 py-0.5 font-semibold text-[#b43b34] hover:bg-red-50"
                                    onClick={() => {
                                      const optLabel = chargePickerFor.option;
                                      updateQuestion(selectedMacro.id, question.id, (current) => {
                                        const nextOptionCharges = { ...(current.optionCharges ?? {}) };
                                        delete nextOptionCharges[optLabel];
                                        const hasAny = Object.keys(nextOptionCharges).length > 0;
                                        return {
                                          ...current,
                                          ...(hasAny
                                            ? { optionCharges: nextOptionCharges }
                                            : { optionCharges: undefined }),
                                        };
                                      });
                                      setChargePickerFor(null);
                                    }}
                                    type="button"
                                  >
                                    Unlink
                                  </button>
                                )}
                                <button
                                  className="rounded-lg border border-[var(--line-soft)] bg-white px-2 py-0.5 font-semibold text-[var(--text-muted)]"
                                  onClick={() => setChargePickerFor(null)}
                                  type="button"
                                >
                                  Close
                                </button>
                              </div>
                            </div>
                            {activeTreatments.length === 0 ? (
                              <p className="rounded-lg border border-dashed border-[var(--line-soft)] px-3 py-2 text-xs text-[var(--text-muted)]">
                                No treatment charges yet. Add them in{" "}
                                <strong>Settings → Billing Macro Settings → Treatments</strong>,
                                then come back here to link one.
                              </p>
                            ) : (
                              <>
                                <input
                                  autoFocus
                                  className="mb-2 w-full rounded-lg border border-[var(--line-soft)] bg-white px-2 py-1 text-xs"
                                  onChange={(event) => setChargePickerSearch(event.target.value)}
                                  placeholder="Search by name or CPT..."
                                  value={chargePickerSearch}
                                />
                                <div className="max-h-40 overflow-y-auto rounded-lg border border-[var(--line-soft)]">
                                  {(() => {
                                    const q = chargePickerSearch.trim().toLowerCase();
                                    const filtered = q
                                      ? activeTreatments.filter(
                                          (t) =>
                                            t.name.toLowerCase().includes(q) ||
                                            t.procedureCode.toLowerCase().includes(q),
                                        )
                                      : activeTreatments;
                                    if (!filtered.length) {
                                      return (
                                        <p className="px-2 py-1.5 text-xs text-[var(--text-muted)]">
                                          No treatments match &ldquo;{chargePickerSearch}&rdquo;.
                                        </p>
                                      );
                                    }
                                    return filtered.map((treatment) => {
                                      const current =
                                        question.optionCharges?.[chargePickerFor.option];
                                      const isCurrent =
                                        current?.procedureCode === treatment.procedureCode;
                                      return (
                                        <button
                                          className={`flex w-full items-center gap-2 border-b border-[var(--line-soft)] px-2 py-1.5 text-left text-xs last:border-b-0 hover:bg-emerald-50 ${
                                            isCurrent ? "bg-emerald-50" : "bg-white"
                                          }`}
                                          key={treatment.id}
                                          onClick={() => {
                                            const optLabel = chargePickerFor.option;
                                            updateQuestion(
                                              selectedMacro.id,
                                              question.id,
                                              (cur) => ({
                                                ...cur,
                                                optionCharges: {
                                                  ...(cur.optionCharges ?? {}),
                                                  [optLabel]: {
                                                    procedureCode: treatment.procedureCode
                                                      .trim()
                                                      .toUpperCase(),
                                                    name: treatment.name.trim(),
                                                    unitPrice: Math.max(
                                                      0,
                                                      Number(treatment.unitPrice) || 0,
                                                    ),
                                                  },
                                                },
                                              }),
                                            );
                                            setChargePickerFor(null);
                                          }}
                                          type="button"
                                        >
                                          <span className="rounded bg-[var(--bg-soft)] px-1.5 py-0 font-mono font-semibold">
                                            {treatment.procedureCode}
                                          </span>
                                          <span className="flex-1 truncate font-semibold">
                                            {treatment.name}
                                          </span>
                                          <span className="text-[var(--text-muted)]">
                                            ${treatment.unitPrice.toFixed(2)}
                                          </span>
                                          {isCurrent && (
                                            <span className="text-emerald-700">✓</span>
                                          )}
                                        </button>
                                      );
                                    });
                                  })()}
                                </div>
                              </>
                            )}
                          </div>
                        )}

                      <div className="flex items-center gap-1">
                        <input
                          className="flex-1 rounded-lg border border-[var(--line-soft)] px-2 py-1 text-xs"
                          onChange={(event) => setNewChoiceDrafts((c) => ({ ...c, [choiceKey]: event.target.value }))}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              event.preventDefault();
                              addChoice();
                            }
                          }}
                          placeholder="Add choice..."
                          value={choiceDraft}
                        />
                        <button
                          className="rounded-lg border border-[var(--line-soft)] bg-white px-2 py-1 text-xs font-semibold"
                          onClick={addChoice}
                          type="button"
                        >
                          + Add
                        </button>
                      </div>

                      <p className="text-xs text-[var(--text-muted)]">Token: {insertQuestionToken(question.id)}</p>
                    </div>
                    );
                  })}
                </div>
              </div>

              {unknownQuestionIds.length > 0 && (
                <div className="rounded-xl border border-[var(--line-soft)] bg-[#fff8e8] p-3 text-sm">
                  Missing question definitions for tokens: {unknownQuestionIds.join(", ")}
                </div>
              )}

              <div>
                <p className="text-sm font-semibold text-[var(--text-muted)]">Generated Output Preview</p>
                <textarea
                  className="mt-1 min-h-36 w-full rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
                  readOnly
                  value={generatedOutput}
                />
              </div>

              {generatedOutput && (
                <div>
                  <p className="text-sm font-semibold text-[var(--text-muted)]">Print Preview</p>
                  <div
                    className="mt-1 min-h-36 rounded-xl border border-[var(--line-soft)] bg-white px-6 py-4 text-sm leading-7"
                    style={{ fontFamily: "Georgia, 'Times New Roman', serif" }}
                    dangerouslySetInnerHTML={{
                      __html: /<\/?[a-z][\s\S]*>/i.test(generatedOutput)
                        ? generatedOutput
                        : generatedOutput
                            .replace(/&/g, "&amp;")
                            .replace(/</g, "&lt;")
                            .replace(/>/g, "&gt;")
                            .replace(/\n/g, "<br />"),
                    }}
                  />
                </div>
              )}
            </div>
          )}
        </article>
      </div>

      {runOpen && selectedMacro && (
        <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/40 px-4 py-8">
          <div className="panel-card max-h-[85vh] w-full max-w-3xl overflow-auto p-4">
            <div className="mb-3 flex items-center justify-between">
              <h4 className="text-xl font-semibold">Run Macro: {selectedMacro.buttonName}</h4>
              <button
                className="rounded-lg border border-[var(--line-soft)] px-3 py-1"
                onClick={() => setRunOpen(false)}
                type="button"
              >
                Close
              </button>
            </div>

            <div className="space-y-3">
              {selectedMacro.questions.map((question) => {
                const answerValue = answers[question.id];
                const selectedOptions = Array.isArray(answerValue) ? answerValue : [];
                const singleAnswer = typeof answerValue === "string" ? answerValue : "";
                const freeTextValue = Array.isArray(answerValue) ? answerValue.join(", ") : answerValue ?? "";
                return (
                  <div key={question.id} className="rounded-xl border border-[var(--line-soft)] bg-white p-3">
                    <p className="text-sm font-semibold">{question.label}</p>
                    {question.options.length > 0 ? (
                      (() => {
                        const opts = question.options;
                        const colCount = opts.length >= 5 ? Math.ceil(opts.length / 5) : 1;
                        const perCol = Math.ceil(opts.length / colCount);
                        const renderOpt = (option: string) => (
                          <label
                            key={`${question.id}-${option}`}
                            className="inline-flex w-full items-center gap-2 rounded-lg border border-[var(--line-soft)] bg-[var(--bg-soft)] px-3 py-2 text-sm"
                          >
                            {question.multiSelect ? (
                              <input
                                checked={selectedOptions.includes(option)}
                                onChange={() =>
                                  setAnswers((current) => {
                                    const rawExisting = current[question.id];
                                    const existing = Array.isArray(rawExisting) ? rawExisting : [];
                                    const next = existing.includes(option)
                                      ? existing.filter((entry) => entry !== option)
                                      : [...existing, option];
                                    return {
                                      ...current,
                                      [question.id]: next,
                                    };
                                  })
                                }
                                type="checkbox"
                              />
                            ) : (
                              <input
                                checked={singleAnswer === option}
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
                        return colCount > 1 ? (
                          <div className="mt-2 grid gap-2" style={{ gridTemplateColumns: `repeat(${colCount}, 1fr)` }}>
                            {Array.from({ length: colCount }, (_, ci) => (
                              <div key={ci} className="grid gap-2 content-start">
                                {opts.slice(ci * perCol, (ci + 1) * perCol).map(renderOpt)}
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="mt-2 grid gap-2">{opts.map(renderOpt)}</div>
                        );
                      })()
                    ) : (
                      <input
                        className="mt-2 w-full rounded-xl border border-[var(--line-soft)] px-3 py-2"
                        onChange={(event) =>
                          setAnswers((current) => ({
                            ...current,
                            [question.id]: event.target.value,
                          }))
                        }
                        value={freeTextValue}
                      />
                    )}
                  </div>
                );
              })}
              {selectedMacro.questions.length === 0 && (
                <p className="text-sm text-[var(--text-muted)]">No question prompts for this macro.</p>
              )}
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <button
                className="rounded-xl border border-[var(--line-soft)] bg-white px-4 py-2 font-semibold transition-all active:scale-[0.97] active:shadow-inner"
                onClick={() => setRunOpen(false)}
                type="button"
              >
                Cancel
              </button>
              <button
                className="rounded-xl bg-[var(--brand-primary)] px-4 py-2 font-semibold text-white transition-all active:scale-[0.97] active:brightness-90"
                onClick={runMacro}
                type="button"
              >
                Generate Text
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
