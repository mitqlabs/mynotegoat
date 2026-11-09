"use client";

import { useState } from "react";
import { quickFillFromText, textFromQuickFillFile, type QuickFillResult } from "@/lib/quick-fill";

export function QuickFillBox({
  todayIso,
  attorneys,
  onFill,
}: {
  todayIso: string;
  attorneys: string[];
  onFill: (result: QuickFillResult) => void;
}) {
  const [note, setNote] = useState("Paste an email or drop a file.");
  const [busy, setBusy] = useState(false);

  const applyText = (text: string) => {
    const result = quickFillFromText(text, { todayIso, attorneys });
    onFill(result);
    const filled = ["firstName", "lastName", "phone", "dob", "dateOfLoss", "attorney", "addressStreet", "evalDate"].filter(
      (key) => Boolean(result[key as keyof QuickFillResult]),
    );
    setNote(filled.length ? `Filled ${filled.length} field${filled.length === 1 ? "" : "s"}. Check them before you save.` : "Nothing recognizable in that text. You can still type the fields.");
  };

  return (
    <label
      className="block rounded-xl border border-dashed border-[var(--brand-primary)] bg-[rgba(13,121,191,0.05)] p-3"
      data-quick-fill
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        const file = event.dataTransfer.files?.[0];
        if (!file) return;
        setBusy(true);
        void textFromQuickFillFile(file)
          .then((text) => applyText(text))
          .catch(() => setNote("Couldn't read that file. Paste the text instead."))
          .finally(() => setBusy(false));
      }}
    >
      <span className="text-sm font-semibold">Quick Fill</span>
      <span className="mt-0.5 block text-xs text-[var(--text-muted)]">
        Paste an email or text, or drop a .eml, .msg, or LOP / intake PDF.
      </span>
      <textarea
        className="mt-2 w-full rounded-lg border border-[var(--line-soft)] bg-white px-3 py-2 text-sm"
        disabled={busy}
        onPaste={(event) => {
          const text = event.clipboardData.getData("text");
          if (!text.trim()) return;
          event.preventDefault();
          applyText(text);
        }}
        placeholder="Paste here…"
        rows={3}
      />
      <p className="mt-1 text-xs text-[var(--text-muted)]">{busy ? "Reading the file…" : note}</p>
    </label>
  );
}
