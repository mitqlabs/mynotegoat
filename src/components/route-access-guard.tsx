"use client";

/**
 * Route access guard. A team member who lacks View access to a section must
 * not be able to reach it by typing the URL — the nav hides it, this blocks
 * direct navigation. Owners/office-admins are never blocked (canView is always
 * true for them), so this is a no-op for them.
 *
 * On landing on a page the current user can't view, we bounce them to the
 * first section they CAN view (falling back to /patients).
 */

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { portalNavItems } from "@/lib/plan-access";
import { useWorkspaceAccess } from "@/lib/workspace-access-context";

export function RouteAccessGuard() {
  const pathname = usePathname();
  const router = useRouter();
  const { canView } = useWorkspaceAccess();

  useEffect(() => {
    if (!pathname) return;
    const match = portalNavItems.find(
      (n) => pathname === n.href || pathname.startsWith(`${n.href}/`),
    );
    if (!match) return; // path not tied to a gated feature — leave it alone
    if (canView(match.feature)) return; // allowed
    const firstAllowed = portalNavItems.find((n) => canView(n.feature));
    router.replace(firstAllowed ? firstAllowed.href : "/patients");
  }, [pathname, canView, router]);

  return null;
}
