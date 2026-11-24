"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { startDemoSession } from "@/lib/demo-client";

export default function DemoPage() {
  const router = useRouter();
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void startDemoSession().then((result) => {
      if (!active) return;
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.replace("/");
    });
    return () => {
      active = false;
    };
  }, [router]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--bg-app)] p-6">
      <div className="w-full max-w-md rounded-[26px] border border-white/70 bg-white/75 p-8 text-center shadow-[0_20px_50px_rgba(16,38,58,0.12)]">
        <img src="/mynotegoatlogo.png" alt="My Note Goat" className="mx-auto mb-3 h-24 w-auto" />
        <h1 className="text-2xl font-semibold text-[var(--text-main)]">Demo office</h1>
        {error ? (
          <p className="mt-4 text-sm text-red-700" role="alert">{error}</p>
        ) : (
          <p className="mt-4 text-sm text-[var(--text-muted)]">Opening the demo office…</p>
        )}
      </div>
    </div>
  );
}
