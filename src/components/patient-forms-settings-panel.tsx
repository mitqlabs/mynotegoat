"use client";

/**
 * Settings → Templates → Forms: the practice builds its OWN questionnaires.
 * Nothing ships pre-made — a new office starts with zero forms.
 *
 * A form is a list of sections. A section is either one of the practice's
 * own Objective macros (the patient picks from the same options staff click,
 * and Insert into Objective renders that macro) or the practice's own
 * questions (short / long answer, yes-no, pick one, pick any, number; these
 * go into Objective as plain "Question: answer" lines).
 *
 * Saved to the cloud (workspace_kv, union-merged by form id, deletes are
 * tombstones, every change kept in version history).
 */
import { useMemo, useState } from "react";
import { useMacroTemplates } from "@/hooks/use-macro-templates";
import { usePatientForms } from "@/hooks/use-patient-forms";
import {
  blankForm,
  CUSTOM_QUESTION_TYPES,
  customSection,
  duplicateForm,
  findSectionMacro,
  friendlyOptionLabel,
  isCustomSection,
  isStaffOnlyOption,
  liveForms,
  macroNameKey,
  macroSection,
  findMacroByName,
  PATIENT_INFO_FIELDS,
  resolveForm,
  type AnswerConnect,
  type ConnectSection,
  type PatientInfoField,
  type CustomQuestion,
  type CustomQuestionType,
  type FormIncludeWhen,
  type FormQuestionOverride,
  type FormSection,
  type FormTemplate,
} from "@/lib/patient-forms";
import type { MacroTemplate } from "@/lib/macro-templates";

const nowIso = () => new Date().toISOString();
const newId = (p: string) => `${p}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
const INCLUDE_WORDS: Record<FormIncludeWhen, string> = {
  always: "Always",
  decompression: "Decompression only",
  notDecompression: "Not decompression",
};

// One height for every control so rows line up.
const field = "h-9 rounded-lg border border-[var(--line-soft)] bg-white px-2 text-sm";
const area = "rounded-lg border border-[var(--line-soft)] bg-white px-2 py-1.5 text-sm";
const btn =
  "inline-flex h-9 shrink-0 items-center justify-center gap-1 rounded-lg border border-[var(--line-soft)] bg-white px-3 text-sm font-semibold hover:bg-[var(--bg-soft,#f7f7f7)] disabled:cursor-not-allowed disabled:opacity-40";
const iconBtn = `${btn} w-9 px-0`;
const primaryBtn =
  "inline-flex h-9 shrink-0 items-center justify-center rounded-lg bg-[var(--brand-primary)] px-3 text-sm font-semibold text-white disabled:opacity-50";
const label = "text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]";

function moveItem<T>(list: T[], idx: number, dir: -1 | 1): T[] {
  const j = idx + dir;
  if (j < 0 || j >= list.length) return list;
  const next = [...list];
  [next[idx], next[j]] = [next[j], next[idx]];
  return next;
}

function Switch({ on, onChange, title }: { on: boolean; onChange: (v: boolean) => void; title: string }) {
  return (
    <button
      aria-checked={on}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${on ? "bg-emerald-600" : "bg-slate-300"}`}
      onClick={() => onChange(!on)}
      role="switch"
      title={title}
      type="button"
    >
      <span className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${on ? "translate-x-5" : "translate-x-0.5"}`} />
    </button>
  );
}

export function PatientFormsSettingsPanel() {
  const { forms, updateForms } = usePatientForms();
  const { macroLibrary } = useMacroTemplates();
  const live = liveForms(forms);
  const [selectedId, setSelectedId] = useState(live[0]?.id ?? "");
  const form = live.find((f) => f.id === selectedId) ?? live[0] ?? null;
  const objectiveMacros = useMemo(() => macroLibrary.templates.filter((t) => t.section === "objective" && t.active), [macroLibrary.templates]);

  const patchForm = (id: string, fn: (f: FormTemplate) => FormTemplate) =>
    updateForms((cur) => cur.map((f) => (f.id === id ? { ...fn(f), updatedAt: nowIso() } : f)));

  const addForm = () => {
    const f = blankForm(newId("form"), nowIso());
    updateForms((cur) => [...cur, f]);
    setSelectedId(f.id);
  };
  const copyForm = (src: FormTemplate) => {
    const f = duplicateForm(src, { form: newId("form"), next: () => newId("sec") }, nowIso());
    updateForms((cur) => [...cur, f]);
    setSelectedId(f.id);
  };
  const deleteForm = (f: FormTemplate) => {
    if (!window.confirm(`Delete "${f.name}"?\n\nLinks already sent keep working until they expire. (It stays in version history.)`)) return;
    patchForm(f.id, (x) => ({ ...x, deleted: true }));
    setSelectedId(live.find((x) => x.id !== f.id)?.id ?? "");
  };

  if (!live.length) {
    return (
      <div className="flex flex-col items-center gap-1 rounded-xl border border-dashed border-[var(--line-soft)] p-8 text-center" data-testid="forms-empty">
        <p className="text-base font-semibold">No forms yet</p>
        <p className="max-w-md text-sm text-[var(--text-muted)]">
          Build a questionnaire to text or email patients. Use your own Objective macros as sections so answers drop straight into the
          note, and add any questions of your own.
        </p>
        <button className={`${primaryBtn} mt-3`} onClick={addForm} type="button">
          + New form
        </button>
      </div>
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-[220px_minmax(0,1fr)]">
      <aside className="space-y-2">
        <button className={`${primaryBtn} w-full`} onClick={addForm} type="button">
          + New form
        </button>
        <ul className="space-y-1">
          {live.map((f) => {
            const active = f.id === form?.id;
            return (
              <li key={f.id}>
                <button
                  className={`flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left text-sm ${active ? "border-[var(--brand-primary)] bg-[var(--bg-soft,#f7f7f7)] font-semibold" : "border-transparent hover:bg-[var(--bg-soft,#f7f7f7)]"}`}
                  onClick={() => setSelectedId(f.id)}
                  type="button"
                >
                  <span className="truncate">{f.name || "Untitled form"}</span>
                  {f.disabled && <span className="shrink-0 rounded bg-slate-200 px-1.5 text-[11px] font-semibold text-slate-600">Off</span>}
                </button>
              </li>
            );
          })}
        </ul>
      </aside>
      {form && (
        <FormEditor
          form={form}
          key={form.id}
          macros={macroLibrary.templates}
          objectiveMacros={objectiveMacros}
          onCopy={() => copyForm(form)}
          onDelete={() => deleteForm(form)}
          patch={(fn) => patchForm(form.id, fn)}
        />
      )}
    </div>
  );
}

function FormEditor({
  form,
  macros,
  objectiveMacros,
  patch,
  onCopy,
  onDelete,
}: {
  form: FormTemplate;
  macros: MacroTemplate[];
  objectiveMacros: MacroTemplate[];
  patch: (fn: (f: FormTemplate) => FormTemplate) => void;
  onCopy: () => void;
  onDelete: () => void;
}) {
  const [openSection, setOpenSection] = useState("");
  const [picking, setPicking] = useState(false);
  const patchSection = (id: string, fn: (s: FormSection) => FormSection) => patch((f) => ({ ...f, sections: f.sections.map((s) => (s.id === id ? fn(s) : s)) }));

  const counts = {
    normal: resolveForm(form, macros, { decompression: false }).snapshot.sections.reduce((n, s) => n + s.questions.length, 0),
    decomp: resolveForm(form, macros, { decompression: true }).snapshot.sections.reduce((n, s) => n + s.questions.length, 0),
  };
  const addCustom = () => {
    const s = customSection(newId("sec"));
    s.customQuestions = [{ id: newId("q"), label: "", type: "short", enabled: true }];
    patch((f) => ({ ...f, sections: [...f.sections, s] }));
    setOpenSection(s.id);
  };
  const removeSection = (s: FormSection) => {
    if (!window.confirm(`Remove the section "${s.title || s.macroName || "Untitled"}" from this form?`)) return;
    patch((f) => ({ ...f, sections: f.sections.filter((x) => x.id !== s.id) }));
  };

  return (
    <div className="min-w-0 space-y-4 rounded-xl border border-[var(--line-soft)] p-4" data-testid="form-editor">
      <div className="flex flex-wrap items-end gap-2">
        <label className="grid min-w-[200px] flex-1 gap-1">
          <span className={label}>Form name</span>
          <input className={field} onBlur={() => form.name !== form.name.trim() && patch((f) => ({ ...f, name: f.name.trim() || "Untitled form" }))} onChange={(e) => patch((f) => ({ ...f, name: e.target.value }))} placeholder="e.g. New patient questionnaire" value={form.name} />
        </label>
        <div className="flex h-9 items-center gap-2 px-1 text-sm">
          <Switch on={!form.disabled} onChange={(on) => patch((f) => ({ ...f, disabled: on ? undefined : true }))} title="Offer this form in Send form" />
          <span className="w-8 font-semibold">{form.disabled ? "Off" : "On"}</span>
        </div>
        <button className={btn} onClick={onCopy} type="button">
          Duplicate
        </button>
        <button className={`${btn} text-red-700`} onClick={onDelete} type="button">
          Delete
        </button>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <label className="grid gap-1">
          <span className={label}>Note at the top</span>
          <textarea className={area} onChange={(e) => patch((f) => ({ ...f, intro: e.target.value }))} rows={2} value={form.intro} />
        </label>
        <label className="grid gap-1">
          <span className={label}>Note in Spanish (optional)</span>
          <textarea className={area} onChange={(e) => patch((f) => ({ ...f, introEs: e.target.value }))} rows={2} value={form.introEs ?? ""} />
        </label>
      </div>

      <div className="flex items-baseline justify-between gap-2 border-t border-[var(--line-soft)] pt-3">
        <h4 className="text-sm font-semibold">Sections</h4>
        <span className="text-xs text-[var(--text-muted)]">
          {counts.normal === counts.decomp ? `${counts.normal} questions` : `${counts.normal} questions · ${counts.decomp} for decompression cases`}
          {form.disabled ? " · turned off (not in Send form)" : ""}
        </span>
      </div>

      {form.sections.length === 0 && !picking && (
        <p className="rounded-lg bg-[var(--bg-soft,#f7f7f7)] p-3 text-sm text-[var(--text-muted)]">
          No sections yet. Add some of your Objective macros, or your own questions.
        </p>
      )}

      <ul className="space-y-2">
        {form.sections.map((s, idx) => (
          <SectionCard
            expanded={openSection === s.id}
            first={idx === 0}
            key={s.id}
            last={idx === form.sections.length - 1}
            macros={macros}
            objectiveMacros={objectiveMacros}
            onMove={(dir) => patch((f) => ({ ...f, sections: moveItem(f.sections, idx, dir) }))}
            onRemove={() => removeSection(s)}
            onToggleOpen={() => setOpenSection(openSection === s.id ? "" : s.id)}
            patch={(fn) => patchSection(s.id, fn)}
            section={s}
          />
        ))}
      </ul>

      {picking ? (
        <MacroPicker
          already={form.sections.filter((s) => !isCustomSection(s)).map((s) => macroNameKey(s.macroName))}
          macros={objectiveMacros}
          onAdd={(names) => {
            patch((f) => ({ ...f, sections: [...f.sections, ...names.map((n) => macroSection(newId("sec"), n))] }));
            setPicking(false);
          }}
          onCancel={() => setPicking(false)}
        />
      ) : (
        <div className="flex flex-wrap gap-2">
          <button className={btn} disabled={!objectiveMacros.length} onClick={() => setPicking(true)} title={objectiveMacros.length ? "" : "You have no active Objective macros yet"} type="button">
            + Objective macros
          </button>
          <button className={btn} onClick={addCustom} type="button">
            + Your own questions
          </button>
        </div>
      )}
    </div>
  );
}

function MacroPicker({ macros, already, onAdd, onCancel }: { macros: MacroTemplate[]; already: string[]; onAdd: (names: string[]) => void; onCancel: () => void }) {
  const [picked, setPicked] = useState<string[]>([]);
  const toggle = (name: string) => setPicked((cur) => (cur.includes(name) ? cur.filter((x) => x !== name) : [...cur, name]));
  return (
    <div className="space-y-3 rounded-lg border border-[var(--line-soft)] p-3" data-testid="macro-picker">
      <p className="text-sm font-semibold">Pick the Objective macros to ask about</p>
      <div className="gap-x-1 sm:columns-2 lg:columns-3">
        {macros.map((m) => {
          const inForm = already.includes(macroNameKey(m.buttonName));
          return (
            <label className="mb-1 flex h-9 break-inside-avoid items-center gap-2 rounded-lg px-2 text-sm hover:bg-[var(--bg-soft,#f7f7f7)]" key={m.id}>
              <input checked={picked.includes(m.buttonName)} onChange={() => toggle(m.buttonName)} type="checkbox" />
              <span className="truncate">{m.buttonName}</span>
              {inForm && <span className="ml-auto shrink-0 text-[11px] text-[var(--text-muted)]">in form</span>}
            </label>
          );
        })}
      </div>
      <div className="flex gap-2">
        <button className={primaryBtn} disabled={!picked.length} onClick={() => onAdd(picked)} type="button">
          Add {picked.length || ""} section{picked.length === 1 ? "" : "s"}
        </button>
        <button className={btn} onClick={onCancel} type="button">
          Cancel
        </button>
      </div>
    </div>
  );
}

function SectionCard({
  section: s,
  macros,
  objectiveMacros,
  expanded,
  first,
  last,
  patch,
  onMove,
  onRemove,
  onToggleOpen,
}: {
  section: FormSection;
  macros: MacroTemplate[];
  objectiveMacros: MacroTemplate[];
  expanded: boolean;
  first: boolean;
  last: boolean;
  patch: (fn: (s: FormSection) => FormSection) => void;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
  onToggleOpen: () => void;
}) {
  const custom = isCustomSection(s);
  const macro = custom ? null : findSectionMacro(s, macros);
  return (
    <li className={`rounded-lg border p-2 ${s.enabled ? "border-[var(--line-soft)]" : "border-dashed border-[var(--line-soft)] bg-slate-50"}`} data-testid="form-section">
      <div className="flex flex-wrap items-center gap-2">
        <Switch on={s.enabled} onChange={(on) => patch((x) => ({ ...x, enabled: on }))} title="Ask this section" />
        <input
          className={`${field} min-w-[160px] flex-1`}
          onChange={(e) => patch((x) => ({ ...x, title: e.target.value }))}
          placeholder="Heading the patient sees"
          value={s.title}
        />
        <span className="ml-auto flex gap-1">
          <button aria-label="Move up" className={iconBtn} disabled={first} onClick={() => onMove(-1)} type="button">
            ↑
          </button>
          <button aria-label="Move down" className={iconBtn} disabled={last} onClick={() => onMove(1)} type="button">
            ↓
          </button>
          <button className={`${btn} w-24`} onClick={onToggleOpen} type="button">
            {expanded ? "Done" : "Questions"}
          </button>
          <button aria-label="Remove section" className={`${iconBtn} text-red-700`} onClick={onRemove} type="button">
            ×
          </button>
        </span>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2 pl-[52px]">
        {custom ? (
          <span className={`${field} inline-flex w-48 items-center text-[var(--text-muted)]`}>Your own questions</span>
        ) : (
          <select className={`${field} w-48`} onChange={(e) => patch((x) => ({ ...x, macroName: e.target.value }))} title="Objective macro" value={macro?.buttonName ?? s.macroName}>
            {!macro && <option value={s.macroName}>⚠ {s.macroName} (not found)</option>}
            {objectiveMacros.map((m) => (
              <option key={m.id} value={m.buttonName}>
                {m.buttonName}
              </option>
            ))}
          </select>
        )}
        <select className={`${field} w-48`} onChange={(e) => patch((x) => ({ ...x, includeWhen: e.target.value as FormIncludeWhen }))} title="When this section is asked" value={s.includeWhen}>
          {(Object.keys(INCLUDE_WORDS) as FormIncludeWhen[]).map((k) => (
            <option key={k} value={k}>
              {INCLUDE_WORDS[k]}
            </option>
          ))}
        </select>
        <span className="text-xs text-[var(--text-muted)]">{custom ? `${(s.customQuestions ?? []).filter((q) => q.enabled && q.label.trim()).length} questions` : macro ? "" : "⚠ macro not found"}</span>
      </div>
      {expanded && (
        <div className="mt-2 space-y-2 border-t border-[var(--line-soft)] pt-2">
          <input
            className={`${field} w-full md:w-80`}
            onChange={(e) => patch((x) => ({ ...x, titleEs: e.target.value }))}
            placeholder="Heading in Spanish (optional)"
            value={s.titleEs ?? ""}
          />
          {custom ? (
            <CustomQuestionsEditor macros={macros} patch={patch} section={s} />
          ) : macro ? (
            <MacroQuestionsEditor macro={macro} macros={macros} patch={patch} section={s} />
          ) : (
            <p className="text-sm text-amber-800">No active Objective macro is named “{s.macroName}”. Pick one above.</p>
          )}
        </div>
      )}
    </li>
  );
}

function CustomQuestionsEditor({ section: s, macros, patch }: { section: FormSection; macros: MacroTemplate[]; patch: (fn: (s: FormSection) => FormSection) => void }) {
  const qs = s.customQuestions ?? [];
  const setQs = (fn: (list: CustomQuestion[]) => CustomQuestion[]) => patch((x) => ({ ...x, customQuestions: fn(x.customQuestions ?? []) }));
  const patchQ = (id: string, fn: (q: CustomQuestion) => CustomQuestion) => setQs((list) => list.map((q) => (q.id === id ? fn(q) : q)));
  return (
    <div className="space-y-2" data-testid="custom-questions">
      {qs.map((q, idx) => {
        const choice = q.type === "single" || q.type === "multi";
        return (
          <div className={`space-y-2 rounded-lg p-2 ${q.enabled ? "bg-[var(--bg-soft,#f7f7f7)]" : "bg-slate-50 opacity-70"}`} key={q.id}>
            <div className="flex flex-wrap items-center gap-2">
              <Switch on={q.enabled} onChange={(on) => patchQ(q.id, (x) => ({ ...x, enabled: on }))} title="Ask this question" />
              <input className={`${field} min-w-[180px] flex-1`} onChange={(e) => patchQ(q.id, (x) => ({ ...x, label: e.target.value }))} placeholder="Question" value={q.label} />
              <select
                className={`${field} w-36`}
                onChange={(e) => {
                  const type = e.target.value as CustomQuestionType;
                  patchQ(q.id, (x) => ({ ...x, type, ...(type === "single" || type === "multi" ? { options: x.options ?? [] } : { options: undefined }) }));
                }}
                value={q.type}
              >
                {CUSTOM_QUESTION_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
              <span className="ml-auto flex gap-1">
                <button aria-label="Move question up" className={iconBtn} disabled={idx === 0} onClick={() => setQs((list) => moveItem(list, idx, -1))} type="button">
                  ↑
                </button>
                <button aria-label="Move question down" className={iconBtn} disabled={idx === qs.length - 1} onClick={() => setQs((list) => moveItem(list, idx, 1))} type="button">
                  ↓
                </button>
                <button
                  aria-label="Delete question"
                  className={`${iconBtn} text-red-700`}
                  onClick={() => {
                    if (q.label.trim() && !window.confirm(`Delete the question "${q.label.trim()}"?`)) return;
                    setQs((list) => list.filter((x) => x.id !== q.id));
                  }}
                  type="button"
                >
                  ×
                </button>
              </span>
            </div>
            <div className="grid gap-2 pl-[52px] md:grid-cols-2">
              <input className={field} onChange={(e) => patchQ(q.id, (x) => ({ ...x, labelEs: e.target.value }))} placeholder="Question in Spanish (optional)" value={q.labelEs ?? ""} />
              {choice && (
                <textarea
                  className={area}
                  onChange={(e) => patchQ(q.id, (x) => ({ ...x, options: e.target.value.split("\n") }))}
                  placeholder={"Choices, one per line"}
                  rows={Math.max(3, (q.options ?? []).length)}
                  value={(q.options ?? []).join("\n")}
                />
              )}
              {choice && !(q.options ?? []).some((o) => o.trim()) && <p className="text-xs text-amber-800 md:col-span-2">Add at least one choice, or it won&apos;t be asked.</p>}
            </div>
            <div className="pl-[52px]">
              <ConnectPicker macros={macros} onChange={(c) => patchQ(q.id, (x) => ({ ...x, connect: c }))} value={q.connect} />
            </div>
          </div>
        );
      })}
      <button className={btn} onClick={() => setQs((list) => [...list, { id: newId("q"), label: "", type: "short", enabled: true }])} type="button">
        + Add question
      </button>
    </div>
  );
}

function MacroQuestionsEditor({ section: s, macro, macros, patch }: { section: FormSection; macro: MacroTemplate; macros: MacroTemplate[]; patch: (fn: (s: FormSection) => FormSection) => void }) {
  const patchQuestion = (qid: string, fn: (o: FormQuestionOverride) => FormQuestionOverride) =>
    patch((sec) => ({ ...sec, questions: { ...(sec.questions ?? {}), [qid]: fn(sec.questions?.[qid] ?? {}) } }));
  return (
    <div className="space-y-2">
      <p className="text-xs text-[var(--text-muted)]">Choose which of this macro&apos;s questions patients answer. Hover an option box to see the exact words that go in the note.</p>
      {macro.questions.map((q) => {
        const o = s.questions?.[q.id] ?? {};
        const onlyKeys = (s.onlyQuestions ?? []).map((k) => k.toLowerCase().trim());
        const inOnly = !onlyKeys.length || onlyKeys.includes(q.id.toLowerCase()) || onlyKeys.includes(q.label.toLowerCase().trim());
        const included = inOnly && !o.hidden;
        const shown = q.options.filter((opt) => !isStaffOnlyOption(opt));
        return (
          <div className={`rounded-lg p-2 ${included ? "bg-[var(--bg-soft,#f7f7f7)]" : "bg-slate-50 opacity-70"}`} key={q.id}>
            <label className="flex flex-wrap items-center gap-2 text-sm">
              <input
                checked={included}
                onChange={(e) => {
                  const on = e.target.checked;
                  patch((x) => {
                    if (x.onlyQuestions?.length) {
                      // Switch from an "only these" list to per-question hide flags.
                      const want = new Set(x.onlyQuestions.map((k) => k.toLowerCase().trim()));
                      const qs: Record<string, FormQuestionOverride> = { ...(x.questions ?? {}) };
                      for (const mq of macro.questions) {
                        const keep = mq.id === q.id ? on : (want.has(mq.id.toLowerCase()) || want.has(mq.label.toLowerCase().trim())) && !qs[mq.id]?.hidden;
                        qs[mq.id] = { ...(qs[mq.id] ?? {}), hidden: keep ? undefined : true };
                      }
                      return { ...x, onlyQuestions: undefined, questions: qs };
                    }
                    return { ...x, questions: { ...(x.questions ?? {}), [q.id]: { ...(x.questions?.[q.id] ?? {}), hidden: on ? undefined : true } } };
                  });
                }}
                type="checkbox"
              />
              <span className="font-semibold">{q.label}</span>
              <span className="text-xs text-[var(--text-muted)]">{shown.length === 0 ? "typed answer" : q.multiSelect ? "pick any" : "pick one"} · plus a “something else” box</span>
            </label>
            {included && (
              <div className="mt-2 grid gap-2 pl-6 md:grid-cols-2">
                <input className={field} onChange={(e) => patchQuestion(q.id, (x) => ({ ...x, label: e.target.value }))} placeholder={`Patient wording (default: ${q.label})`} value={o.label ?? ""} />
                <input className={field} onChange={(e) => patchQuestion(q.id, (x) => ({ ...x, labelEs: e.target.value }))} placeholder="Spanish wording (optional)" value={o.labelEs ?? ""} />
                {shown.map((opt) => (
                  <div className="contents" key={opt}>
                    <input
                      className={field}
                      onChange={(e) => patchQuestion(q.id, (x) => ({ ...x, optionLabels: { ...(x.optionLabels ?? {}), [opt]: e.target.value } }))}
                      placeholder={friendlyOptionLabel(opt, { onlyOption: shown.length === 1 })}
                      title={`Saved in the note as: ${opt}`}
                      value={o.optionLabels?.[opt] ?? ""}
                    />
                    <input
                      className={field}
                      onChange={(e) => patchQuestion(q.id, (x) => ({ ...x, optionLabelsEs: { ...(x.optionLabelsEs ?? {}), [opt]: e.target.value } }))}
                      placeholder="Spanish (optional)"
                      value={o.optionLabelsEs?.[opt] ?? ""}
                    />
                  </div>
                ))}
                {q.options.some(isStaffOnlyOption) && (
                  <p className="text-xs text-[var(--text-muted)] md:col-span-2">Not shown to patients: {q.options.filter(isStaffOnlyOption).join(" · ")} (blanks to fill / staff-only).</p>
                )}
                <div className="md:col-span-2">
                  <ConnectPicker
                    macros={macros}
                    onChange={(c) => patchQuestion(q.id, (x) => ({ ...x, connect: c }))}
                    own={{ macroName: macro.buttonName, questionLabel: q.label }}
                    value={o.connect}
                  />
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

type ConnectKind = "default" | "none" | ConnectSection | "patient";

/**
 * "Connect answer to": None (a plain "Question: answer" line) / Objective or
 * Subjective → macro → that macro's field (and optionally one option it
 * picks) / a patient-file field. Macro-section questions show their own
 * macro field as the prefilled default.
 */
function ConnectPicker({
  value,
  onChange,
  macros,
  own,
}: {
  value: AnswerConnect | undefined;
  onChange: (c: AnswerConnect | undefined) => void;
  macros: MacroTemplate[];
  /** Macro-section question: its default target. */
  own?: { macroName: string; questionLabel: string };
}) {
  const kind: ConnectKind = !value ? (own ? "default" : "none") : value.to === "none" ? "none" : value.to === "patient" ? "patient" : value.section;
  const bySection = (sec: ConnectSection) => macros.filter((m) => m.section === sec && m.active);
  const macroC = value?.to === "macro" ? value : null;
  const target = macroC ? findMacroByName(macroC.macroName, macros, macroC.section) : null;
  const targetQ = target?.questions.find((q) => q.id === macroC?.questionId) ?? null;
  const pickKind = (k: ConnectKind) => {
    if (k === "default") return onChange(undefined);
    if (k === "none") return onChange(own ? { to: "none" } : undefined);
    if (k === "patient") return onChange({ to: "patient", field: "phone" });
    const first = bySection(k)[0];
    if (!first?.questions.length) return onChange({ to: "none" });
    onChange({ to: "macro", section: k, macroName: first.buttonName, questionId: first.questions[0].id });
  };
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="connect-picker">
      <span className={`${label} w-36 shrink-0`}>Connect answer to</span>
      <select aria-label="Connect answer to" className={`${field} w-40`} onChange={(e) => pickKind(e.target.value as ConnectKind)} value={kind}>
        {own && <option value="default">This macro</option>}
        <option value="none">None (text line)</option>
        <option disabled={!bySection("objective").length} value="objective">Objective</option>
        <option disabled={!bySection("subjective").length} value="subjective">Subjective</option>
        <option value="patient">Patient info</option>
      </select>
      {kind === "default" && own && (
        <span className={`${field} inline-flex w-auto max-w-full items-center truncate text-[var(--text-muted)]`} title="Fills this question in its own macro">
          {own.macroName} → {own.questionLabel}
        </span>
      )}
      {macroC && (
        <>
          <select
            aria-label="Macro"
            className={`${field} w-44`}
            onChange={(e) => {
              const m = bySection(macroC.section).find((x) => x.buttonName === e.target.value);
              if (m?.questions.length) onChange({ to: "macro", section: macroC.section, macroName: m.buttonName, questionId: m.questions[0].id });
            }}
            value={target?.buttonName ?? macroC.macroName}
          >
            {!target && <option value={macroC.macroName}>⚠ {macroC.macroName} (not found)</option>}
            {bySection(macroC.section).map((m) => (
              <option key={m.id} value={m.buttonName}>
                {m.buttonName}
              </option>
            ))}
          </select>
          <select
            aria-label="Macro field"
            className={`${field} w-44`}
            onChange={(e) => onChange({ to: "macro", section: macroC.section, macroName: macroC.macroName, questionId: e.target.value })}
            value={targetQ?.id ?? macroC.questionId}
          >
            {!targetQ && <option value={macroC.questionId}>⚠ field not found</option>}
            {(target?.questions ?? []).map((q) => (
              <option key={q.id} value={q.id}>
                {q.label || q.id}
              </option>
            ))}
          </select>
          {targetQ && targetQ.options.length > 0 && (
            <select
              aria-label="Option it fills"
              className={`${field} w-48`}
              onChange={(e) => onChange({ ...macroC, option: e.target.value || undefined })}
              title="Whole answer: the patient's words (matched to an option when they're the same). An option: a Yes / any answer picks exactly that option; No leaves it blank."
              value={macroC.option ?? ""}
            >
              <option value="">Whole answer</option>
              {targetQ.options.map((opt) => (
                <option key={opt} value={opt}>
                  Picks: {opt}
                </option>
              ))}
            </select>
          )}
        </>
      )}
      {value?.to === "patient" && (
        <select aria-label="Patient field" className={`${field} w-40`} onChange={(e) => onChange({ to: "patient", field: e.target.value as PatientInfoField })} value={value.field}>
          {PATIENT_INFO_FIELDS.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>
      )}
      {value?.to === "patient" && <span className="text-xs text-[var(--text-muted)]">Fills it only if blank</span>}
    </div>
  );
}
