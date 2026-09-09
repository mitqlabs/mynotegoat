"use client";

/**
 * Read-only enforcement for "View" members, scoped to DETAIL pages.
 *
 * A member with View (not Edit) on a feature can browse its LIST page normally
 * (click into records, search, navigate) but its DETAIL page — e.g. an
 * individual patient at /patients/<id> — is made non-interactive so they can
 * read but not change anything. Locking only detail pages keeps list
 * navigation working (the trap that a blanket lock created).
 *
 * Owners, office-admins, and Edit members are never affected. Detecting a
 * detail page = the path is deeper than the feature's top-level nav href.
 */

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { portalNavItems } from "@/lib/plan-access";
import { useWorkspaceAccess } from "@/lib/workspace-access-context";

export function ReadOnlyContentGuard({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { canView, canEdit } = useWorkspaceAccess();
  const ref = useRef<HTMLDivElement>(null);

  const match = portalNavItems.find(
    (n) => pathname === n.href || (pathname?.startsWith(`${n.href}/`) ?? false),
  );
  const feature = match?.feature;
  const isDetailPage = Boolean(
    match && pathname && pathname !== match.href && pathname.startsWith(`${match.href}/`),
  );
  const readOnly =
    Boolean(feature) && isDetailPage && canView(feature!) && !canEdit(feature!);

  useEffect(() => {
    if (ref.current) ref.current.inert = readOnly;
  }, [readOnly, pathname]);

  return (
    <>
      {readOnly && (
        <div className="sticky top-0 z-30 -mx-4 mb-3 rounded-b-lg border-b border-amber-300 bg-amber-100 px-4 py-2 text-center text-sm font-semibold text-amber-900 lg:-mx-7">
          👁 View only — you can read this record but can’t make changes.
        </div>
      )}
      <div ref={ref}>{children}</div>
    </>
  );
}
