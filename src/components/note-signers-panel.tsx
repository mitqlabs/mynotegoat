"use client";

import { useState } from "react";
import { loadSigners, saveSigners, signatureFor, type NoteSigner } from "@/lib/goat-notes";
import { useWorkspacePeople } from "@/hooks/use-workspace-people";

/** Team list for note signatures (first name + Doctor flag, optional login link). Kept in this browser. */
export function NoteSignersPanel() {
  const [list, setList] = useState<NoteSigner[]>(() => loadSigners());
  const people = useWorkspacePeople();
  const [name, setName] = useState("");
  const [doctor, setDoctor] = useState(false);
  const update = (next: NoteSigner[]) => {
    setList(next);
    saveSigners(next);
  };
  return (
    <div className="space-y-2 text-sm">
      {list.length === 0 && <p className="text-[var(--text-muted)]">No one yet. Add each team member who adds notes.</p>}
      {list.map((s) => (
        <div key={s.id} className="flex flex-wrap items-center gap-2">
          <input aria-label="First name" className="w-36 rounded-lg border border-[var(--line-soft)] px-2 py-1" onChange={(e) => update(list.map((x) => (x.id === s.id ? { ...x, firstName: e.target.value } : x)))} value={s.firstName} />
          <label className="flex items-center gap-1">
            <input checked={s.doctor} onChange={(e) => update(list.map((x) => (x.id === s.id ? { ...x, doctor: e.target.checked } : x)))} type="checkbox" /> Doctor
          </label>
          <select aria-label="Login" className="rounded-lg border border-[var(--line-soft)] px-2 py-1 text-xs" onChange={(e) => update(list.map((x) => (x.id === s.id ? { ...x, userId: e.target.value || undefined } : x)))} value={s.userId ?? ""}>
            <option value="">Not linked to a login</option>
            {people.map((p) => (
              <option key={p.userId} value={p.userId}>
                {p.label}
                {p.email ? ` (${p.email})` : ""}
              </option>
            ))}
          </select>
          <span className="text-xs text-[var(--text-muted)]">Signs: {signatureFor(s) || "—"}</span>
          <button className="text-xs font-semibold text-red-700 hover:underline" onClick={() => update(list.filter((x) => x.id !== s.id))} type="button">
            Remove
          </button>
        </div>
      ))}
      <form
        className="flex flex-wrap items-center gap-2 pt-1"
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim()) return;
          update([...list, { id: `s-${Date.now().toString(36)}`, firstName: name.trim(), doctor }]);
          setName("");
          setDoctor(false);
        }}
      >
        <input aria-label="New team member first name" className="w-36 rounded-lg border border-[var(--line-soft)] px-2 py-1" onChange={(e) => setName(e.target.value)} placeholder="First name" value={name} />
        <label className="flex items-center gap-1">
          <input checked={doctor} onChange={(e) => setDoctor(e.target.checked)} type="checkbox" /> Doctor
        </label>
        <button className="rounded-lg bg-[var(--brand-primary)] px-3 py-1 text-xs font-semibold text-white" type="submit">
          Add
        </button>
      </form>
    </div>
  );
}
