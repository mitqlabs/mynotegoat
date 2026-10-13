"use client";

/** G.O.A.T. status line (rule-based G.O.A.T. only; + mode was removed). */

export type GoatStatus = "ready" | "searching" | "reading" | "found" | "notFound";

/** "Ready" / "Searching…" / "Found it" / "Couldn't find that". Static: no animation. */
export function statusLabel(s: GoatStatus): string {
  switch (s) {
    case "searching":
      return "Searching…";
    case "reading":
      return "Reading files…";
    case "found":
      return "Found it";
    case "notFound":
      return "Couldn't find that";
    default:
      return "Ready";
  }
}

const DOT: Record<GoatStatus, string> = {
  ready: "bg-emerald-500",
  searching: "bg-amber-400",
  reading: "bg-amber-400",
  found: "bg-emerald-500",
  notFound: "bg-slate-400",
};

export function GoatStatusLine({ status, className = "" }: { status: GoatStatus; className?: string }) {
  return (
    <span aria-live="polite" className={`inline-flex items-center gap-1.5 text-xs font-semibold ${className}`} data-goat-status={status} role="status">
      <span aria-hidden="true" className={`inline-block h-2 w-2 rounded-full ${DOT[status]}`} />
      {statusLabel(status)}
    </span>
  );
}
