import type { Metadata, Viewport } from "next";
import { PhoneScanPage } from "@/components/phone-scan-page";

// Public one-time phone scan page: no login, never indexed, no Referer.
export const metadata: Metadata = {
  title: "Scan to NoteGoat",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};
export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default async function ScanPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <PhoneScanPage token={token} />;
}
