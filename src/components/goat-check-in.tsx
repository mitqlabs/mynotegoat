"use client";

import Image from "next/image";

/**
 * Boot screen: the G.O.A.T. with his tablet, bobbing inside a spinning ring
 * (a nod to the cycle logo). Pure CSS — no 3D libs. Motion stops under
 * prefers-reduced-motion.
 */
export function GoatCheckIn({ label = "G.O.A.T. is checking you in…" }: { label?: string }) {
  return (
    <div role="status" aria-live="polite" className="goat-checkin flex flex-col items-center justify-center gap-4 py-10">
      <div className="relative h-36 w-36">
        <svg className="goat-checkin-ring absolute inset-0 h-full w-full" viewBox="0 0 100 100" aria-hidden="true">
          <circle cx="50" cy="50" r="46" fill="none" stroke="currentColor" strokeOpacity="0.12" strokeWidth="4" />
          <circle
            cx="50"
            cy="50"
            r="46"
            fill="none"
            stroke="var(--brand-primary, #0d9488)"
            strokeWidth="4"
            strokeLinecap="round"
            strokeDasharray="72 217"
          />
        </svg>
        <div className="goat-checkin-goat absolute inset-3 flex items-end justify-center overflow-hidden rounded-full bg-[var(--bg-soft,#f1f5f9)]">
          <Image src="/goat-avatar/tablet-256.png" alt="" width={112} height={112} priority className="select-none" draggable={false} />
          <span className="goat-checkin-tap absolute bottom-[34%] right-[30%] h-1.5 w-1.5 rounded-full bg-[var(--brand-primary,#0d9488)]" />
        </div>
      </div>
      <p className="text-sm font-medium text-[var(--text-muted,#64748b)]">
        {label}
      </p>
      <style>{`
        .goat-checkin-ring { animation: goat-spin 1.4s linear infinite; transform-origin: 50% 50%; }
        .goat-checkin-goat img { animation: goat-bob 1.6s ease-in-out infinite; }
        .goat-checkin-tap { opacity: 0; animation: goat-tap 0.8s ease-in-out infinite; }
        @keyframes goat-spin { to { transform: rotate(360deg); } }
        @keyframes goat-bob { 0%,100% { transform: translateY(2px) rotate(-1.5deg); } 50% { transform: translateY(-3px) rotate(1.5deg); } }
        @keyframes goat-tap { 0%,100% { opacity: 0; transform: scale(.6); } 40% { opacity: .9; transform: scale(1.4); } }
        @media (prefers-reduced-motion: reduce) {
          .goat-checkin-ring, .goat-checkin-goat img, .goat-checkin-tap { animation: none; }
        }
      `}</style>
    </div>
  );
}
