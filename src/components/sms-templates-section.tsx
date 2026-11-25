"use client";

/**
 * Text Reminders → SMS Templates. The office writes the messages here.
 * The same saved messages Auto Texts already use.
 */

import { useEffect, useRef, useState } from "react";
import { DraftTextarea } from "@/components/draft-textarea";
import { CollapsibleSection } from "@/components/collapsible-section";
import { appConfirm } from "@/components/app-dialog";
import { useSmsTemplates } from "@/hooks/use-sms-templates";
import { MESSAGE_WORDS } from "@/lib/message-library";
import { shortcutName } from "@/lib/text-rules";
import type { SmsReminderSettings } from "@/lib/sms-reminders";
import { createSmsTemplate } from "@/lib/sms-templates";

const field = "w-full rounded-xl border border-[var(--line-soft)] bg-[var(--field-bg)] px-3 text-[var(--text-main)]";
const wordBtn = "rounded-xl border border-[var(--line-soft)] bg-[var(--bg-panel)] px-3 py-2 text-sm font-semibold text-[var(--text-main)]";

export function SmsTemplatesSection({
  settings,
  open,
  onToggle,
  initialOpenId = null,
}: {
  settings: SmsReminderSettings;
  open: boolean;
  onToggle: (next: boolean) => void;
  /** Screenshot harness. Opens this template. */
  initialOpenId?: string | null;
}) {
  const { smsTemplates, updateSmsTemplates } = useSmsTemplates();
  const [openId, setOpenId] = useState<string | null>(initialOpenId);

  const edit = (id: string, patch: { name?: string; body?: string }) =>
    updateSmsTemplates((current) => current.map((row) => (row.id === id ? { ...row, ...patch, updatedAt: new Date().toISOString() } : row)));

  const add = () => {
    const created = createSmsTemplate("New template", "Hi {first name}, ");
    updateSmsTemplates((current) => [...current, created]);
    setOpenId(created.id);
    onToggle(true);
  };

  const addRef = useRef(add);
  useEffect(() => {
    addRef.current = add;
  });
  useEffect(() => {
    const onNew = () => addRef.current();
    window.addEventListener("notegoat:new-text-template", onNew);
    return () => window.removeEventListener("notegoat:new-text-template", onNew);
  }, []);

  const usedBy = (id: string) =>
    (settings.rules ?? []).filter((rule) => rule.templateId === id).map((rule) => rule.shortcutName || shortcutName(rule));

  const remove = async (id: string, name: string) => {
    if (usedBy(id).length) return;
    if (!(await appConfirm(`Delete ${name}?`, { danger: true, confirmLabel: "Delete" }))) return;
    updateSmsTemplates((current) => current.filter((row) => row.id !== id));
    if (openId === id) setOpenId(null);
  };

  return (
    <CollapsibleSection onToggle={onToggle} open={open} testId="section-templates" title="SMS Templates">
      <div className="grid w-full min-w-0 max-w-full gap-3" data-testid="sms-templates">
        <button className="w-full rounded-xl bg-[var(--brand-primary)] px-4 py-4 text-lg font-bold text-[var(--on-brand)]" data-testid="template-add" onClick={add} type="button">
          New template
        </button>
        {smsTemplates.length === 0 ? <p className="text-lg font-semibold text-[var(--text-main)]">No templates yet.</p> : null}
        {smsTemplates.map((template) => {
          const editing = openId === template.id;
          const used = usedBy(template.id);
          return (
            <div className="min-w-0 max-w-full overflow-hidden rounded-xl border border-[var(--line-soft)] bg-[var(--bg-panel)] text-[var(--text-main)]" data-testid="template-card" key={template.id}>
              <button className="flex w-full min-w-0 items-center justify-between gap-3 px-4 py-4 text-left" onClick={() => setOpenId(editing ? null : template.id)} type="button">
                <span className="min-w-0 flex-1">
                  <span className="block break-words text-lg font-bold">{template.name}</span>
                  {!editing ? <span className="block truncate text-base text-[var(--text-muted)]">{template.body}</span> : null}
                </span>
                <span className="text-[var(--text-muted)]">{editing ? "▾" : "▸"}</span>
              </button>
              {editing ? (
                <div className="grid gap-3 border-t border-[var(--line-soft)] px-4 py-4">
                  <input
                    aria-label="Template name"
                    className={`${field} h-[42px]`}
                    defaultValue={template.name}
                    key={`${template.id}:${template.name}`}
                    onBlur={(event) => {
                      const name = event.target.value.trim();
                      if (name && name !== template.name) edit(template.id, { name });
                      else event.target.value = template.name;
                    }}
                  />
                  <DraftTextarea className={`${field} min-h-[96px] py-2`} key={template.id} onSave={(body) => edit(template.id, { body })} value={template.body} />
                  <div className="flex flex-wrap gap-2" data-testid="template-words">
                    {MESSAGE_WORDS.map((word) => (
                      <button
                        className={wordBtn}
                        key={word.token}
                        onClick={() =>
                          updateSmsTemplates((current) =>
                            current.map((row) =>
                              row.id === template.id
                                ? { ...row, body: `${row.body}${row.body && !/\s$/.test(row.body) ? " " : ""}${word.token}`, updatedAt: new Date().toISOString() }
                                : row,
                            ),
                          )
                        }
                        type="button"
                      >
                        {word.label === "Office phone" ? "Office number" : word.label}
                      </button>
                    ))}
                  </div>
                  {used.length === 0 ? (
                    <button className="text-left text-base font-semibold text-[var(--text-main)]" data-testid="template-delete" onClick={() => void remove(template.id, template.name)} type="button">
                      Delete
                    </button>
                  ) : (
                    <p className="text-[var(--text-muted)]">{used.join(", ")}</p>
                  )}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </CollapsibleSection>
  );
}
