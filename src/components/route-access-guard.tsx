"use client";

/**
 * Route access guard. A team member who lacks View access to a section must
 * not be able to reach it by typing the URL — the nav hides it, this blocks
 * direct navigation. Owners/office-admins are never blocked (canView is always
 * true for them), so this is a no-op for them.
 *
 * On landing on a page the current user can't view, we bounce them to the
 * first page in their sidebar they can open. The static nav list starts at
 * Patient List, so using that list here used to ignore a saved order.
 */

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { usePlanTier } from "@/lib/plan-context";
import { portalNavItems } from "@/lib/plan-access";
import { readSidebarOrderFromStorage, sidebarLandingHref } from "@/lib/sidebar-order";
import { useWorkspaceAccess } from "@/lib/workspace-access-context";

export function RouteAccessGuard() {
  const pathname = usePathname();
  const router = useRouter();
  const planTier = usePlanTier();
  const { canView } = useWorkspaceAccess();

  useEffect(() => {
    if (!pathname) return;
    const match = portalNavItems.find(
      (n) => pathname === n.href || pathname.startsWith(`${n.href}/`),
    );
    if (!match) return; // path not tied to a gated feature — leave it alone
    if (canView(match.feature)) return; // allowed
    const href = sidebarLandingHref(planTier, canView, readSidebarOrderFromStorage());
    if (!href || href === pathname) return;
    router.replace(href);
  }, [pathname, canView, planTier, router]);

  return null;
}
