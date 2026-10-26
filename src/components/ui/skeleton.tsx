/** Loading outlines shown while data loads. Purely visual (aria-hidden). */
export function Skeleton({ className = "" }: { className?: string }) {
  return <div aria-hidden className={`skeleton ${className}`} />;
}

export function SkeletonRows({ rows = 6, label = "Loading…" }: { rows?: number; label?: string }) {
  return (
    <div aria-busy="true" aria-label={label} className="grid gap-2" role="status">
      {Array.from({ length: rows }, (_, i) => (
        <div className="flex items-center gap-3 rounded-xl border border-[var(--line-soft)] bg-white p-3" key={i}>
          <Skeleton className="h-9 w-9 shrink-0 rounded-full" />
          <div className="grid flex-1 gap-1.5">
            <Skeleton className={`h-3.5 ${i % 3 === 0 ? "w-2/5" : i % 3 === 1 ? "w-1/3" : "w-1/2"}`} />
            <Skeleton className="h-3 w-1/4" />
          </div>
          <Skeleton className="hidden h-7 w-20 sm:block" />
        </div>
      ))}
    </div>
  );
}

export function SkeletonSchedule({ label = "Loading schedule…" }: { label?: string }) {
  return (
    <div aria-busy="true" aria-label={label} className="panel-card grid gap-2 p-4" role="status">
      <div className="mb-2 flex items-center justify-between">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-8 w-32" />
      </div>
      {Array.from({ length: 8 }, (_, i) => (
        <div className="flex items-center gap-3" key={i}>
          <Skeleton className="h-4 w-14 shrink-0" />
          <Skeleton className={`h-10 flex-1 ${i % 2 ? "opacity-60" : ""}`} />
        </div>
      ))}
    </div>
  );
}

export function SkeletonCaseFile({ label = "Loading patient file…" }: { label?: string }) {
  return (
    <div aria-busy="true" aria-label={label} className="grid gap-4" role="status">
      <div className="panel-card flex items-center gap-4 p-5">
        <Skeleton className="h-14 w-14 rounded-full" />
        <div className="grid flex-1 gap-2">
          <Skeleton className="h-6 w-1/3" />
          <Skeleton className="h-4 w-1/4" />
        </div>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {Array.from({ length: 4 }, (_, i) => (
          <div className="panel-card grid gap-2 p-5" key={i}>
            <Skeleton className="h-5 w-1/3" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function SkeletonNote({ label = "Loading notes…" }: { label?: string }) {
  return (
    <div aria-busy="true" aria-label={label} className="panel-card grid gap-3 p-5" role="status">
      <Skeleton className="h-6 w-1/4" />
      {["Subjective", "Objective", "Assessment", "Plan"].map((s) => (
        <div className="grid gap-1.5" key={s}>
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-16 w-full" />
        </div>
      ))}
    </div>
  );
}
