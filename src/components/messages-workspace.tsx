"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { patients } from "@/lib/mock-data";
import { buildCaseNumber } from "@/lib/follow-up-queue";
import { useWorkspaceMessages, type WorkspaceMessage } from "@/hooks/use-workspace-messages";
import { useWorkspacePeople, type WorkspacePerson } from "@/hooks/use-workspace-people";
import { useWorkspaceAccess } from "@/lib/workspace-access-context";
import { getCurrentMembershipSync } from "@/lib/workspace-membership";
import { useOfficeSettings } from "@/hooks/use-office-settings";
import { markMessagesSeen } from "@/lib/messages-read";

const GENERAL_KEY = "__general__";
const GENERAL_NAME = "General — whole team";

type Conversation = {
  key: string;
  patientId: string;
  name: string;
  messages: WorkspaceMessage[];
  lastAt: string;
};

function conversationKeyOf(m: WorkspaceMessage) {
  return m.patientId ? m.patientId : GENERAL_KEY;
}

function initialsOf(label: string) {
  // Prefer the alphabetic words (so a case-number label like
  // "072726GAMI Galstyan, Mike" yields "GM", not "0M").
  const words = label
    .replace(/,/g, " ")
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => /^[a-zA-Z]/.test(w));
  const parts = words.length ? words : label.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function dateGroupLabel(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const dayDiff = Math.round((startOf(now) - startOf(d)) / 86400000);
  if (dayDiff === 0) return "Today";
  if (dayDiff === 1) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
}

function timeLabel(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function relativeLabel(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const diff = Date.now() - d.getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function MessagesWorkspace() {
  const { canEdit, isOwner } = useWorkspaceAccess();
  const canPost = canEdit("messages");
  const { messages, loading, notReady, currentUserId, postMessage, deleteMessage } = useWorkspaceMessages();
  const { officeSettings } = useOfficeSettings();
  const ownerName = (officeSettings.doctorName ?? "").trim();
  const people = useWorkspacePeople(ownerName);

  // Case options, keyed by case number + name (e.g. "072726GAMI Galstyan,
  // Mike") so the tag makes it unambiguous which case a message is about.
  const caseOptions = useMemo(() => {
    return patients
      .filter((p) => !p.deleted)
      .map((p) => {
        const caseNumber = buildCaseNumber(p.dateOfLoss, p.fullName);
        const label = caseNumber ? `${caseNumber} ${p.fullName}` : p.fullName;
        return { id: p.id, name: p.fullName, caseNumber, label };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, []);

  // Composer state.
  const [body, setBody] = useState("");
  const [caseQuery, setCaseQuery] = useState("");
  const [notify, setNotify] = useState<Set<string>>(new Set());
  const [sending, setSending] = useState(false);
  const [composerOpen, setComposerOpen] = useState(true);

  // Inline @mention autocomplete.
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [mentionQuery, setMentionQuery] = useState<{ at: number; query: string } | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);

  // View state.
  const [filterKey, setFilterKey] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  // The account holder posts as ADMIN (by name when set); a team member
  // posts under their role label.
  const myLabel = isOwner ? ownerName || "Admin" : getCurrentMembershipSync()?.label || "Team Member";

  // Viewing the feed clears the unread badge. Re-mark on every change so a
  // message arriving while you're on this tab stays "seen".
  useEffect(() => {
    if (loading) return;
    const latest = messages.reduce((max, m) => (m.createdAt > max ? m.createdAt : max), "");
    markMessagesSeen(latest || undefined);
  }, [messages, loading]);

  const conversations = useMemo<Conversation[]>(() => {
    const map = new Map<string, Conversation>();
    for (const m of messages) {
      const key = conversationKeyOf(m);
      let conv = map.get(key);
      if (!conv) {
        conv = {
          key,
          patientId: m.patientId,
          name: key === GENERAL_KEY ? GENERAL_NAME : m.patientName || "Case",
          messages: [],
          lastAt: m.createdAt,
        };
        map.set(key, conv);
      }
      conv.messages.push(m);
      if (m.createdAt > conv.lastAt) conv.lastAt = m.createdAt;
    }
    return Array.from(map.values()).sort((a, b) => b.lastAt.localeCompare(a.lastAt));
  }, [messages]);

  const visibleConversations = useMemo(() => {
    const term = search.trim().toLowerCase();
    return conversations.filter((c) => {
      if (filterKey !== "all" && c.key !== filterKey) return false;
      if (!term) return true;
      if (c.name.toLowerCase().includes(term)) return true;
      return c.messages.some(
        (m) => m.body.toLowerCase().includes(term) || m.authorLabel.toLowerCase().includes(term),
      );
    });
  }, [conversations, filterKey, search]);

  const resolvedCase = useMemo(() => {
    const q = caseQuery.trim().toLowerCase();
    if (!q) return null;
    return caseOptions.find((c) => c.label.toLowerCase() === q) ?? null;
  }, [caseQuery, caseOptions]);

  // People matching the active @token, minus the current user and anyone
  // already mentioned.
  const mentionMatches = useMemo<WorkspacePerson[]>(() => {
    if (!mentionQuery) return [];
    const q = mentionQuery.query.toLowerCase();
    return people
      .filter((p) => p.userId !== currentUserId)
      .filter((p) => !q || p.label.toLowerCase().includes(q) || p.email.toLowerCase().includes(q))
      .slice(0, 6);
  }, [mentionQuery, people, currentUserId]);

  // Recompute the active @token from the text up to the caret.
  const syncMentionQuery = (value: string, caret: number) => {
    const upto = value.slice(0, caret);
    const match = upto.match(/(?:^|\s)@([\w.'-]*)$/);
    if (match) {
      setMentionQuery({ at: caret - match[1].length - 1, query: match[1] });
      setMentionIndex(0);
    } else {
      setMentionQuery(null);
    }
  };

  const handleBodyChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setBody(value);
    syncMentionQuery(value, e.target.selectionStart ?? value.length);
  };

  const pickMention = (person: WorkspacePerson) => {
    if (!mentionQuery) return;
    const ta = textareaRef.current;
    const caret = ta?.selectionStart ?? body.length;
    const before = body.slice(0, mentionQuery.at);
    const after = body.slice(caret);
    const insert = `@${person.label} `;
    const next = before + insert + after;
    setBody(next);
    setNotify((cur) => new Set(cur).add(person.userId));
    setMentionQuery(null);
    // Restore focus + caret just past the inserted mention.
    requestAnimationFrame(() => {
      if (!ta) return;
      const pos = before.length + insert.length;
      ta.focus();
      ta.setSelectionRange(pos, pos);
    });
  };

  const handleSend = async () => {
    const text = body.trim();
    if (!text || sending) return;
    setSending(true);
    const mentions = people.filter((p) => notify.has(p.userId)).map((p) => ({ userId: p.userId, label: p.label }));
    const ok = await postMessage({
      body: text,
      authorLabel: myLabel,
      patientId: resolvedCase?.id,
      patientName: resolvedCase?.label,
      mentions,
    });
    setSending(false);
    if (ok) {
      setBody("");
      setNotify(new Set());
      setMentionQuery(null);
      // Keep the tagged case so the user can post several notes to one case.
    }
  };

  const toggleCollapse = (key: string) =>
    setCollapsed((cur) => {
      const next = new Set(cur);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const toggleNotify = (userId: string) =>
    setNotify((cur) => {
      const next = new Set(cur);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });

  if (notReady) {
    return (
      <div className="space-y-5">
        <section className="panel-card p-4">
          <h3 className="text-xl font-semibold">Messages</h3>
          <p className="mt-2 text-sm text-[var(--text-muted)]">
            The Messages table hasn&apos;t been set up yet. Run{" "}
            <code className="rounded bg-[var(--bg-soft)] px-1.5 py-0.5">supabase/workspace_messages_table.sql</code> in
            your Supabase SQL editor, then refresh this page.
          </p>
        </section>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <section className="panel-card p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-xl font-semibold">Messages</h3>
            <p className="text-sm text-[var(--text-muted)]">
              A shared team feed. Tag a case, @mention a teammate, and keep the whole office on the same page.
            </p>
          </div>
          <div className="text-right text-sm">
            <p>
              <span className="font-semibold">{conversations.length}</span> active chat
              {conversations.length === 1 ? "" : "s"}
            </p>
            <p className="text-[var(--text-muted)]">
              {messages.length} message{messages.length === 1 ? "" : "s"}
            </p>
          </div>
        </div>
      </section>

      {canPost && (
        <section className="panel-card overflow-hidden">
          <button
            className="flex w-full items-center justify-between px-4 py-3 text-left"
            onClick={() => setComposerOpen((v) => !v)}
            type="button"
          >
            <span className="text-lg font-semibold">New message</span>
            <span className="text-[var(--text-muted)]">{composerOpen ? "▾" : "▸"}</span>
          </button>
          {composerOpen && (
            <div className="space-y-3 border-t border-[var(--line-soft)] p-4">
              <div className="relative">
                <textarea
                  className="w-full rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2 text-sm"
                  onBlur={() => {
                    // Let a click on a dropdown row register before closing.
                    window.setTimeout(() => setMentionQuery(null), 150);
                  }}
                  onChange={handleBodyChange}
                  onKeyDown={(e) => {
                    if (mentionQuery && mentionMatches.length > 0) {
                      if (e.key === "ArrowDown") {
                        e.preventDefault();
                        setMentionIndex((i) => (i + 1) % mentionMatches.length);
                        return;
                      }
                      if (e.key === "ArrowUp") {
                        e.preventDefault();
                        setMentionIndex((i) => (i - 1 + mentionMatches.length) % mentionMatches.length);
                        return;
                      }
                      if (e.key === "Enter" || e.key === "Tab") {
                        e.preventDefault();
                        pickMention(mentionMatches[mentionIndex] ?? mentionMatches[0]);
                        return;
                      }
                      if (e.key === "Escape") {
                        setMentionQuery(null);
                        return;
                      }
                    }
                    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                      e.preventDefault();
                      void handleSend();
                    }
                  }}
                  onKeyUp={(e) => {
                    const t = e.target as HTMLTextAreaElement;
                    syncMentionQuery(t.value, t.selectionStart ?? t.value.length);
                  }}
                  placeholder="Write a message… type @ to mention a teammate"
                  ref={textareaRef}
                  rows={3}
                  value={body}
                />

                {mentionQuery && mentionMatches.length > 0 && (
                  <div className="absolute top-full left-0 z-20 mt-1 w-64 overflow-hidden rounded-xl border border-[var(--line-soft)] bg-white shadow-lg">
                    {mentionMatches.map((p, i) => (
                      <button
                        className={`flex w-full items-center gap-3 px-3 py-2 text-left transition-colors ${
                          i === mentionIndex ? "bg-[var(--bg-soft)]" : "bg-white"
                        }`}
                        key={p.userId}
                        // onMouseDown (not onClick) so it fires before textarea blur.
                        onMouseDown={(e) => {
                          e.preventDefault();
                          pickMention(p);
                        }}
                        onMouseEnter={() => setMentionIndex(i)}
                        type="button"
                      >
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--bg-soft)] text-xs font-bold text-[var(--text-muted)]">
                          {initialsOf(p.label)}
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-semibold">{p.label}</span>
                          {p.email && (
                            <span className="block truncate text-xs text-[var(--text-muted)]">{p.email}</span>
                          )}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <label className="grid gap-1">
                  <span className="text-xs font-semibold text-[var(--text-muted)]">Tag a case (optional)</span>
                  <input
                    className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2 text-sm"
                    list="messages-case-list"
                    onChange={(e) => setCaseQuery(e.target.value)}
                    placeholder="Case # or name — e.g. 072726GAMI"
                    value={caseQuery}
                  />
                  <datalist id="messages-case-list">
                    {caseOptions.map((c) => (
                      <option key={c.id} value={c.label} />
                    ))}
                  </datalist>
                  {caseQuery.trim() && !resolvedCase && (
                    <span className="text-xs text-[var(--text-muted)]">
                      Pick a case from the list — otherwise it posts to the General feed.
                    </span>
                  )}
                  {resolvedCase && (
                    <span className="text-xs font-semibold text-[var(--brand-primary)]">
                      Tagged: {resolvedCase.label}
                    </span>
                  )}
                </label>

                {notify.size > 0 && (
                  <div className="grid gap-1">
                    <span className="text-xs font-semibold text-[var(--text-muted)]">Mentioning</span>
                    <div className="flex flex-wrap gap-1.5">
                      {people
                        .filter((p) => notify.has(p.userId))
                        .map((p) => (
                          <button
                            className="inline-flex items-center gap-1 rounded-full border border-[var(--brand-primary)] bg-[var(--brand-primary)] px-2.5 py-1 text-xs font-semibold text-white"
                            key={p.userId}
                            onClick={() => toggleNotify(p.userId)}
                            title="Remove mention"
                            type="button"
                          >
                            @{p.label} <span aria-hidden>✕</span>
                          </button>
                        ))}
                    </div>
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between gap-3">
                <span className="text-xs text-[var(--text-muted)]">Posting as {myLabel}</span>
                <button
                  className="rounded-xl bg-[var(--brand-primary)] px-5 py-2 text-sm font-semibold text-white transition-all active:scale-[0.97] active:brightness-90 disabled:opacity-50"
                  disabled={!body.trim() || sending}
                  onClick={() => void handleSend()}
                  type="button"
                >
                  {sending ? "Sending…" : "Send"}
                </button>
              </div>
            </div>
          )}
        </section>
      )}

      <section className="panel-card p-3">
        <div className="flex flex-wrap items-center gap-2">
          <input
            className="min-w-[180px] flex-1 rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2 text-sm"
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search messages…"
            value={search}
          />
          <select
            className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2 text-sm"
            onChange={(e) => setFilterKey(e.target.value)}
            value={filterKey}
          >
            <option value="all">All conversations</option>
            {conversations.map((c) => (
              <option key={c.key} value={c.key}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
      </section>

      {loading ? (
        <section className="panel-card p-6 text-center text-sm text-[var(--text-muted)]">Loading messages…</section>
      ) : visibleConversations.length === 0 ? (
        <section className="panel-card p-8 text-center">
          <p className="text-sm font-semibold">No conversations yet</p>
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            {conversations.length === 0
              ? "Post the first message above to start the team feed."
              : "No conversations match your filter."}
          </p>
        </section>
      ) : (
        <div className="space-y-3">
          {visibleConversations.map((conv) => {
            const isCollapsed = collapsed.has(conv.key);
            const last = conv.messages[conv.messages.length - 1];
            return (
              <section className="panel-card overflow-hidden" key={conv.key}>
                <button
                  className="flex w-full items-center gap-3 px-4 py-3 text-left"
                  onClick={() => toggleCollapse(conv.key)}
                  type="button"
                >
                  <span
                    className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white ${
                      conv.key === GENERAL_KEY ? "bg-[var(--text-muted)]" : "bg-[var(--brand-primary)]"
                    }`}
                  >
                    {conv.key === GENERAL_KEY ? "★" : initialsOf(conv.name)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate font-semibold">{conv.name}</span>
                      <span className="shrink-0 rounded-full bg-[var(--bg-soft)] px-2 py-0.5 text-xs font-semibold text-[var(--text-muted)]">
                        {conv.messages.length}
                      </span>
                    </span>
                    <span className="mt-0.5 flex items-center gap-1 text-xs text-[var(--text-muted)]">
                      <span className="truncate">
                        {last.authorLabel}: {last.body}
                      </span>
                    </span>
                  </span>
                  <span className="shrink-0 text-xs text-[var(--text-muted)]">{relativeLabel(conv.lastAt)}</span>
                  <span className="shrink-0 text-[var(--text-muted)]">{isCollapsed ? "▸" : "▾"}</span>
                </button>

                {!isCollapsed && (
                  <div className="border-t border-[var(--line-soft)]">
                    {conv.patientId && (
                      <div className="flex items-center justify-between gap-2 bg-[var(--bg-soft)] px-4 py-2">
                        <span className="text-xs font-semibold text-[var(--text-muted)]">Tagged case</span>
                        <Link
                          className="text-xs font-semibold text-[var(--brand-primary)] hover:underline"
                          href={`/patients/${conv.patientId}`}
                        >
                          Open patient file →
                        </Link>
                      </div>
                    )}
                    <div className="space-y-4 p-4">
                      {(() => {
                        const rows: React.ReactNode[] = [];
                        let lastDate = "";
                        for (const m of conv.messages) {
                          const dLabel = dateGroupLabel(m.createdAt);
                          if (dLabel !== lastDate) {
                            lastDate = dLabel;
                            rows.push(
                              <div className="flex items-center gap-3" key={`d-${m.id}`}>
                                <span className="h-px flex-1 bg-[var(--line-soft)]" />
                                <span className="text-xs font-semibold text-[var(--text-muted)]">{dLabel}</span>
                                <span className="h-px flex-1 bg-[var(--line-soft)]" />
                              </div>,
                            );
                          }
                          const mine = m.authorUserId === currentUserId;
                          const canDelete = mine || isOwner;
                          rows.push(
                            <div className="flex gap-3" key={m.id}>
                              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--bg-soft)] text-xs font-bold text-[var(--text-muted)]">
                                {initialsOf(m.authorLabel)}
                              </span>
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                  <span className="text-sm font-semibold">{m.authorLabel}</span>
                                  <span className="text-xs text-[var(--text-muted)]">{timeLabel(m.createdAt)}</span>
                                  {canDelete && (
                                    <span className="ml-auto">
                                      {pendingDelete === m.id ? (
                                        <span className="inline-flex gap-1">
                                          <button
                                            className="rounded-md bg-[#b43b34] px-2 py-0.5 text-xs font-semibold text-white"
                                            onClick={() => {
                                              void deleteMessage(m.id);
                                              setPendingDelete(null);
                                            }}
                                            type="button"
                                          >
                                            Delete
                                          </button>
                                          <button
                                            className="rounded-md border border-[var(--line-soft)] px-2 py-0.5 text-xs font-semibold"
                                            onClick={() => setPendingDelete(null)}
                                            type="button"
                                          >
                                            Cancel
                                          </button>
                                        </span>
                                      ) : (
                                        <button
                                          className="text-xs font-semibold text-[var(--text-muted)] hover:text-[#b43b34]"
                                          onClick={() => setPendingDelete(m.id)}
                                          type="button"
                                        >
                                          ✕
                                        </button>
                                      )}
                                    </span>
                                  )}
                                </div>
                                <p className="mt-0.5 whitespace-pre-wrap break-words text-sm">{m.body}</p>
                                {m.mentions.length > 0 && (
                                  <div className="mt-1.5 flex flex-wrap gap-1">
                                    {m.mentions.map((mn) => (
                                      <span
                                        className="rounded-full bg-[rgba(13,121,191,0.12)] px-2 py-0.5 text-xs font-semibold text-[#0d79bf]"
                                        key={mn.userId}
                                      >
                                        @{mn.label}
                                      </span>
                                    ))}
                                  </div>
                                )}
                              </div>
                            </div>,
                          );
                        }
                        return rows;
                      })()}
                    </div>
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
