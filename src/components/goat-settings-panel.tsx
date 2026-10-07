"use client";

import { useMemo, useState } from "react";
import { useGoatTerms } from "@/hooks/use-goat-terms";
import { groupsInQuestion, parseTermList, type GoatTermGroup } from "@/lib/goat-terms";

const inputClass = "w-full rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2 text-sm";
const buttonClass =
  "rounded-xl border border-[var(--line-soft)] bg-white px-3 py-1.5 text-sm font-semibold transition-all active:scale-[0.97]";
const primaryClass =
  "rounded-xl bg-[var(--brand-primary)] px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-40";

function TermChips({ terms }: { terms: string[] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {terms.map((t, i) => (
        <span
          key={t}
          className={`rounded-full border px-2 py-0.5 text-sm ${
            i === 0 ? "border-[#72bdcf] bg-[#eef8fb] font-semibold" : "border-[var(--line-soft)] bg-white"
          }`}
        >
          {t}
        </span>
      ))}
    </div>
  );
}

function GroupRow({
  group,
  onSave,
  onDelete,
}: {
  group: GoatTermGroup;
  onSave: (terms: string[]) => boolean;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  if (editing) {
    return (
      <li className="rounded-xl border border-[#72bdcf] bg-white p-3">
        <label className="text-xs font-semibold text-[var(--text-muted)]" htmlFor={`goat-edit-${group.id}`}>
          Words that mean the same thing (comma separated; the first one is the group&apos;s name)
        </label>
        <textarea
          autoFocus
          className={`${inputClass} mt-1 min-h-[70px]`}
          id={`goat-edit-${group.id}`}
          onChange={(e) => setDraft(e.target.value)}
          value={draft}
        />
        <div className="mt-2 flex gap-2">
          <button
            className={primaryClass}
            disabled={!parseTermList(draft).length}
            onClick={() => {
              if (onSave(parseTermList(draft))) setEditing(false);
            }}
            type="button"
          >
            Save
          </button>
          <button className={buttonClass} onClick={() => setEditing(false)} type="button">
            Cancel
          </button>
        </div>
      </li>
    );
  }
  return (
    <li className="flex items-start justify-between gap-3 rounded-xl border border-[var(--line-soft)] bg-white p-3">
      <TermChips terms={group.terms} />
      <div className="flex shrink-0 gap-2">
        <button
          className={buttonClass}
          onClick={() => {
            setDraft(group.terms.join(", "));
            setEditing(true);
          }}
          type="button"
        >
          Edit
        </button>
        <button
          className={`${buttonClass} text-red-700`}
          onClick={() => {
            if (window.confirm(`Delete the "${group.terms[0]}" group?`)) onDelete();
          }}
          type="button"
        >
          Delete
        </button>
      </div>
    </li>
  );
}

/**
 * Settings → G.O.A.T.: the office's words, abbreviations and synonym groups.
 * Saved per workspace and synced to every device like other office settings.
 */
export function GoatSettingsPanel() {
  const { groups, addGroup, updateGroup, deleteGroup, resetToDefaults } = useGoatTerms();
  const [newTerms, setNewTerms] = useState("");
  const [filter, setFilter] = useState("");
  const [tryQuestion, setTryQuestion] = useState("");

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return q ? groups.filter((g) => g.terms.some((t) => t.toLowerCase().includes(q))) : groups;
  }, [groups, filter]);
  const tried = useMemo(() => (tryQuestion.trim() ? groupsInQuestion(tryQuestion, groups) : []), [tryQuestion, groups]);

  return (
    <div className="space-y-4">
      <div className="rounded-xl bg-[var(--bg-soft)] p-3 text-sm">
        <p>
          When you ask G.O.A.T. a question, any word in a group also finds every other word in that group, on the
          patient page and inside uploaded Patient Files. Example: asking about <strong>ROM</strong> also finds
          &ldquo;flexion&rdquo;, &ldquo;extension&rdquo; and &ldquo;degrees&rdquo;.
        </p>
        <p className="mt-1.5 text-[var(--text-muted)]">
          Short abbreviations typed in capitals (ROM, PM, C/S) only match capitals inside files, so &ldquo;from&rdquo;
          never counts as ROM and &ldquo;3:00 PM&rdquo; never counts as pain management. Specialty words like{" "}
          <strong>Pain Management</strong> also find the doctor: G.O.A.T. looks for Contacts with that Specialist
          sub-category and this patient&apos;s specialist referrals.
        </p>
      </div>

      <div className="rounded-xl border border-[var(--line-soft)] bg-white p-3">
        <label className="text-sm font-semibold" htmlFor="goat-new-group">
          Add a group
        </label>
        <div className="mt-1 flex flex-wrap gap-2">
          <input
            className={`${inputClass} min-w-[240px] flex-1`}
            id="goat-new-group"
            onChange={(e) => setNewTerms(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && addGroup(parseTermList(newTerms))) setNewTerms("");
            }}
            placeholder="e.g. straight leg raise, SLR, Lasegue"
            value={newTerms}
          />
          <button
            className={primaryClass}
            disabled={!parseTermList(newTerms).length}
            onClick={() => {
              if (addGroup(parseTermList(newTerms))) setNewTerms("");
            }}
            type="button"
          >
            Add
          </button>
        </div>
        <p className="mt-1 text-xs text-[var(--text-muted)]">Separate words with commas. The first word is the group&apos;s name.</p>
      </div>

      <div className="rounded-xl border border-[var(--line-soft)] bg-white p-3">
        <label className="text-sm font-semibold" htmlFor="goat-try">
          Try a question
        </label>
        <input
          className={`${inputClass} mt-1`}
          id="goat-try"
          onChange={(e) => setTryQuestion(e.target.value)}
          placeholder="e.g. PM findings for range of motion?"
          value={tryQuestion}
        />
        {tryQuestion.trim() && (
          <div className="mt-2 space-y-1.5 text-sm">
            {tried.length ? (
              <>
                <p className="text-[var(--text-muted)]">G.O.A.T. will also look for:</p>
                {tried.map((g) => (
                  <TermChips key={g.id} terms={g.terms} />
                ))}
              </>
            ) : (
              <p className="text-[var(--text-muted)]">No group matches. G.O.A.T. will search for the words as typed.</p>
            )}
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <input
          aria-label="Find a word"
          className={`${inputClass} max-w-xs`}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Find a word…"
          type="search"
          value={filter}
        />
        <div className="flex items-center gap-3">
          <span className="text-sm text-[var(--text-muted)]">
            {groups.length} group{groups.length === 1 ? "" : "s"}
          </span>
          <button
            className={buttonClass}
            onClick={() => {
              if (window.confirm("Reset to the starting list? Your own groups will be removed and edited starting groups restored.")) {
                resetToDefaults();
              }
            }}
            type="button"
          >
            Reset to defaults
          </button>
        </div>
      </div>

      <ul className="space-y-2">
        {visible.map((g) => (
          <GroupRow
            key={g.id}
            group={g}
            onDelete={() => deleteGroup(g.id)}
            onSave={(terms) => updateGroup(g.id, terms)}
          />
        ))}
        {!visible.length && (
          <li className="rounded-xl border border-dashed border-[var(--line-soft)] p-4 text-center text-sm text-[var(--text-muted)]">
            {groups.length ? "No group has that word." : "No groups yet. Add one above, or reset to the starting list."}
          </li>
        )}
      </ul>
    </div>
  );
}
