"use client";

import Link from "next/link";
import { FormEvent, useMemo, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";

type BillingPeriod = "monthly" | "annual";

type PeriodOption = {
  period: BillingPeriod;
  name: string;
  price: string;
  cadence: string;
  note?: string;
  highlight?: boolean;
};

// One all-access plan, billed monthly or annually.
const PERIOD_OPTIONS: PeriodOption[] = [
  {
    period: "monthly",
    name: "Monthly",
    price: "$199.99",
    cadence: "/mo",
  },
  {
    period: "annual",
    name: "Annual",
    price: "$1,999.99",
    cadence: "/yr",
    note: "2 months free",
    highlight: true,
  },
];

// Everything is included — one plan, full access.
const PLAN_FEATURES = [
  "Patient Records & Case Files",
  "Appointment Scheduling",
  "Encounter Notes / SOAP",
  "Billing & Packages",
  "Statistics & Reporting",
  "Contacts, Key Dates & My Files",
  "Marketing & Outreach Tracking",
  "Team Members & Permissions",
];

export default function SignupPage() {
  const [selectedPeriod, setSelectedPeriod] = useState<BillingPeriod | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const supabaseMissing = useMemo(() => !getSupabaseBrowserClient(), []);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setMessage("");

    if (!selectedPeriod) {
      setError("Please choose monthly or annual billing first.");
      return;
    }

    const supabase = getSupabaseBrowserClient();
    if (!supabase) {
      setError("Supabase is not configured. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.");
      return;
    }

    setLoading(true);

    const redirectTo = `${window.location.origin}/auth/login`;

    const { error: signUpError } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: {
        emailRedirectTo: redirectTo,
        data: {
          selected_period: selectedPeriod,
        },
      },
    });

    setLoading(false);

    if (signUpError) {
      setError(signUpError.message);
      return;
    }

    setMessage(
      "Account created. Verify your email from your inbox, then sign in. Access stays locked until admin approval.",
    );
  };

  return (
    <div className="space-y-5">
      <div>
        <img src="/mynotegoatlogo.png" alt="My Note Goat" className="mx-auto mb-3 h-24 w-auto" />
        <h1 className="mt-2 text-3xl font-semibold text-[var(--text-main)]">Create Account</h1>
        <p className="mt-2 text-[15px] text-[var(--text-muted)]">
          Choose your plan, then sign up with your clinic email.
        </p>
      </div>

      {/* One all-access plan — choose billing period */}
      <div>
        <span className="text-sm font-semibold text-[var(--text-main)]">Your plan</span>
        <div className="mt-2 rounded-[14px] border-2 border-[var(--line-strong)] bg-white p-4">
          <p className="text-lg font-bold text-[var(--text-main)]">Everything included</p>
          <p className="mt-0.5 text-sm text-[var(--text-muted)]">
            One plan, full access to the whole app.
          </p>
          <ul className="mt-3 grid gap-1 sm:grid-cols-2">
            {PLAN_FEATURES.map((feature) => (
              <li key={feature} className="flex items-center gap-1.5 text-sm text-[var(--text-main)]">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5 shrink-0 text-emerald-500">
                  <path fillRule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clipRule="evenodd" />
                </svg>
                {feature}
              </li>
            ))}
          </ul>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {PERIOD_OPTIONS.map((option) => {
              const isSelected = selectedPeriod === option.period;
              return (
                <button
                  key={option.period}
                  type="button"
                  onClick={() => setSelectedPeriod(option.period)}
                  className={`relative rounded-[14px] border-2 px-4 py-3 text-left transition ${
                    isSelected
                      ? "border-[var(--brand-primary)] bg-[#ecf4fa]"
                      : "border-[var(--line-strong)] bg-white hover:border-[#9ab8cc]"
                  }`}
                >
                  {isSelected && (
                    <span className="absolute right-3 top-3 flex h-6 w-6 items-center justify-center rounded-full bg-[var(--brand-primary)] text-white">
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                        <path fillRule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clipRule="evenodd" />
                      </svg>
                    </span>
                  )}
                  <div className="flex items-center gap-2">
                    <span className="text-base font-bold text-[var(--text-main)]">{option.name}</span>
                    {option.note && (
                      <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-700">
                        {option.note}
                      </span>
                    )}
                  </div>
                  <div className="mt-1">
                    <span className="text-xl font-bold text-[var(--text-main)]">{option.price}</span>
                    <span className="text-sm text-[var(--text-muted)]">{option.cadence}</span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {supabaseMissing ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Supabase environment variables are missing in this deployment.
        </div>
      ) : null}

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      {message ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {message}
        </div>
      ) : null}

      <form className="space-y-4" onSubmit={onSubmit}>
        <label className="block space-y-2">
          <span className="text-sm font-semibold text-[var(--text-main)]">Email</span>
          <input
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            type="email"
            required
            className="w-full rounded-[14px] border border-[var(--line-strong)] bg-white px-4 py-3 text-[17px] outline-none focus:border-[var(--brand-primary)]"
            placeholder="doctor@clinic.com"
          />
        </label>

        <label className="block space-y-2">
          <span className="text-sm font-semibold text-[var(--text-main)]">Password</span>
          <input
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            type="password"
            required
            minLength={8}
            className="w-full rounded-[14px] border border-[var(--line-strong)] bg-white px-4 py-3 text-[17px] outline-none focus:border-[var(--brand-primary)]"
            placeholder="At least 8 characters"
          />
        </label>

        <button
          type="submit"
          disabled={loading || supabaseMissing || !selectedPeriod}
          className="rounded-[14px] bg-[var(--brand-primary)] px-5 py-3 text-base font-semibold text-white disabled:opacity-50"
        >
          {loading ? "Creating account..." : "Create Account"}
        </button>
      </form>

      <p className="text-sm text-[var(--text-muted)]">
        Already signed up?{" "}
        <Link className="font-semibold text-[var(--brand-primary)]" href="/auth/login">
          Back to sign in
        </Link>
      </p>
    </div>
  );
}
