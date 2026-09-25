"use client";

/**
 * Handbook — the in-app "How do I…?" for staff.
 *
 * It lives inside the app rather than as a shared document for one reason:
 * here it knows who is reading. Chapters are filtered by the signed-in
 * user's role and by the pages they can actually open, so nobody is shown
 * instructions for a door they can't open — and admin-only material is
 * never rendered for a manager or a staff member.
 */

import { useMemo, useState } from "react";
import { handbookChapters } from "@/lib/handbook-content";
import { isAdminTier } from "@/lib/admin-access";
import { useWorkspaceAccess } from "@/lib/workspace-access-context";

const ROLE_LABEL: Record<string, string> = {
  owner: "Owner",
  admin: "Admin",
  manager: "Manager",
  staff: "Staff",
};

export default function HandbookPage() {
  const { roleTier, canView } = useWorkspaceAccess();
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);

  const chapters = useMemo(() => {
    const admin = isAdminTier(roleTier);
    const manager = admin || roleTier === "manager";
    return handbookChapters.filter((chapter) => {
      if (chapter.audience === "admin" && !admin) return false;
      if (chapter.audience === "manager" && !manager) return false;
      if (chapter.feature && !canView(chapter.feature)) return false;
      return true;
    });
  }, [roleTier, canView]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return chapters;
    return chapters
      .map((chapter) => {
        const chapterHit =
          chapter.title.toLowerCase().includes(q) || chapter.summary.toLowerCase().includes(q);
        const tasks = chapter.tasks.filter((task) =>
          [task.heading, task.why ?? "", task.watchOut ?? "", ...(task.steps ?? [])]
            .join(" ")
            .toLowerCase()
            .includes(q),
        );
        if (chapterHit) return chapter;
        return tasks.length ? { ...chapter, tasks } : null;
      })
      .filter((chapter): chapter is (typeof chapters)[number] => chapter !== null);
  }, [chapters, query]);

  const searching = query.trim().length > 0;

  return (
    <div className="space-y-4">
      <section className="panel-card p-4 print:border-0 print:shadow-none">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-2xl font-semibold">Handbook</h2>
            <p className="mt-1 text-sm text-[var(--text-muted)]">
              How the office runs in My Note Goat. Everything here is written for what you can
              reach — you&apos;re signed in as{" "}
              <span className="font-semibold text-[var(--text-main)]">
                {ROLE_LABEL[roleTier] ?? roleTier}
              </span>
              .
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 print:hidden">
            <input
              className="w-64 rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2 text-sm"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search — e.g. no show, refund, macro…"
              value={query}
            />
            <button
              className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2 text-sm font-semibold"
              onClick={() => window.print()}
              type="button"
            >
              Print
            </button>
          </div>
        </div>

        {!searching && (
          <nav className="mt-3 flex flex-wrap gap-1.5 print:hidden">
            {visible.map((chapter) => (
              <button
                className="rounded-full border border-[var(--line-soft)] bg-[var(--bg-soft)] px-3 py-1 text-xs font-semibold"
                key={`toc-${chapter.id}`}
                onClick={() => {
                  setOpenId(chapter.id);
                  document.getElementById(`chapter-${chapter.id}`)?.scrollIntoView({
                    behavior: "smooth",
                    block: "start",
                  });
                }}
                type="button"
              >
                {chapter.title}
              </button>
            ))}
          </nav>
        )}
      </section>

      {visible.length === 0 && (
        <section className="panel-card p-6 text-sm text-[var(--text-muted)]">
          Nothing in the handbook matches “{query}”. Try a word you&apos;d see on screen — a button
          name, a status, a page.
        </section>
      )}

      {visible.map((chapter) => {
        const open = searching || openId === chapter.id;
        return (
          <section className="panel-card overflow-hidden" id={`chapter-${chapter.id}`} key={chapter.id}>
            <button
              className="flex w-full items-start justify-between gap-3 p-4 text-left"
              onClick={() => setOpenId(open && !searching ? null : chapter.id)}
              type="button"
            >
              <span>
                <span className="flex flex-wrap items-center gap-2">
                  <span className="text-lg font-semibold">{chapter.title}</span>
                  {chapter.audience !== "all" && (
                    <span className="rounded-full border border-[var(--line-soft)] bg-[var(--bg-soft)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[var(--text-muted)]">
                      {chapter.audience === "admin" ? "Admins" : "Managers & admins"}
                    </span>
                  )}
                </span>
                <span className="mt-0.5 block text-sm text-[var(--text-muted)]">
                  {chapter.summary}
                </span>
              </span>
              <span className="shrink-0 text-xl print:hidden">{open ? "−" : "+"}</span>
            </button>

            {open && (
              <div className="space-y-3 border-t border-[var(--line-soft)] p-4">
                {chapter.tasks.map((task) => (
                  <article
                    className="rounded-xl border border-[var(--line-soft)] bg-[var(--bg-soft)] p-3"
                    key={`${chapter.id}-${task.heading}`}
                  >
                    <h3 className="text-sm font-semibold">{task.heading}</h3>
                    {task.steps && task.steps.length > 0 && (
                      <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm">
                        {task.steps.map((step, index) => (
                          <li key={`${task.heading}-step-${index}`}>{step}</li>
                        ))}
                      </ol>
                    )}
                    {task.why && (
                      <p className="mt-2 rounded-lg bg-white px-3 py-2 text-sm text-[var(--text-muted)]">
                        <span className="font-semibold text-[var(--text-main)]">Why: </span>
                        {task.why}
                      </p>
                    )}
                    {task.watchOut && (
                      <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                        <span className="font-semibold">Watch out: </span>
                        {task.watchOut}
                      </p>
                    )}
                  </article>
                ))}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
