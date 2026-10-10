"use client";

import { Fragment, useMemo, useState, type ReactNode } from "react";
import { askGoat, type GoatAnswerGroup, type GoatBlock, type GoatContext, type GoatResult, type GoatSection } from "@/lib/goat";
import { GOAT_LINES_PER_FILE, type GoatFileMatch, type GoatFilesResult } from "@/lib/goat-docs";
import { makeMatcher } from "@/lib/goat-terms";
import type { GoatFilesController } from "@/hooks/use-goat-files";

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

/** Mark the searched words (and their synonyms) inside a snippet — whole words only. */
function Highlight({ text, terms }: { text: string; terms: string[] }) {
  const matcher = useMemo(() => makeMatcher(terms), [terms]);
  if (!terms.length) return <>{text}</>;
  const parts: ReactNode[] = [];
  let at = 0;
  for (const [start, end] of matcher.ranges(text)) {
    if (start > at) parts.push(<Fragment key={`t${at}`}>{text.slice(at, start)}</Fragment>);
    parts.push(
      <mark key={`m${start}`} className="rounded bg-[#fff2b3] px-0.5 text-inherit">
        {text.slice(start, end)}
      </mark>,
    );
    at = end;
  }
  if (at < text.length) parts.push(<Fragment key={`t${at}`}>{text.slice(at)}</Fragment>);
  return <>{parts}</>;
}

const DOC_BADGE: Record<GoatFileMatch["docType"], { label: string; className: string }> = {
  report: { label: "Report", className: "bg-emerald-50 text-emerald-800" },
  referral: { label: "Referral", className: "bg-amber-50 text-amber-800" },
  other: { label: "Document", className: "bg-slate-100 text-slate-700" },
};

/** One region's findings: a subheading, then each item on its own line, in full. */
function FindingsBlock({ block, highlight }: { block: GoatBlock; highlight: string[] }) {
  const [all, setAll] = useState(false);
  const focused = block.focus && block.focus.length < block.items.length && !all;
  const shown = focused ? block.items.filter((_, i) => block.focus!.includes(i)) : block.items;
  return (
    <div className="mt-1.5">
      {block.heading &&
        (block.plain ? (
          <div className="text-sm font-semibold text-[#2f7f93]">{block.heading}</div>
        ) : (
          <div className="text-xs font-semibold uppercase tracking-wide text-[#2f7f93]">{block.heading}</div>
        ))}
      <ul className="mt-0.5 space-y-1 text-sm leading-snug">
        {shown.map((item, i) => (
          <li key={i} className="whitespace-pre-line">
            <Highlight text={item} terms={highlight} />
          </li>
        ))}
      </ul>
      {block.focus && block.focus.length < block.items.length && (
        <button
          className="mt-0.5 text-xs font-semibold text-[var(--brand-primary)] hover:underline"
          onClick={() => setAll((v) => !v)}
          type="button"
        >
          {all ? "Show less" : `Show all ${block.items.length}${block.heading ? ` ${block.heading}` : ""} findings`}
        </button>
      )}
    </div>
  );
}

/** An answer's records (e.g. each MRI) with their findings by region. */
function AnswerGroups({ groups, highlight }: { groups: GoatAnswerGroup[]; highlight: string[] }) {
  return (
    <div className="space-y-2.5">
      {groups.map((g, i) => (
        <div key={i} className={i ? "border-t border-[var(--line-soft)] pt-2" : ""}>
          <p className="text-sm">{g.lead}</p>
          {g.note && <p className="text-xs text-[var(--text-muted)]">{g.note}</p>}
          {g.blocks.map((b, j) => (
            <FindingsBlock key={j} block={b} highlight={highlight} />
          ))}
        </div>
      ))}
    </div>
  );
}

/** One file's quoted lines (first few, "Show all" for the rest — or all of them when expanded). */
function FileMatchBlock({
  match,
  highlight,
  onOpen,
  expanded = false,
}: {
  match: GoatFileMatch;
  highlight: string[];
  onOpen?: (fileId: string, page?: number) => void;
  expanded?: boolean;
}) {
  const [all, setAll] = useState(expanded);
  const shown = all ? match.lines : match.lines.slice(0, GOAT_LINES_PER_FILE);
  const badge = DOC_BADGE[match.docType];
  return (
    <li className="rounded-lg border border-[var(--line-soft)] p-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold" title={match.name}>
            {match.name}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-[var(--text-muted)]">
            <span className={`rounded px-1.5 py-px font-semibold ${badge.className}`}>{badge.label}</span>
            {match.date && (
              <span>
                {match.dateLabel === "dated" ? "Dated" : "Uploaded"} {match.date}
              </span>
            )}
            {match.who.length > 0 && <span>· {match.who.join(", ")}</span>}
          </div>
        </div>
        {onOpen && (
          <button
            className="shrink-0 text-xs font-semibold text-[var(--brand-primary)] hover:underline"
            onClick={() => onOpen(match.fileId, match.lines[0]?.page)}
            title="Opens the file in a new tab"
            type="button"
          >
            Open file ↗
          </button>
        )}
      </div>
      <ul className="mt-1.5 space-y-1 text-sm">
        {shown.map((line, i) => (
          <li key={i} className={`flex gap-2 ${line.inSection && !line.heading ? "pl-3" : ""}`}>
            <span className="w-8 shrink-0 pt-px text-[11px] text-[var(--text-muted)]">p.{line.page}</span>
            {line.heading ? (
              <span className="min-w-0 text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                <Highlight text={line.text} terms={highlight} />
              </span>
            ) : (
              <span className="min-w-0">
                &ldquo;<Highlight text={line.text} terms={highlight} />&rdquo;
              </span>
            )}
          </li>
        ))}
      </ul>
      {match.lines.length > GOAT_LINES_PER_FILE && (
        <button
          className="mt-1 text-xs font-semibold text-[var(--brand-primary)] hover:underline"
          onClick={() => setAll((v) => !v)}
          type="button"
        >
          {all ? "Show fewer" : `Show all ${match.lines.length} lines`}
        </button>
      )}
    </li>
  );
}

function FilesCard({ files, onOpen }: { files: GoatFilesResult; onOpen?: (fileId: string, page?: number) => void }) {
  return (
    <div className="rounded-xl border border-[var(--line-soft)] bg-white p-2.5">
      <div className="text-sm font-semibold">
        {files.title ? (
          <>
            {files.title} <span className="font-normal text-[var(--text-muted)]">· from patient files</span>
          </>
        ) : (
          "From patient files"
        )}
      </div>
      {files.notes.length > 0 && (
        <ul className="mt-1 space-y-0.5 text-xs text-[var(--text-muted)]">
          {files.notes.map((n, i) => (
            <li key={i}>{n}</li>
          ))}
        </ul>
      )}
      {files.matches.length > 0 && (
        <ul className="mt-2 space-y-2">
          {files.matches.map((m) => (
            <FileMatchBlock key={m.fileId} expanded={files.expanded} highlight={files.highlight} match={m} onOpen={onOpen} />
          ))}
        </ul>
      )}
      {files.moreFiles > 0 && (
        <p className="mt-1.5 text-xs text-[var(--text-muted)]">
          …and {files.moreFiles} more file{files.moreFiles === 1 ? "" : "s"} mention this. Ask about something more specific to narrow it down.
        </p>
      )}
    </div>
  );
}

/** "8 of 10 files read" + Read files / progress / Stop. */
function FilesStatus({ files }: { files: GoatFilesController }) {
  const { counts, reader } = files;
  if (!files.enabled || counts.total === 0) return null;
  const readable = counts.total - counts.other;
  const toRead = counts.waiting + counts.scanned + counts.failed;
  const cur = reader.current;
  let progress = "";
  if (reader.running && cur) {
    const step =
      cur.step === "downloading"
        ? "opening"
        : cur.step === "ocr"
          ? `reading scanned page ${cur.page} of ${cur.pages}${cur.pageProgress ? ` (${Math.round(cur.pageProgress * 100)}%)` : ""}`
          : `page ${cur.page} of ${cur.pages}`;
    progress = `Reading ${cur.fileName}: ${step}`;
  }
  const pct = reader.total ? Math.round(((reader.done + (cur?.pages ? cur.page / cur.pages : 0)) / reader.total) * 100) : 0;
  return (
    <div className="mt-2 rounded-xl bg-[var(--bg-soft)] px-2.5 py-2 text-xs text-[var(--text-muted)]">
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0">
          Patient files: {counts.read} of {readable} read
          {counts.scanned > 0 && ` · ${counts.scanned} scanned file${counts.scanned === 1 ? " needs" : "s need"} OCR`}
          {counts.failed > 0 && ` · ${counts.failed} couldn't be read`}
        </span>
        {reader.running ? (
          <button className="shrink-0 font-semibold text-[var(--text-main)] hover:underline" onClick={files.stop} type="button">
            Stop
          </button>
        ) : (
          toRead > 0 && (
            <button
              className="shrink-0 font-semibold text-[var(--brand-primary)] hover:underline"
              onClick={files.readAll}
              title="Reads this patient's files here in your browser, including scanned pages"
              type="button"
            >
              Read files
            </button>
          )
        )}
      </div>
      {reader.running && (
        <>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white">
            <div className="h-full rounded-full bg-[#72bdcf] transition-all" style={{ width: `${Math.max(4, pct)}%` }} />
          </div>
          <div className="mt-1 truncate">
            {progress} {reader.total > 1 && `(${Math.min(reader.done + 1, reader.total)} of ${reader.total})`}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * G.O.A.T. — a question box for this patient.
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
  files,
}: {
  context: GoatContext;
  /** Patient Files reader (status, Read files, Open file). Omitted → files aren't offered. */
  files?: GoatFilesController;
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
  // "Also mentioned" open/closed, per question (flipped from its default).
  const [hitsFlipped, setHitsFlipped] = useState("");

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

  const fileResult = result?.files ?? null;
  const filesOn = Boolean(files?.enabled);
  const nothing =
    result !== null &&
    result.answers.length === 0 &&
    result.hits.length === 0 &&
    !(fileResult && (fileResult.matches.length || fileResult.notes.length));
  const hasFileMatches = Boolean(fileResult && fileResult.matches.length);
  const hitsDefaultOpen = Boolean(result && !result.answers.length && !hasFileMatches);
  const hitsOpen = hitsDefaultOpen !== (hitsFlipped === asked && asked !== "");
  const filesCard = hasFileMatches && fileResult ? <FilesCard files={fileResult} onOpen={files?.openFile} /> : null;
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
        <span>G.O.A.T.</span>
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
            <p className="mt-3 text-sm text-[var(--text-muted)]">
              Hi! I can look things up in {where}: visits, gaps, imaging, the plan, decompression,
              diagnoses, billing and notes{filesOn ? ", plus what's written in uploaded Patient Files" : ""}.
            </p>
          )}

          {result && (
            <div className="mt-3 max-h-[42rem] space-y-2 overflow-y-auto pr-1">
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

              {result.filesFirst && filesCard}

              {result.answers.map((a) => (
                <div key={a.title} className="rounded-xl border border-[var(--line-soft)] bg-white p-2.5">
                  <div className="text-sm font-semibold">{a.title}</div>
                  {a.lines.length > 0 && (
                    <ul className="mt-1 space-y-0.5 text-sm">
                      {a.lines.map((line, i) => (
                        <li key={i} className="whitespace-pre-line">
                          {line}
                        </li>
                      ))}
                    </ul>
                  )}
                  {a.groups && a.groups.length > 0 && (
                    <div className="mt-1">
                      <AnswerGroups groups={a.groups} highlight={result.highlight} />
                    </div>
                  )}
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

              {!result.filesFirst && filesCard}

              {result.hits.length > 0 && (
                <div className="rounded-xl border border-[var(--line-soft)] bg-white p-2.5">
                  <button
                    aria-expanded={hitsOpen}
                    className="flex w-full items-center justify-between gap-2 text-left text-sm font-semibold"
                    onClick={() => setHitsFlipped((v) => (v === asked ? "" : asked))}
                    type="button"
                  >
                    <span>
                      {result.answers.length || hasFileMatches ? "Also mentioned" : "Mentioned"} in {scope === "page" ? "this page" : "the patient file"} ({result.hits.length})
                    </span>
                    <span className="text-xs font-semibold text-[var(--brand-primary)]">{hitsOpen ? "Hide" : "Show"}</span>
                  </button>
                  {hitsOpen && (
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
                          <Highlight text={h.snippet} terms={[...result.terms, ...result.highlight]} />
                        </p>
                      </li>
                    ))}
                  </ul>
                  )}
                </div>
              )}

              {fileResult && fileResult.matches.length === 0 && fileResult.notes.length > 0 && (
                <FilesCard files={fileResult} onOpen={files?.openFile} />
              )}

              {nothing && (
                <p className="rounded-xl bg-[var(--bg-soft)] p-2.5 text-sm">
                  I couldn&apos;t find that in {where}. I only read what&apos;s there and I won&apos;t
                  guess. Try asking about visits, gaps, X-ray or MRI, the treatment plan,
                  diagnoses, billing, notes{filesOn ? " or what a report says" : ""}.
                </p>
              )}
            </div>
          )}

          {files && <FilesStatus files={files} />}

          <p className="mt-3 text-[11px] text-[var(--text-muted)]">
            {filesOn
              ? `G.O.A.T. reads only ${where} and its uploaded files. Files are read right here in your browser. Nothing leaves NoteGoat.`
              : `G.O.A.T. reads only ${where}. Nothing leaves NoteGoat.`}
          </p>
        </div>
      )}
    </article>
  );
}
