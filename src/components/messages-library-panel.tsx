"use client";

/**
 * The Messages library: every saved text message, with its name and words.
 * Staff add, edit and delete them here, then attach one to each Auto Text.
 * Saved through useSmsTemplates (cloud-synced; deletes are markers so they
 * reach every computer and a stale copy cannot bring a message back).
 */
import { useEffect, useState } from "react";
import { DraftTextarea } from "@/components/draft-textarea";
import { appConfirm } from "@/components/app-dialog";
import { useSmsTemplates } from "@/hooks/use-sms-templates";
import { useOfficeSettings } from "@/hooks/use-office-settings";
import { autoTextsUsing, MESSAGE_WORDS } from "@/lib/message-library";
import { expandTokens } from "@/lib/sms-render";
import { loadSmsReminderSettings, SMS_REMINDER_SETTINGS_KEY, type SmsReminderSettings } from "@/lib/sms-reminders";
import { createSmsTemplate } from "@/lib/sms-templates";
import { onLocalChange } from "@/lib/local-sync";

const rowBtn = "rounded-lg border border-[var(--line-soft)] bg-white px-3 py-1.5 text-sm font-semibold";
const btn = "h-[42px] rounded-xl border border-[var(--line-soft)] bg-white px-4 text-sm font-semibold";

/** Which Auto Texts use a message. `settings` comes from the Text Reminders page when we are on it. */
export function MessagesLibraryPanel({ settings }: { settings?: Pick<SmsReminderSettings, "templateId" | "birthdayTemplateId"> }) {
  const { smsTemplates, updateSmsTemplates } = useSmsTemplates();
  const { officeSettings } = useOfficeSettings();
  const [saved, setSaved] = useState(() => loadSmsReminderSettings());
  useEffect(() => onLocalChange(SMS_REMINDER_SETTINGS_KEY, () => setSaved(loadSmsReminderSettings())), []);
  const attach = settings ?? saved;
  const [openId, setOpenId] = useState<string | null>(null);

  const edit = (id: string, patch: { name?: string; body?: string }) =>
    updateSmsTemplates((current) => current.map((t) => (t.id === id ? { ...t, ...patch, updatedAt: new Date().toISOString() } : t)));

  const add = () => {
    const created = createSmsTemplate("New message", "Hi {first name}, ");
    updateSmsTemplates((current) => [...current, created]);
    setOpenId(created.id);
  };

  const remove = async (id: string, name: string) => {
    // Re-read: another computer may have attached it a moment ago.
    if (autoTextsUsing(id, { ...loadSmsReminderSettings(), ...(settings ?? {}) }).length) return;
    if (!(await appConfirm(`Delete the message "${name}"? This cannot be undone.`, { danger: true, confirmLabel: "Delete" }))) return;
    updateSmsTemplates((current) => current.filter((t) => t.id !== id));
  };

  return (
    <div className="grid gap-3" data-testid="messages-library">
      <p className="text-[var(--text-muted)]">
        Write your text messages here. Then pick which one each Auto Text sends. You can also pick any of them when you text a patient yourself.
      </p>
      <div>
        <button className={btn} data-testid="message-add" onClick={add} type="button">
          + New message
        </button>
      </div>

      {smsTemplates.length === 0 && <p className="text-[var(--text-muted)]">No messages yet. Tap &quot;+ New message&quot; to write one.</p>}

      {smsTemplates.map((t) => {
        const usedBy = autoTextsUsing(t.id, attach);
        const open = openId === t.id;
        const example = expandTokens(t.body, {
          patient: { firstName: "Jane", lastName: "Doe", fullName: "Jane Doe" },
          appointment: { date: "11/04/26", time: "10:30 AM" },
          office: { officeName: officeSettings.officeName, doctorName: officeSettings.doctorName, phone: officeSettings.phone },
        });
        return (
          <div className="rounded-xl border border-[var(--line-soft)] bg-white" data-testid="message-card" key={t.id}>
            <button
              aria-expanded={open}
              className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left"
              onClick={() => setOpenId(open ? null : t.id)}
              type="button"
            >
              <span className="min-w-0">
                <span className="block font-bold">{t.name}</span>
                {!open && <span className="block truncate text-[var(--text-muted)]">{t.body}</span>}
              </span>
              <span className="flex shrink-0 items-center gap-2">
                {usedBy.length > 0 && (
                  <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-sm font-semibold text-emerald-800" data-testid="message-used-by">
                    Used by {usedBy.join(" and ")}
                  </span>
                )}
                <span aria-hidden className="text-[var(--text-muted)]">{open ? "▾" : "▸"}</span>
              </span>
            </button>
            {open && (
              <div className="grid gap-3 border-t border-[var(--line-soft)] px-4 py-3">
                <label className="grid gap-1">
                  <span className="text-xs font-bold uppercase tracking-wide text-[var(--text-muted)]">Name</span>
                  <input
                    className="h-[42px] rounded-xl border border-[var(--line-soft)] bg-white px-3"
                    defaultValue={t.name}
                    key={`${t.id}:${t.name}`}
                    onBlur={(e) => {
                      const name = e.target.value.trim();
                      if (name && name !== t.name) edit(t.id, { name });
                      else e.target.value = t.name;
                    }}
                  />
                </label>
                <div className="grid gap-1">
                  <span className="text-xs font-bold uppercase tracking-wide text-[var(--text-muted)]">Message</span>
                  <DraftTextarea
                    className="min-h-[96px] rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
                    key={t.id}
                    onSave={(body) => edit(t.id, { body })}
                    value={t.body}
                  />
                </div>
                <div className="grid gap-1" data-testid="message-words">
                  <span className="text-sm font-semibold">Tap a word to add it. It is swapped for the real one when the text goes out.</span>
                  <div className="flex flex-wrap gap-2">
                    {MESSAGE_WORDS.map((w) => (
                      <button className={rowBtn} key={w.token} onClick={() =>
                          updateSmsTemplates((current) =>
                            current.map((m) =>
                              m.id === t.id
                                ? { ...m, body: `${m.body}${m.body && !/\s$/.test(m.body) ? " " : ""}${w.token}`, updatedAt: new Date().toISOString() }
                                : m,
                            ),
                          )
                        } title={w.plain} type="button">
                        {w.label}
                      </button>
                    ))}
                  </div>
                </div>
                <p className="rounded-xl bg-[var(--bg-soft)] px-3 py-2" data-testid="message-example">
                  <span className="font-semibold">Example: </span>
                  {example}
                </p>
                {t.body.length > 160 && <p className="text-[var(--text-muted)]">This is a long message. Some phones send it as more than one text.</p>}
                <p className="text-[var(--text-muted)]">Keep it short. Do not put health details in a text.</p>
                <div className="flex flex-wrap items-center gap-3">
                  {usedBy.length > 0 ? (
                    <p className="text-[var(--text-muted)]" data-testid="message-delete-blocked">
                      You cannot delete this while {usedBy.join(" and ")} uses it. Pick a different message in Auto Texts first.
                    </p>
                  ) : (
                    <button className={`${rowBtn} text-red-700`} data-testid="message-delete" onClick={() => void remove(t.id, t.name)} type="button">
                      Delete message
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
