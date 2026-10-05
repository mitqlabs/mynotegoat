"use client";

import { Fragment, useMemo, useState } from "react";
import { askGoat, type GoatContext, type GoatResult, type GoatSection } from "@/lib/goat";

const SUGGESTIONS = [
  "When is the next visit?",
  "How many visits so far?",
  "Any gaps in care?",
  "X-ray findings?",
  "What's the treatment plan?",
  "Diagnoses?",
  "How many decompression sessions?",
];

const SECTION_LABEL: Record<GoatSection, string> = {
  info: "Patient info",
  notes: "Notes",
  xray: "X-Ray",
  mri: "MRI / CT",
  specialist: "Specialist",
  appointments: "Appointments",
  treatmentPlan: "Treatment Plan",
  diagnosis: "Diagnosis",
  details: "Additional Details",
};

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Bold the searched words inside a snippet. */
function Highlight({ text, terms }: { text: string; terms: string[] }) {
  if (!terms.length) return <>{text}</>;
  const re = new RegExp(`(${terms.map(escapeRegExp).join("|")})`, "gi");
  return (
    <>
      {text.split(re).map((part, i) =>
        i % 2 === 1 ? (
          <mark key={i} className="rounded bg-[#fff2b3] px-0.5 text-inherit">
            {part}
          </mark>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        ),
      )}
    </>
  );
}

/**
 * G.O.A.T. (Guided Office Answer Tool) — a question box for this patient.
 * Answers come from the patient file's own
 * data via askGoat (rule-based lookups + text search). Nothing is sent
 * anywhere; see src/lib/goat.ts.
 */
export function GoatPanel({
  context,
  onJump,
  fileHref,
  onOpenEncounter,
  currentEncounterId,
  scope = "page",
}: {
  context: GoatContext;
  /** Patient page: scroll to the section an answer came from. */
  onJump?: (section: GoatSection) => void;
  /** Elsewhere (Encounters): open the patient file in a new tab instead. */
  fileHref?: string;
  /** Open the encounter note a SOAP snippet came from. */
  onOpenEncounter?: (encounterId: string) => void;
  /** The note already open (Encounters page), so its snippets say "This note". */
  currentEncounterId?: string;
  /** Wording only: "page" on the patient page, "file" elsewhere. */
  scope?: "page" | "file";
}) {
  const [open, setOpen] = useState(true);
  const [question, setQuestion] = useState("");
  const [asked, setAsked] = useState("");

  // Recomputed from live page data, so an answer updates as the page is edited.
  const result: GoatResult | null = useMemo(
    () => (asked ? askGoat(context, asked) : null),
    [asked, context],
  );

  const ask = (q: string) => {
    const trimmed = q.trim();
    if (!trimmed) return;
    setQuestion(trimmed);
    setAsked(trimmed);
  };

  const nothing = result !== null && result.answers.length === 0 && result.hits.length === 0;
  const firstName = context.patientName.split(",").pop()?.trim() || "this patient";

  const where = scope === "page" ? "this patient's page" : "this patient's file";
  const jumpButton = (section: GoatSection) =>
    onJump ? (
      <button
        type="button"
        className="shrink-0 text-xs font-semibold text-[var(--brand-primary)] hover:underline"
        onClick={() => onJump(section)}
      >
        Go to {SECTION_LABEL[section]} →
      </button>
    ) : fileHref ? (
      <a
        className="shrink-0 text-xs font-semibold text-[var(--brand-primary)] hover:underline"
        href={fileHref}
        rel="noopener"
        target="_blank"
        title={`Opens the patient file (${SECTION_LABEL[section]}) in a new tab`}
      >
        Patient file ↗
      </a>
    ) : null;

  return (
    <article className="panel-card p-3" data-goat-section="goat">
      <button
        className="flex w-full items-center justify-between rounded-xl bg-[#72bdcf] px-3 py-2 text-lg font-semibold text-white"
        onClick={() => setOpen((v) => !v)}
        type="button"
      >
        <span className="flex min-w-0 items-baseline gap-2" title="G.O.A.T. — Guided Office Answer Tool">
          <span>G.O.A.T.</span>
          <span className="truncate text-xs font-normal text-white/85">Guided Office Answer Tool</span>
        </span>
        <span className="text-xl">{open ? "−" : "+"}</span>
      </button>
      {open && (
        <div className="mt-3">
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              ask(question);
            }}
          >
            <input
              aria-label="Ask G.O.A.T. about this patient"
              className="min-w-0 flex-1 rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2 text-sm"
              onChange={(e) => setQuestion(e.target.value)}
              placeholder={`Ask me about ${firstName}…`}
              type="text"
              value={question}
            />
            <button
              className="rounded-xl bg-[var(--brand-primary)] px-3 py-2 text-sm font-semibold text-white disabled:opacity-40"
              disabled={!question.trim()}
              type="submit"
            >
              Ask
            </button>
          </form>

          {!result && (
            <>
              <p className="mt-3 text-sm text-[var(--text-muted)]">
                Hi! I can look things up in {where}: visits, gaps, imaging, the plan, diagnoses,
                billing and notes. Try one:
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    className="rounded-full bg-[var(--bg-soft)] px-2.5 py-1 text-xs font-semibold text-[var(--text-main)] hover:bg-[var(--line-soft)]"
                    onClick={() => ask(s)}
                    type="button"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </>
          )}

          {result && (
            <div className="mt-3 max-h-[30rem] space-y-2 overflow-y-auto pr-1">
              <div className="flex items-center justify-between gap-2 text-xs text-[var(--text-muted)]">
                <span className="min-w-0 truncate">
                  {nothing ? "Hmm," : "Here's what I found for"} <strong>&ldquo;{asked}&rdquo;</strong>
                </span>
                <button
                  className="shrink-0 font-semibold hover:text-[var(--text-main)]"
                  onClick={() => {
                    setAsked("");
                    setQuestion("");
                  }}
                  type="button"
                >
                  Clear
                </button>
              </div>

              {result.answers.map((a) => (
                <div key={a.title} className="rounded-xl border border-[var(--line-soft)] bg-white p-2.5">
                  <div className="text-sm font-semibold">{a.title}</div>
                  <ul className="mt-1 space-y-0.5 text-sm">
                    {a.lines.map((line, i) => (
                      <li key={i} className="whitespace-pre-line">
                        {line}
                      </li>
                    ))}
                  </ul>
                  {a.flag && (
                    <p className="mt-1.5 rounded-md bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-800">
                      {a.flag}
                    </p>
                  )}
                  <div className="mt-1.5 flex items-center justify-between gap-2 border-t border-[var(--line-soft)] pt-1.5 text-xs text-[var(--text-muted)]">
                    <span className="min-w-0">From: {a.source}</span>
                    {jumpButton(a.section)}
                  </div>
                </div>
              ))}

              {result.hits.length > 0 && (
                <div className="rounded-xl border border-[var(--line-soft)] bg-white p-2.5">
                  <div className="text-sm font-semibold">
                    {result.answers.length ? "Also mentioned" : "Mentioned"} in {scope === "page" ? "this page" : "the patient file"} ({result.hits.length})
                  </div>
                  <ul className="mt-1 space-y-2">
                    {result.hits.map((h, i) => (
                      <li key={i} className="text-sm">
                        <div className="flex items-center justify-between gap-2 text-xs text-[var(--text-muted)]">
                          <span className="min-w-0 truncate">
                            <span className="font-semibold text-[var(--text-main)]">{h.kind}</span> · {h.title}
                          </span>
                          {h.encounterId && onOpenEncounter ? (
                            h.encounterId === currentEncounterId ? (
                              <span className="shrink-0 text-xs font-semibold">This note</span>
                            ) : (
                              <button
                                type="button"
                                className="shrink-0 text-xs font-semibold text-[var(--brand-primary)] hover:underline"
                                onClick={() => onOpenEncounter(h.encounterId as string)}
                                title={`Open the ${h.date ?? ""} encounter note`}
                              >
                                Open note →
                              </button>
                            )
                          ) : (
                            jumpButton(h.section)
                          )}
                        </div>
                        <p className="mt-0.5">
                          <Highlight text={h.snippet} terms={result.terms} />
                        </p>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {nothing && (
                <p className="rounded-xl bg-[var(--bg-soft)] p-2.5 text-sm">
                  I couldn&apos;t find that in {where}. I only read what&apos;s there and I won&apos;t
                  guess. Try asking about visits, gaps, X-ray or MRI, the treatment plan,
                  diagnoses, billing or notes.
                </p>
              )}
            </div>
          )}

          <p className="mt-3 text-[11px] text-[var(--text-muted)]">
            G.O.A.T. reads only {where}. Nothing leaves NoteGoat. Uploaded files aren&apos;t read yet.
          </p>
        </div>
      )}
    </article>
  );
}
