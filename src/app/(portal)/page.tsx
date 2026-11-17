"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSidebarOrder } from "@/hooks/use-sidebar-order";
import { usePlanTier } from "@/lib/plan-context";
import { sidebarLandingHref } from "@/lib/sidebar-order";
import { useWorkspaceAccess } from "@/lib/workspace-access-context";

/**
 * Opening the app (the root, or the page after sign-in) lands on the first
 * page in this person's sidebar. The portal layout keeps the check-in
 * screen up until this replace runs, so the wrong page never flashes.
 */
export default function PortalHomePage() {
  const router = useRouter();
  const planTier = usePlanTier();
  const { canView } = useWorkspaceAccess();
  const saved = useSidebarOrder();

  useEffect(() => {
    const href = sidebarLandingHref(planTier, canView, saved);
    if (href && href !== "/") router.replace(href);
  }, [planTier, canView, saved, router]);

  return null;
}
