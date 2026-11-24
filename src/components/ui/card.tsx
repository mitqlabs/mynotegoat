import type { HTMLAttributes } from "react";

/** The ONE card/panel style for the site (`.panel-card`: 18px radius, soft border, light shadow). */
export function Card({ className = "", padded = true, ...rest }: HTMLAttributes<HTMLDivElement> & { padded?: boolean }) {
  return <div className={`panel-card ${padded ? "p-4 sm:p-5" : ""} ${className}`.trim()} {...rest} />;
}

export function CardHeader({ title, description, actions }: { title: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h3 className="text-lg font-semibold text-[var(--text-main)]">{title}</h3>
        {description && <p className="mt-0.5 text-sm text-[var(--text-muted)]">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
