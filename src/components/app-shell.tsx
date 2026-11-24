"use client";

import Link from "next/link";
import { GlobalGoatButton, GoatChatFab } from "@/components/global-goat-button";
import { LazyGlobalGoatPopup } from "@/components/lazy-global-goat-popup";
import { isGoatAppPath } from "@/lib/goat-app";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState, useCallback } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import { wipeLocalWorkspaceForSignOut } from "@/lib/cloud-state";
import { getVisiblePortalNavItems, type PlanTier } from "@/lib/plan-access";
import { useWorkspaceAccess } from "@/lib/workspace-access-context";
import { ReadOnlyContentGuard } from "@/components/read-only-content-guard";
import { useUnreadMessages } from "@/hooks/use-unread-messages";
import { useSidebarOrder } from "@/hooks/use-sidebar-order";
import { applySidebarOrder, visibleSidebarPages, type SidebarPage } from "@/lib/sidebar-order";
import { SidebarIconView } from "@/components/sidebar-icons";
import { ReminderMorningBanner } from "@/components/reminder-morning-banner";
import { UnmatchedStopAlert } from "@/components/unmatched-stop-alert";
import { DemoOfficeMarker, ResetDemoButton } from "@/components/demo-office-chrome";

function classNames(...classes: Array<string | false | undefined>) {
  return classes.filter(Boolean).join(" ");
}

/** Red pill badge for unread counts. Caps at 99+. */
function NavBadge({ count, className }: { count: number; className?: string }) {
  if (count <= 0) return null;
  return (
    <span
      className={classNames(
        "inline-flex min-w-[18px] items-center justify-center rounded-full bg-red-500 px-1.5 text-[10px] font-bold leading-[18px] text-white",
        className,
      )}
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}

function buildTitle(pathname: string, items: { href: string; label: string }[]) {
  if (pathname === "/goat-mail" || pathname.startsWith("/goat-mail/")) return "G.O.A.T. Mail";
  const item = items.find((entry) => pathname.startsWith(entry.href));
  return item?.label ?? "My Note Goat";
}

function pageActive(pathname: string, page: SidebarPage): boolean {
  if (page.active === "exact") return pathname === page.href;
  return pathname === page.href || pathname.startsWith(`${page.href}/`);
}

function SidebarNavItem({
  page,
  pathname,
  variant,
  unread,
}: {
  page: SidebarPage;
  pathname: string;
  variant: "expanded" | "collapsed" | "mobile";
  unread: number;
}) {
  const active = pageActive(pathname, page);
  if (page.kind === "goatPage") {
    if (variant === "expanded") {
      return (
        <GlobalGoatButton
          textOnly
          className={classNames(
            "flex items-center justify-between gap-2 rounded-xl px-4 py-3 text-sm font-semibold transition",
            active ? "nav-link-active" : "nav-link",
          )}
        />
      );
    }
    if (variant === "collapsed") {
      return (
        <GlobalGoatButton
          compact
          className={classNames(
            "flex h-10 w-10 items-center justify-center rounded-xl transition",
            active ? "nav-link-active" : "nav-link",
          )}
        />
      );
    }
    return (
      <GlobalGoatButton className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full bg-[var(--bg-soft)] py-1 pl-1 pr-3 text-sm font-semibold text-[var(--text-main)]" />
    );
  }

  if (variant === "expanded") {
    return (
      <Link
        href={page.href}
        className={classNames(
          "flex items-center justify-between gap-2 rounded-xl px-4 py-3 text-sm font-semibold transition",
          active ? "nav-link-active" : "nav-link",
        )}
      >
        <span>{page.label}</span>
        {page.feature === "messages" && <NavBadge count={unread} />}
      </Link>
    );
  }

  if (variant === "collapsed") {
    return (
      <Link
        href={page.href}
        className={classNames(
          page.feature
            ? "relative flex h-10 w-10 items-center justify-center rounded-xl transition"
            : "flex h-10 w-10 items-center justify-center rounded-xl transition",
          active ? "nav-link-active" : "nav-link",
        )}
        title={page.label}
      >
        <SidebarIconView page={page} className="h-5 w-5" />
        {page.feature === "messages" && unread > 0 && (
          <NavBadge count={unread} className="absolute -right-1 -top-1" />
        )}
      </Link>
    );
  }

  return (
    <Link
      href={page.href}
      className={classNames(
        page.id === "goatMail"
          ? "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-4 py-2 text-sm font-semibold"
          : "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-4 py-2 text-sm font-semibold",
        active
          ? "bg-[var(--brand-primary)] text-[var(--on-brand)]"
          : "bg-[var(--bg-soft)] text-[var(--text-main)]",
      )}
    >
      {page.label}
      {page.feature === "messages" && <NavBadge count={unread} />}
    </Link>
  );
}

const SIDEBAR_COLLAPSED_KEY = "casemate.sidebar-collapsed";

export function AppShell({
  children,
  planTier = "complete",
}: {
  children: React.ReactNode;
  planTier?: PlanTier;
}) {
  const pathname = usePathname();
  const [userEmail, setUserEmail] = useState("");
  const [signingOut, setSigningOut] = useState(false);
  const [showBrandLogo, setShowBrandLogo] = useState(true);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "true";
  });
  // canView() = the office module cap AND (for a member) their granted access.
  // Owners/office-admins see everything the office has enabled; a member only
  // sees sections they were granted, and never Settings.
  const { canView } = useWorkspaceAccess();
  const savedSidebarOrder = useSidebarOrder();
  const navItems = useMemo(
    () => getVisiblePortalNavItems(planTier).filter((item) => canView(item.feature)),
    [planTier, canView],
  );
  const orderedPages = useMemo(
    () => applySidebarOrder(visibleSidebarPages(planTier, canView), savedSidebarOrder),
    [planTier, canView, savedSidebarOrder],
  );
  const mainNav = orderedPages.filter((item) => item.id !== "settings");
  const mobileNav = mainNav.filter((item) => item.id !== "handbook");
  const settingsItem = orderedPages.find((item) => item.id === "settings");
  const unreadMessages = useUnreadMessages();

  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(next));
      return next;
    });
  }, []);

  useEffect(() => {
    let active = true;
    const supabase = getSupabaseBrowserClient();

    if (!supabase) {
      return;
    }

    supabase.auth.getSession().then(({ data }) => {
      if (!active) {
        return;
      }
      setUserEmail(data.session?.user?.email ?? "");
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active) {
        return;
      }
      setUserEmail(session?.user?.email ?? "");
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  const handleSignOut = async () => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) {
      window.location.href = "/auth/login";
      return;
    }

    setSigningOut(true);
    await supabase.auth.signOut();
    // Wipe every casemate.* key so the next user to use this browser
    // starts with a truly empty slate. Defense-in-depth: the portal
    // bootstrap also re-checks on mount.
    wipeLocalWorkspaceForSignOut();
    window.location.href = "/auth/login";
  };

  // The G.O.A.T. home-screen app (/goat): only the chat, full screen — no sidebar or top nav.
  if (isGoatAppPath(pathname)) {
    return (
      <div className="min-h-[100dvh] bg-[var(--shell-bg)]">
        <ReadOnlyContentGuard>{children}</ReadOnlyContentGuard>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--shell-bg)]">
      <div className="mx-auto px-0">
        <div className="min-h-screen border-[var(--shell-border)] bg-[var(--shell-bg)]">
          <div
            className={classNames(
              "grid min-h-screen",
              sidebarCollapsed
                ? "lg:grid-cols-[56px_1fr]"
                : "lg:grid-cols-[250px_1fr]",
            )}
            style={{ transition: "grid-template-columns 0.2s ease" }}
          >
            <aside className="sticky top-0 hidden max-h-screen overflow-y-auto overflow-x-hidden border-r border-[var(--line-soft)] bg-[var(--bg-sidebar)] text-[var(--sidebar-text)] lg:block">
              <div className={sidebarCollapsed ? "p-2" : "p-6"}>
                {!sidebarCollapsed && (
                  <>
                    <div className="mb-8">
                      <div className="rounded-2xl border border-white/15 bg-white/5 px-3 py-3">
                        {showBrandLogo ? (
                          <img
                            src="/mynotegoatlogo.png"
                            alt="My Note Goat"
                            className="h-20 w-full object-contain"
                            onError={() => setShowBrandLogo(false)}
                          />
                        ) : (
                          <div className="text-center text-xl font-semibold tracking-wide text-white">
                            My Note Goat
                          </div>
                        )}
                      </div>
                      <p className="mt-2 text-sm text-[var(--sidebar-muted)]">Secure office workspace</p>
                      <DemoOfficeMarker compact />
                    </div>

                    <nav className="space-y-2">
                      {mainNav.map((page) => (
                        <SidebarNavItem key={page.id} page={page} pathname={pathname} unread={unreadMessages} variant="expanded" />
                      ))}
                      {settingsItem && (
                        <SidebarNavItem page={settingsItem} pathname={pathname} unread={unreadMessages} variant="expanded" />
                      )}
                    </nav>

                    <div className="mt-8 rounded-xl border border-white/20 bg-white/10 p-3">
                      <button
                        type="button"
                        onClick={handleSignOut}
                        disabled={signingOut}
                        className="flex w-full items-center justify-center gap-2 rounded-lg bg-white/15 px-3 py-2 text-xs font-semibold text-white transition hover:bg-white/25 disabled:opacity-50"
                        title="Sign Out"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="h-4 w-4">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0 0 13.5 3h-6a2.25 2.25 0 0 0-2.25 2.25v13.5A2.25 2.25 0 0 0 7.5 21h6a2.25 2.25 0 0 0 2.25-2.25V15m3 0 3-3m0 0-3-3m3 3H9" />
                        </svg>
                        {signingOut ? "Signing out..." : "Sign Out"}
                      </button>
                    </div>

                    {/* Collapse toggle */}
                    <button
                      type="button"
                      onClick={toggleSidebar}
                      className="mt-4 flex w-full items-center justify-center rounded-lg bg-white/10 p-2 text-white/70 transition hover:bg-white/20 hover:text-white"
                      title="Collapse sidebar"
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 20 20"
                        fill="currentColor"
                        className="h-5 w-5"
                      >
                        <path fillRule="evenodd" d="M12.79 5.23a.75.75 0 01-.02 1.06L8.832 10l3.938 3.71a.75.75 0 11-1.04 1.08l-4.5-4.25a.75.75 0 010-1.08l4.5-4.25a.75.75 0 011.06.02z" clipRule="evenodd" />
                      </svg>
                    </button>
                  </>
                )}

                {sidebarCollapsed && (
                  <>
                    <nav className="space-y-2">
                      {mainNav.map((page) => (
                        <SidebarNavItem key={page.id} page={page} pathname={pathname} unread={unreadMessages} variant="collapsed" />
                      ))}
                      {settingsItem && (
                        <SidebarNavItem page={settingsItem} pathname={pathname} unread={unreadMessages} variant="collapsed" />
                      )}
                    </nav>

                    {/* Sign out icon */}
                    <div className="mt-4 rounded-xl border border-white/20 bg-white/10 p-1">
                      <button
                        type="button"
                        onClick={handleSignOut}
                        disabled={signingOut}
                        className="flex h-10 w-10 items-center justify-center rounded-lg text-white/70 transition hover:bg-white/15 hover:text-white disabled:opacity-50"
                        title="Sign Out"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="h-5 w-5">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0 0 13.5 3h-6a2.25 2.25 0 0 0-2.25 2.25v13.5A2.25 2.25 0 0 0 7.5 21h6a2.25 2.25 0 0 0 2.25-2.25V15m3 0 3-3m0 0-3-3m3 3H9" />
                        </svg>
                      </button>
                    </div>

                    {/* Expand chevron */}
                    <button
                      type="button"
                      onClick={toggleSidebar}
                      className="mt-3 flex w-full items-center justify-center rounded-lg bg-white/10 p-2 text-white/70 transition hover:bg-white/20 hover:text-white"
                      title="Expand sidebar"
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 20 20"
                        fill="currentColor"
                        className="h-5 w-5 rotate-180"
                      >
                        <path fillRule="evenodd" d="M12.79 5.23a.75.75 0 01-.02 1.06L8.832 10l3.938 3.71a.75.75 0 11-1.04 1.08l-4.5-4.25a.75.75 0 010-1.08l4.5-4.25a.75.75 0 011.06.02z" clipRule="evenodd" />
                      </svg>
                    </button>
                  </>
                )}
              </div>
            </aside>

            <section className="min-w-0">
              <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--line-soft)] bg-[var(--header-bg)] px-4 py-4 lg:px-7 lg:py-5">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--text-muted)]">
                    My Note Goat
                  </div>
                  <h1 className="text-2xl font-semibold text-[var(--text-main)]">
                    {buildTitle(pathname, navItems)}
                  </h1>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <DemoOfficeMarker />
                  <ResetDemoButton />
                  <div className="inline-flex items-center rounded-full bg-[var(--bg-soft)] px-4 py-2 text-sm font-semibold text-[var(--text-main)]">
                    {userEmail || "Secure cloud mode"}
                  </div>
                </div>
              </header>

              <nav className="flex gap-2 overflow-x-auto border-b border-[var(--line-soft)] bg-[var(--header-bg)] px-3 py-3 lg:hidden">
                {mobileNav.map((page) => (
                  <SidebarNavItem key={page.id} page={page} pathname={pathname} unread={unreadMessages} variant="mobile" />
                ))}
                {settingsItem && (
                  <SidebarNavItem page={settingsItem} pathname={pathname} unread={unreadMessages} variant="mobile" />
                )}
                {/* Mobile-only sign out, icon at the end of the pill row. The
                    desktop sidebar (which holds Sign Out) is hidden below lg.
                    Same handler as the sidebar button. */}
                <button
                  type="button"
                  onClick={handleSignOut}
                  disabled={signingOut}
                  aria-label="Sign out"
                  title="Sign out"
                  className="inline-flex shrink-0 items-center justify-center rounded-full bg-[var(--bg-soft)] px-3 py-2 text-[var(--text-main)] transition hover:bg-[var(--line-soft)] disabled:opacity-50"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="h-5 w-5" aria-hidden>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0 0 13.5 3h-6a2.25 2.25 0 0 0-2.25 2.25v13.5A2.25 2.25 0 0 0 7.5 21h6a2.25 2.25 0 0 0 2.25-2.25V15m3 0 3-3m0 0-3-3m3 3H9" />
                  </svg>
                </button>
              </nav>

              <ReminderMorningBanner />
              <UnmatchedStopAlert />
              <main className="p-4 lg:p-7">
                <ReadOnlyContentGuard>{children}</ReadOnlyContentGuard>
              </main>
              <LazyGlobalGoatPopup />
              <GoatChatFab />
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
