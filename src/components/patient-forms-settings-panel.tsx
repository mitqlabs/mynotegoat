"use client";

/**
 * Settings → Templates → Forms. Ready-to-send questionnaires built from the
 * practice's own Objective macros: pick sections, order them, choose when a
 * section is included, and (optionally) reword questions / options the way a
 * patient would say them. The saved answer is always the macro's own option.
 */
import { useMemo, useState } from "react";
import { useMacroTemplates } from "@/hooks/use-macro-templates";
import { usePatientForms } from "@/hooks/use-patient-forms";
import {
  findSectionMacro,
  friendlyOptionLabel,
  getDefaultPatientForms,
  isStaffOnlyOption,
  liveForms,
  resolveForm,
  type FormIncludeWhen,
  type FormQuestionOverride,
  type FormSection,
  type FormTemplate,
} from "@/lib/patient-forms";

const nowIso = () => new Date().toISOString();
const newId = (p: string) => `${p}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
const INCLUDE_WORDS: Record<FormIncludeWhen, string> = {
  always: "Always",
  decompression: "Decompression cases only",
  notDecompression: "Not for decompression cases",
};
const input = "rounded-lg border border-[var(--line-soft)] bg-white px-2 py-1.5 text-sm";

export function PatientFormsSettingsPanel() {
  const { forms, updateForms } = usePatientForms();
  const { macroLibrary } = useMacroTemplates();
  const live = liveForms(forms);
  const [selectedId, setSelectedId] = useState(live[0]?.id ?? "");
  const [openSection, setOpenSection] = useState("");
  const form = live.find((f) => f.id === selectedId) ?? live[0] ?? null;
  const objectiveMacros = useMemo(
    () => macroLibrary.templates.filter((t) => t.section === "objective" && t.active),
    [macroLibrary.templates],
  );

  const patchForm = (id: string, fn: (f: FormTemplate) => FormTemplate) =>
    updateForms((cur) => cur.map((f) => (f.id === id ? { ...fn(f), updatedAt: nowIso() } : f)));
  const patchSection = (sectionId: string, fn: (s: FormSection) => FormSection) =>
    form && patchForm(form.id, (f) => ({ ...f, sections: f.sections.map((s) => (s.id === sectionId ? fn(s) : s)) }));
  const patchQuestion = (s: FormSection, qid: string, fn: (o: FormQuestionOverride) => FormQuestionOverride) =>
    patchSection(s.id, (sec) => ({ ...sec, questions: { ...(sec.questions ?? {}), [qid]: fn(sec.questions?.[qid] ?? {}) } }));

  const addForm = (copyOf?: FormTemplate) => {
    const t = nowIso();
    const f: FormTemplate = copyOf
      ? { ...structuredClone(copyOf), id: newId("form"), name: `${copyOf.name} (copy)`, builtIn: undefined, deleted: undefined, createdAt: t, updatedAt: t }
      : { id: newId("form"), name: "New form", intro: "Please answer a few questions before your visit.", sections: [], createdAt: t, updatedAt: t };
    updateForms((cur) => [...cur, f]);
    setSelectedId(f.id);
  };
  const deleteForm = (f: FormTemplate) => {
    if (!window.confirm(`Delete "${f.name}"? Links already sent keep working until they expire.`)) return;
    patchForm(f.id, (x) => ({ ...x, deleted: true }));
    setSelectedId(live.find((x) => x.id !== f.id)?.id ?? "");
  };
  const restoreDefault = () => {
    const d = getDefaultPatientForms()[0];
    if (!window.confirm(`Put "${d.name}" back to how it shipped? Your changes to it are replaced.`)) return;
    updateForms((cur) => [...cur.filter((f) => f.id !== d.id), { ...d, updatedAt: nowIso() }]);
    setSelectedId(d.id);
  };
  const move = (idx: number, dir: -1 | 1) =>
    form &&
    patchForm(form.id, (f) => {
      const next = [...f.sections];
      const j = idx + dir;
      if (j < 0 || j >= next.length) return f;
      [next[idx], next[j]] = [next[j], next[idx]];
      return { ...f, sections: next };
    });

  const counts = form
    ? {
        normal: resolveForm(form, macroLibrary.templates, { decompression: false }).snapshot.sections.reduce((n, s) => n + s.questions.length, 0),
        decomp: resolveForm(form, macroLibrary.templates, { decompression: true }).snapshot.sections.reduce((n, s) => n + s.questions.length, 0),
      }
    : null;

  return (
    <div className="space-y-4">
      <p className="text-sm text-[var(--text-muted)]">
        Questionnaires you can text or email to a patient from their file (Send form). Each section is one of your Objective
        macros, so the patient picks from the same options you click — and Insert into Objective writes the note exactly as if
        you had clicked them.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <select className={input} onChange={(e) => setSelectedId(e.target.value)} value={form?.id ?? ""}>
          {live.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>
        <button className={`${input} font-semibold`} onClick={() => addForm()} type="button">
          + New form
        </button>
        {form && (
          <button className={`${input} font-semibold`} onClick={() => addForm(form)} type="button">
            Duplicate
          </button>
        )}
        {form && (
          <button className={`${input} font-semibold text-red-700`} onClick={() => deleteForm(form)} type="button">
            Delete
          </button>
        )}
        <button className={`${input} font-semibold`} onClick={restoreDefault} type="button" title="Bring back the shipped New Patient Questionnaire">
          Restore default
        </button>
      </div>

      {!form ? (
        <p className="text-sm">No forms. Click + New form or Restore default.</p>
      ) : (
        <div className="space-y-3 rounded-xl border border-[var(--line-soft)] p-3">
          <div className="grid gap-2 md:grid-cols-2">
            <label className="grid gap-1 text-sm">
              <span className="font-semibold text-[var(--text-muted)]">Form name</span>
              <input className={input} onChange={(e) => patchForm(form.id, (f) => ({ ...f, name: e.target.value }))} value={form.name} />
            </label>
            <div className="self-end text-sm text-[var(--text-muted)]">
              {counts && (counts.normal === counts.decomp ? `${counts.normal} questions` : `${counts.normal} questions (${counts.decomp} for decompression cases)`)}
            </div>
            <label className="grid gap-1 text-sm">
              <span className="font-semibold text-[var(--text-muted)]">Note at the top (English)</span>
              <textarea className={input} onChange={(e) => patchForm(form.id, (f) => ({ ...f, intro: e.target.value }))} rows={2} value={form.intro} />
            </label>
            <label className="grid gap-1 text-sm">
              <span className="font-semibold text-[var(--text-muted)]">Note at the top (Spanish, optional)</span>
              <textarea className={input} onChange={(e) => patchForm(form.id, (f) => ({ ...f, introEs: e.target.value }))} rows={2} value={form.introEs ?? ""} />
            </label>
          </div>

          <h4 className="pt-1 text-sm font-semibold">Sections (in the order the patient sees them)</h4>
          <ul className="space-y-2">
            {form.sections.map((s, idx) => {
              const macro = findSectionMacro(s, macroLibrary.templates);
              const expanded = openSection === s.id;
              return (
                <li className={`rounded-lg border p-2 ${s.enabled ? "border-[var(--line-soft)]" : "border-dashed border-[var(--line-soft)] opacity-70"}`} key={s.id}>
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      checked={s.enabled}
                      onChange={(e) => patchSection(s.id, (x) => ({ ...x, enabled: e.target.checked }))}
                      title="Include this section"
                      type="checkbox"
                    />
                    <input
                      className={`${input} w-48`}
                      onChange={(e) => patchSection(s.id, (x) => ({ ...x, title: e.target.value }))}
                      placeholder="Heading the patient sees"
                      value={s.title}
                    />
                    <select className={input} onChange={(e) => patchSection(s.id, (x) => ({ ...x, macroName: e.target.value }))} value={macro?.buttonName ?? s.macroName}>
                      {!macro && <option value={s.macroName}>⚠ {s.macroName} (not found)</option>}
                      {objectiveMacros.map((m) => (
                        <option key={m.id} value={m.buttonName}>
                          {m.buttonName}
                        </option>
                      ))}
                    </select>
                    <select
                      className={input}
                      onChange={(e) => patchSection(s.id, (x) => ({ ...x, includeWhen: e.target.value as FormIncludeWhen }))}
                      value={s.includeWhen}
                    >
                      {(Object.keys(INCLUDE_WORDS) as FormIncludeWhen[]).map((k) => (
                        <option key={k} value={k}>
                          {INCLUDE_WORDS[k]}
                        </option>
                      ))}
                    </select>
                    <span className="ml-auto flex gap-1">
                      <button className={input} disabled={idx === 0} onClick={() => move(idx, -1)} title="Move up" type="button">
                        ↑
                      </button>
                      <button className={input} disabled={idx === form.sections.length - 1} onClick={() => move(idx, 1)} title="Move down" type="button">
                        ↓
                      </button>
                      <button className={input} onClick={() => setOpenSection(expanded ? "" : s.id)} type="button">
                        {expanded ? "Hide questions" : "Questions"}
                      </button>
                      <button
                        className={`${input} text-red-700`}
                        onClick={() => patchForm(form.id, (f) => ({ ...f, sections: f.sections.filter((x) => x.id !== s.id) }))}
                        title="Remove section"
                        type="button"
                      >
                        ×
                      </button>
                    </span>
                  </div>
                  {expanded && macro && (
                    <div className="mt-2 space-y-3 border-t border-[var(--line-soft)] pt-2">
                      <input
                        className={`${input} w-64`}
                        onChange={(e) => patchSection(s.id, (x) => ({ ...x, titleEs: e.target.value }))}
                        placeholder="Heading in Spanish (optional)"
                        value={s.titleEs ?? ""}
                      />
                      {macro.questions.map((q) => {
                        const o = s.questions?.[q.id] ?? {};
                        const onlyKeys = (s.onlyQuestions ?? []).map((k) => k.toLowerCase().trim());
                        const inOnly = !onlyKeys.length || onlyKeys.includes(q.id.toLowerCase()) || onlyKeys.includes(q.label.toLowerCase().trim());
                        const included = inOnly && !o.hidden;
                        const shown = q.options.filter((opt) => !isStaffOnlyOption(opt));
                        return (
                          <div className="rounded-lg bg-[var(--bg-soft,#f7f7f7)] p-2" key={q.id}>
                            <div className="flex flex-wrap items-center gap-2 text-sm">
                              <input
                                checked={included}
                                onChange={(e) => {
                                  const on = e.target.checked;
                                  patchSection(s.id, (x) => {
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
                              <span className="text-xs text-[var(--text-muted)]">
                                {shown.length === 0 ? "typed answer" : q.multiSelect ? "pick any" : "pick one"} · plus a “something else” box
                              </span>
                            </div>
                            {included && (
                              <div className="mt-1 grid gap-1 md:grid-cols-2">
                                <input className={input} onChange={(e) => patchQuestion(s, q.id, (x) => ({ ...x, label: e.target.value }))} placeholder={`Patient wording (default: ${q.label})`} value={o.label ?? ""} />
                                <input className={input} onChange={(e) => patchQuestion(s, q.id, (x) => ({ ...x, labelEs: e.target.value }))} placeholder="Spanish wording (optional)" value={o.labelEs ?? ""} />
                                {shown.map((opt) => (
                                  <div className="contents" key={opt}>
                                    <input
                                      className={input}
                                      onChange={(e) => patchQuestion(s, q.id, (x) => ({ ...x, optionLabels: { ...(x.optionLabels ?? {}), [opt]: e.target.value } }))}
                                      placeholder={friendlyOptionLabel(opt, { onlyOption: shown.length === 1 })}
                                      title={`Saved in the note as: ${opt}`}
                                      value={o.optionLabels?.[opt] ?? ""}
                                    />
                                    <input
                                      className={input}
                                      onChange={(e) => patchQuestion(s, q.id, (x) => ({ ...x, optionLabelsEs: { ...(x.optionLabelsEs ?? {}), [opt]: e.target.value } }))}
                                      placeholder="Spanish (optional)"
                                      value={o.optionLabelsEs?.[opt] ?? ""}
                                    />
                                  </div>
                                ))}
                                {q.options.some(isStaffOnlyOption) && (
                                  <p className="text-xs text-[var(--text-muted)] md:col-span-2">
                                    Not shown to patients: {q.options.filter(isStaffOnlyOption).join(" · ")} (blanks to fill / staff-only).
                                  </p>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {expanded && !macro && <p className="mt-2 text-sm text-amber-800">No active Objective macro is named “{s.macroName}”. Pick one above.</p>}
                </li>
              );
            })}
          </ul>
          <div className="flex flex-wrap items-center gap-2">
            <select
              className={input}
              onChange={(e) => {
                const name = e.target.value;
                if (!name) return;
                patchForm(form.id, (f) => ({ ...f, sections: [...f.sections, { id: newId("sec"), macroName: name, title: name, enabled: true, includeWhen: "always" }] }));
                e.target.value = "";
              }}
              value=""
            >
              <option value="">+ Add a section from an Objective macro…</option>
              {objectiveMacros.map((m) => (
                <option key={m.id} value={m.buttonName}>
                  {m.buttonName}
                </option>
              ))}
            </select>
            <span className="text-xs text-[var(--text-muted)]">Hover an option box to see the exact words that go in the note.</span>
          </div>
        </div>
      )}
    </div>
  );
}
