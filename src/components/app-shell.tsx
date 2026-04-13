"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState, useCallback } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import { wipeLocalWorkspaceForSignOut } from "@/lib/cloud-state";
import { getVisiblePortalNavItems, type PlanTier } from "@/lib/plan-access";

function classNames(...classes: Array<string | false | undefined>) {
  return classes.filter(Boolean).join(" ");
}

const navIcons: Record<string, React.ReactNode> = {
  "/patients": (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="h-5 w-5">
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z" />
    </svg>
  ),
  "/statistics": (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="h-5 w-5">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z" />
    </svg>
  ),
  "/contacts": (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="h-5 w-5">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 0 0 6 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 0 1 6 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 0 1 6-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0 0 18 18a8.967 8.967 0 0 0-6 2.292m0-14.25v14.25" />
    </svg>
  ),
  "/appointments": (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="h-5 w-5">
      <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5" />
    </svg>
  ),
  "/encounters": (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="h-5 w-5">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 0 0 2.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 0 0-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 0 0 .75-.75 2.25 2.25 0 0 0-.1-.664m-5.8 0A2.251 2.251 0 0 1 13.5 2.25H15a2.25 2.25 0 0 1 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25ZM6.75 12h.008v.008H6.75V12Zm0 3h.008v.008H6.75V15Zm0 3h.008v.008H6.75V18Z" />
    </svg>
  ),
  "/key-dates": (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="h-5 w-5">
      <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0M3.124 7.5A8.969 8.969 0 0 1 5.292 3m13.416 0a8.969 8.969 0 0 1 2.168 4.5" />
    </svg>
  ),
  "/my-files": (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="h-5 w-5">
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 0 1 4.5 9.75h15A2.25 2.25 0 0 1 21.75 12v.75m-8.69-6.44-2.12-2.12a1.5 1.5 0 0 0-1.061-.44H4.5A2.25 2.25 0 0 0 2.25 6v12a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9a2.25 2.25 0 0 0-2.25-2.25h-5.379a1.5 1.5 0 0 1-1.06-.44Z" />
    </svg>
  ),
  "/billing": (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="h-5 w-5">
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18.75a60.07 60.07 0 0 1 15.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 0 1 3 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 0 0-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 0 1-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 0 0 3 15h-.75M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm3 0h.008v.008H18V10.5Zm-12 0h.008v.008H6V10.5Z" />
    </svg>
  ),
  "/timers": (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="h-5 w-5">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
    </svg>
  ),
  "/settings": (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="h-5 w-5">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
    </svg>
  ),
};

function buildTitle(pathname: string, items: { href: string; label: string }[]) {
  const item = items.find((entry) => pathname.startsWith(entry.href));
  return item?.label ?? "My Note Goat";
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
  const navItems = useMemo(() => getVisiblePortalNavItems(planTier), [planTier]);

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

  return (
    <div className="min-h-screen bg-white">
      <div className="mx-auto px-0">
        <div className="min-h-screen border-white/70 bg-white">
          <div
            className={classNames(
              "grid min-h-screen",
              sidebarCollapsed
                ? "lg:grid-cols-[56px_1fr]"
                : "lg:grid-cols-[250px_1fr]",
            )}
            style={{ transition: "grid-template-columns 0.2s ease" }}
          >
            <aside className="sticky top-0 hidden max-h-screen overflow-y-auto overflow-x-hidden border-r border-[var(--line-soft)] bg-[var(--bg-sidebar)] text-[#e4f4ff] lg:block">
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
                      <p className="mt-2 text-sm text-[#aad0e4]">Secure office workspace</p>
                    </div>

                    <nav className="space-y-2">
                      {navItems.map((item) => {
                        const active =
                          pathname === item.href || pathname.startsWith(`${item.href}/`);
                        return (
                          <Link
                            key={item.href}
                            href={item.href}
                            className={classNames(
                              "block rounded-xl px-4 py-3 text-sm font-semibold transition",
                              active
                                ? "bg-gradient-to-r from-[#157bbf] to-[#1a9ba9] text-white"
                                : "text-[#d5ebf8] hover:bg-white/10",
                            )}
                          >
                            {item.label}
                          </Link>
                        );
                      })}
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
                      {navItems.map((item) => {
                        const active =
                          pathname === item.href || pathname.startsWith(`${item.href}/`);
                        return (
                          <Link
                            key={item.href}
                            href={item.href}
                            className={classNames(
                              "flex h-10 w-10 items-center justify-center rounded-xl transition",
                              active
                                ? "bg-gradient-to-r from-[#157bbf] to-[#1a9ba9] text-white"
                                : "text-[#d5ebf8] hover:bg-white/10",
                            )}
                            title={item.label}
                          >
                            {navIcons[item.href] ?? item.label.charAt(0)}
                          </Link>
                        );
                      })}
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
              <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--line-soft)] bg-white/70 px-4 py-4 lg:px-7 lg:py-5">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--text-muted)]">
                    My Note Goat
                  </div>
                  <h1 className="text-2xl font-semibold text-[var(--text-main)]">
                    {buildTitle(pathname, navItems)}
                  </h1>
                </div>
                <div className="inline-flex items-center rounded-full bg-[var(--bg-soft)] px-4 py-2 text-sm font-semibold text-[var(--text-main)]">
                  {userEmail || "Secure cloud mode"}
                </div>
              </header>

              <nav className="flex gap-2 overflow-x-auto border-b border-[var(--line-soft)] bg-white/70 px-3 py-3 lg:hidden">
                {navItems.map((item) => {
                  const active =
                    pathname === item.href || pathname.startsWith(`${item.href}/`);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={classNames(
                        "whitespace-nowrap rounded-full px-4 py-2 text-sm font-semibold",
                        active
                          ? "bg-[var(--brand-primary)] text-white"
                          : "bg-[var(--bg-soft)] text-[var(--text-main)]",
                      )}
                    >
                      {item.label}
                    </Link>
                  );
                })}
              </nav>

              <main className="p-4 lg:p-7">{children}</main>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
