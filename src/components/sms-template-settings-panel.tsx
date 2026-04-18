"use client";

import { useState } from "react";
import { useOfficeSettings } from "@/hooks/use-office-settings";
import { useSmsTemplates } from "@/hooks/use-sms-templates";
import {
  createSmsTemplate,
  expandTokens,
  getDefaultSmsTemplates,
  getExamplePreviewContext,
  SMS_TOKENS,
  type SmsTemplate,
} from "@/lib/sms-templates";

export function SmsTemplateSettingsPanel() {
  const { smsTemplates, updateSmsTemplates } = useSmsTemplates();
  const { officeSettings } = useOfficeSettings();
  const [previewId, setPreviewId] = useState<string | null>(null);

  const addTemplate = () => {
    updateSmsTemplates((current) => [
      ...current,
      createSmsTemplate("Untitled Template"),
    ]);
  };

  const loadStarters = () => {
    if (smsTemplates.length > 0) {
      const ok = window.confirm(
        "This will add the 5 starter templates to your existing list. Continue?",
      );
      if (!ok) return;
    }
    updateSmsTemplates((current) => [...current, ...getDefaultSmsTemplates()]);
  };

  const updateField = (
    id: string,
    patch: Partial<Pick<SmsTemplate, "name" | "body">>,
  ) => {
    updateSmsTemplates((current) =>
      current.map((tpl) =>
        tpl.id === id
          ? { ...tpl, ...patch, updatedAt: new Date().toISOString() }
          : tpl,
      ),
    );
  };

  const removeTemplate = (id: string) => {
    const ok = window.confirm("Delete this template? This cannot be undone.");
    if (!ok) return;
    updateSmsTemplates((current) => current.filter((tpl) => tpl.id !== id));
    if (previewId === id) setPreviewId(null);
  };

  const exampleCtx = getExamplePreviewContext({
    officeName: officeSettings.officeName,
    doctorName: officeSettings.doctorName,
  });

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-[var(--line-soft)] bg-[var(--bg-soft)] p-3 text-sm">
        <p className="font-semibold text-[var(--text-primary)]">
          How this works
        </p>
        <p className="mt-1 text-[var(--text-muted)]">
          Texts are sent manually through your Mac&apos;s Messages app
          (iMessage-linked-to-iPhone). Click any patient phone number in the
          app → pick a template → Messages opens with the body pre-filled, and
          you hit send. Nothing automatic, nothing through a backend.
        </p>
        <div className="mt-2 flex flex-wrap gap-2 text-xs">
          {SMS_TOKENS.map((t) => (
            <code
              className="rounded bg-white px-1.5 py-0.5 font-mono text-[11px] text-[var(--text-muted)]"
              key={t.token}
              title={t.description}
            >
              {t.token}
            </code>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2 text-sm font-semibold transition-all active:scale-[0.97] active:shadow-inner"
          onClick={addTemplate}
          type="button"
        >
          + Add Template
        </button>
        <button
          className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2 text-sm font-semibold transition-all active:scale-[0.97] active:shadow-inner"
          onClick={loadStarters}
          type="button"
        >
          Load Starter Pack
        </button>
      </div>

      {smsTemplates.length === 0 ? (
        <p className="rounded-xl border border-dashed border-[var(--line-soft)] bg-white px-4 py-6 text-center text-sm text-[var(--text-muted)]">
          No templates yet. Add one or load the starter pack.
        </p>
      ) : (
        <ul className="space-y-3">
          {smsTemplates.map((tpl) => {
            const preview = expandTokens(tpl.body, exampleCtx);
            const isPreviewing = previewId === tpl.id;
            return (
              <li
                className="rounded-2xl border border-[var(--line-soft)] bg-white p-3"
                key={tpl.id}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    className="flex-1 rounded-lg border border-[var(--line-soft)] px-2 py-1 text-sm font-semibold"
                    onChange={(event) =>
                      updateField(tpl.id, { name: event.target.value })
                    }
                    placeholder="Template name"
                    value={tpl.name}
                  />
                  <button
                    className="rounded-lg border border-[var(--line-soft)] px-2 py-1 text-xs font-semibold"
                    onClick={() =>
                      setPreviewId(isPreviewing ? null : tpl.id)
                    }
                    type="button"
                  >
                    {isPreviewing ? "Hide preview" : "Preview"}
                  </button>
                  <button
                    className="rounded-lg border border-red-300 bg-red-50 px-2 py-1 text-xs font-semibold text-red-700"
                    onClick={() => removeTemplate(tpl.id)}
                    type="button"
                  >
                    Delete
                  </button>
                </div>
                <textarea
                  className="mt-2 w-full rounded-lg border border-[var(--line-soft)] px-2 py-2 text-sm font-mono"
                  onChange={(event) =>
                    updateField(tpl.id, { body: event.target.value })
                  }
                  placeholder="Hi {{FIRST_NAME}}, …"
                  rows={3}
                  value={tpl.body}
                />
                {isPreviewing && (
                  <div className="mt-2 rounded-xl bg-[var(--bg-soft)] p-2 text-sm">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                      Preview (example data)
                    </p>
                    <p className="mt-1 whitespace-pre-wrap">
                      {preview || (
                        <span className="italic text-[var(--text-muted)]">
                          (empty)
                        </span>
                      )}
                    </p>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
