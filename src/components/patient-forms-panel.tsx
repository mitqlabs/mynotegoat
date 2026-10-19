"use client";

/**
 * Patient file → "Send form" (questionnaire link) and the
 * "Questionnaire received" review card.
 */
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useMacroTemplates } from "@/hooks/use-macro-templates";
import { useOfficeSettings } from "@/hooks/use-office-settings";
import { usePatientForms } from "@/hooks/use-patient-forms";
import { refreshFormRequests, useFormRequests } from "@/hooks/use-form-requests";
import { logActivity } from "@/lib/activity-log";
import {
  answerSummary,
  displayStatus,
  formMessage,
  liveForms,
  looksLikeDecompressionCase,
  resolveForm,
} from "@/lib/patient-forms";
import { manageFormRequest, sendFormLink, type FormRequestRow } from "@/lib/patient-forms-client";
import { buildSmsUrl } from "@/lib/sms-templates";

const usDate = (iso: string | null | undefined) => {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-US", { month: "2-digit", day: "2-digit", year: "numeric" });
};
const usDateTime = (iso: string | null | undefined) => {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString("en-US", { month: "2-digit", day: "2-digit", year: "numeric", hour: "numeric", minute: "2-digit" });
};

const STATUS_WORDS = {
  sent: "Sent — not opened yet",
  started: "Started — saving as they go",
  submitted: "Received",
  revoked: "Revoked",
  expired: "Expired",
} as const;

export interface PatientFormsProps {
  patientId: string;
  patientName: string;
  firstName: string;
  phone: string;
  email: string;
  /** Appointment / visit types on this patient's schedule (decompression detection). */
  visitTypes: string[];
}

export function SendFormButton({ patientId, patientName, firstName, phone, email, visitTypes }: PatientFormsProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        className="inline-flex items-center rounded-lg border border-[var(--line-soft)] bg-white px-3 py-1.5 text-sm font-semibold"
        onClick={() => setOpen(true)}
        title="Send this patient a questionnaire link (no login needed)"
        type="button"
      >
        Send form
      </button>
      {open && (
        <SendFormDialog
          email={email}
          firstName={firstName}
          onClose={() => setOpen(false)}
          patientId={patientId}
          patientName={patientName}
          phone={phone}
          visitTypes={visitTypes}
        />
      )}
    </>
  );
}

function SendFormDialog({ patientId, patientName, firstName, phone, email, visitTypes, onClose }: PatientFormsProps & { onClose: () => void }) {
  const { forms } = usePatientForms();
  const { macroLibrary } = useMacroTemplates();
  const { officeSettings } = useOfficeSettings();
  const { rows, available } = useFormRequests({ patientId });
  const choices = liveForms(forms);
  const [formId, setFormId] = useState(choices[0]?.id ?? "");
  const [decompression, setDecompression] = useState(() => looksLikeDecompressionCase(visitTypes));
  const [days, setDays] = useState(14);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [link, setLink] = useState<{ url: string; expiresAt: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const form = choices.find((f) => f.id === formId) ?? null;
  const resolved = form ? resolveForm(form, macroLibrary.templates, { decompression }) : null;
  const questionCount = resolved ? resolved.snapshot.sections.reduce((n, s) => n + s.questions.length, 0) : 0;
  const hasDecompSection = Boolean(form?.sections.some((s) => s.enabled && s.includeWhen !== "always"));

  const create = async () => {
    if (!resolved || !form) return;
    setBusy(true);
    setError("");
    const res = await sendFormLink({ patientId, snapshot: resolved.snapshot, officeName: officeSettings.officeName ?? "", expiresDays: days });
    setBusy(false);
    if (!res.ok) return setError(res.error);
    setLink({ url: res.url, expiresAt: res.expiresAt });
    refreshFormRequests();
    logActivity({ category: "patients", action: "form.sent", summary: `Created ${form.name} link (expires ${usDate(res.expiresAt)})`, patientId, patientName });
  };

  const message = link ? formMessage(firstName, form?.name ?? "questionnaire", link.url, officeSettings.officeName ?? "") : "";

  const revoke = async (row: FormRequestRow) => {
    if (!window.confirm("Turn this link off? The patient won't be able to open it anymore.")) return;
    const res = await manageFormRequest(row.id, "revoke");
    if (!res.ok) return setError(res.error);
    refreshFormRequests();
    logActivity({ category: "patients", action: "form.revoked", summary: `Revoked ${row.form_name} link`, patientId, patientName });
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/30 p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()} role="dialog">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-5 shadow-xl">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-lg font-semibold">Send form to {patientName}</h3>
          <button className="text-xl text-[var(--text-muted)]" onClick={onClose} type="button" aria-label="Close">
            ×
          </button>
        </div>

        {!link ? (
          <div className="space-y-3">
            {choices.length === 0 ? (
              <p className="text-sm">No forms yet. Add one in Settings → Templates → Forms.</p>
            ) : (
              <label className="grid gap-1 text-sm">
                <span className="font-semibold text-[var(--text-muted)]">Form</span>
                <select className="rounded-xl border border-[var(--line-soft)] px-3 py-2" onChange={(e) => setFormId(e.target.value)} value={formId}>
                  {choices.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {hasDecompSection && (
              <label className="flex items-center gap-2 text-sm">
                <input checked={decompression} onChange={(e) => setDecompression(e.target.checked)} type="checkbox" />
                Spinal decompression case
                <span className="text-xs text-[var(--text-muted)]">
                  {looksLikeDecompressionCase(visitTypes) ? "(found a decompression visit on the schedule)" : "(adds the decompression questions)"}
                </span>
              </label>
            )}
            <label className="grid gap-1 text-sm">
              <span className="font-semibold text-[var(--text-muted)]">Link works for</span>
              <select className="rounded-xl border border-[var(--line-soft)] px-3 py-2" onChange={(e) => setDays(Number(e.target.value))} value={days}>
                {[3, 7, 14, 30].map((d) => (
                  <option key={d} value={d}>
                    {d} days
                  </option>
                ))}
              </select>
            </label>
            {resolved && (
              <p className="text-sm text-[var(--text-muted)]">
                {resolved.snapshot.sections.filter((s) => s.questions.length).map((s) => s.title).join(" · ")} — {questionCount} question{questionCount === 1 ? "" : "s"}.
              </p>
            )}
            {resolved && resolved.missing.length > 0 && (
              <p className="rounded-lg bg-amber-50 p-2 text-sm text-amber-900">
                Left out (no Objective macro with this name): {resolved.missing.join(", ")}. Fix the name in Settings → Forms.
              </p>
            )}
            {error && <p className="text-sm font-semibold text-red-700">{error}</p>}
            <button
              className="w-full rounded-xl bg-[var(--brand-primary)] py-2.5 font-semibold text-white disabled:opacity-50"
              disabled={busy || !resolved || questionCount === 0}
              onClick={() => void create()}
              type="button"
            >
              {busy ? "Creating…" : "Create secure link"}
            </button>
            <p className="text-xs text-[var(--text-muted)]">
              The link opens only this patient&apos;s form, needs no login, and stops working when it expires or you revoke it.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm">Link ready — works until {usDate(link.expiresAt)}. Send it any way you like:</p>
            <input className="w-full rounded-xl border border-[var(--line-soft)] bg-[var(--bg-soft,#f7f7f7)] px-3 py-2 text-sm" readOnly value={link.url} onFocus={(e) => e.target.select()} />
            <div className="flex flex-wrap gap-2">
              <button
                className="rounded-xl border border-[var(--line-soft)] px-3 py-2 text-sm font-semibold"
                onClick={() => {
                  void navigator.clipboard?.writeText(link.url).then(
                    () => setCopied(true),
                    (err: unknown) => {
                      console.warn("[forms] copy failed:", err);
                      setCopied(false);
                    },
                  );
                }}
                type="button"
              >
                {copied ? "✓ Copied" : "Copy link"}
              </button>
              {phone.replace(/\D/g, "").length >= 10 && (
                <a className="rounded-xl border border-[var(--line-soft)] px-3 py-2 text-sm font-semibold text-[var(--brand-primary)]" href={buildSmsUrl(phone, message)}>
                  Text it
                </a>
              )}
              {email.includes("@") && (
                <a
                  className="rounded-xl border border-[var(--line-soft)] px-3 py-2 text-sm font-semibold text-[var(--brand-primary)]"
                  href={`mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(form?.name ?? "Questionnaire")}&body=${encodeURIComponent(message)}`}
                >
                  Email it
                </a>
              )}
            </div>
            <p className="text-xs text-[var(--text-muted)]">Text opens Messages; Email opens your mail app. Nothing is sent until you press send there.</p>
            <button className="w-full rounded-xl border border-[var(--line-soft)] py-2 font-semibold" onClick={onClose} type="button">
              Done
            </button>
          </div>
        )}

        {available && rows.length > 0 && (
          <div className="mt-5 border-t border-[var(--line-soft)] pt-3">
            <h4 className="mb-2 text-sm font-semibold">Links for this patient</h4>
            <ul className="space-y-1.5 text-sm">
              {rows.slice(0, 8).map((r) => {
                const st = displayStatus(r);
                return (
                  <li className="flex items-center justify-between gap-2" key={r.id}>
                    <span>
                      {r.form_name} · {usDate(r.created_at)} · <span className="text-[var(--text-muted)]">{STATUS_WORDS[st]}</span>
                    </span>
                    {(st === "sent" || st === "started") && (
                      <button className="text-xs font-semibold text-red-700 underline" onClick={() => void revoke(r)} type="button">
                        Revoke
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

export function QuestionnaireReviewCards({
  patientId,
  patientName,
  encounters,
}: {
  patientId: string;
  patientName: string;
  encounters: Array<{ id: string; encounterDate: string; appointmentType: string; signed: boolean }>;
}) {
  const router = useRouter();
  const { rows, available } = useFormRequests({ patientId });
  const [error, setError] = useState("");
  const [showPast, setShowPast] = useState(false);
  const open = useMemo(() => encounters.filter((e) => !e.signed), [encounters]);
  const [encounterPick, setEncounterPick] = useState<Record<string, string>>({});
  if (!available) return null;
  const received = rows.filter((r) => r.status === "submitted");
  const fresh = received.filter((r) => r.review_status === "new");
  const past = received.filter((r) => r.review_status !== "new");
  if (!received.length) return null;

  const insert = (row: FormRequestRow) => {
    const encounterId = encounterPick[row.id] || open[0]?.id;
    if (!encounterId) return;
    router.push(`/encounters?patientId=${encodeURIComponent(patientId)}&encounterId=${encodeURIComponent(encounterId)}&questionnaire=${encodeURIComponent(row.id)}`);
  };
  const dismiss = async (row: FormRequestRow) => {
    if (!window.confirm("Dismiss this questionnaire? Nothing goes into a note. The answers stay saved and you can reopen it under Past questionnaires.")) return;
    const res = await manageFormRequest(row.id, "dismissed");
    if (!res.ok) return setError(res.error);
    refreshFormRequests();
    logActivity({ category: "patients", action: "form.dismissed", summary: `Dismissed ${row.form_name}`, patientId, patientName });
  };
  const reopen = async (row: FormRequestRow) => {
    const res = await manageFormRequest(row.id, "reopen");
    if (!res.ok) return setError(res.error);
    refreshFormRequests();
  };

  const answersOf = (r: FormRequestRow) => r.raw_submission?.answers ?? r.answers;
  const snapOf = (r: FormRequestRow) => r.raw_submission?.snapshot ?? r.snapshot;

  return (
    <section className="panel-card space-y-3 p-4" data-testid="questionnaire-review">
      {fresh.map((r) => (
        <div className="rounded-xl border-2 border-emerald-300 bg-emerald-50/60 p-3" key={r.id}>
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-base font-semibold">📋 Questionnaire received — {r.form_name}</h3>
            <span className="text-xs text-[var(--text-muted)]">Sent {usDate(r.created_at)}{r.created_by_label ? ` by ${r.created_by_label}` : ""} · received {usDateTime(r.submitted_at)}</span>
          </div>
          <AnswerList row={r} answers={answersOf(r)} snapshot={snapOf(r)} />
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {open.length > 0 ? (
              <>
                <select
                  className="rounded-lg border border-[var(--line-soft)] bg-white px-2 py-1.5 text-sm"
                  onChange={(e) => setEncounterPick((m) => ({ ...m, [r.id]: e.target.value }))}
                  value={encounterPick[r.id] || open[0].id}
                >
                  {open.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.encounterDate} · {e.appointmentType || "Visit"}
                    </option>
                  ))}
                </select>
                <button className="rounded-lg bg-[var(--brand-primary)] px-3 py-1.5 text-sm font-semibold text-white" onClick={() => insert(r)} type="button">
                  Insert into Objective
                </button>
              </>
            ) : (
              <span className="text-sm text-[var(--text-muted)]">No open visit note yet — it&apos;s offered automatically when this patient&apos;s next note is opened.</span>
            )}
            <button className="rounded-lg border border-[var(--line-soft)] bg-white px-3 py-1.5 text-sm font-semibold" onClick={() => void dismiss(r)} type="button">
              Dismiss
            </button>
          </div>
        </div>
      ))}
      {error && <p className="text-sm font-semibold text-red-700">{error}</p>}
      {past.length > 0 && (
        <div>
          <button className="text-sm font-semibold text-[var(--brand-primary)] underline" onClick={() => setShowPast((v) => !v)} type="button">
            {showPast ? "Hide" : "Show"} past questionnaires ({past.length})
          </button>
          {showPast && (
            <ul className="mt-2 space-y-3">
              {past.map((r) => (
                <li className="rounded-xl border border-[var(--line-soft)] p-3" key={r.id}>
                  <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2 text-sm">
                    <span className="font-semibold">{r.form_name} · received {usDate(r.submitted_at)}</span>
                    <span className="text-[var(--text-muted)]">
                      {r.review_status === "inserted" ? "Inserted" : "Dismissed"}
                      {r.reviewed_by_label ? ` by ${r.reviewed_by_label}` : ""} {usDateTime(r.reviewed_at)}
                    </span>
                  </div>
                  <AnswerList row={r} answers={answersOf(r)} snapshot={snapOf(r)} />
                  <button className="mt-2 text-xs font-semibold underline" onClick={() => void reopen(r)} type="button">
                    Review again
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

function AnswerList({ answers, snapshot }: { row: FormRequestRow; answers: FormRequestRow["answers"]; snapshot: FormRequestRow["snapshot"] }) {
  const groups = answerSummary(snapshot, answers ?? {});
  if (!groups.length) return <p className="text-sm text-[var(--text-muted)]">No answers were filled in.</p>;
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {groups.map((g) => (
        <div key={g.section}>
          <h4 className="text-sm font-semibold text-[var(--brand-primary)]">{g.section}</h4>
          <ul className="text-sm">
            {g.rows.map((r) => (
              <li key={r.question}>
                <span className="text-[var(--text-muted)]">{r.question}</span> — {r.answer}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
