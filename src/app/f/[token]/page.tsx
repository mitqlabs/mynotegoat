import type { Metadata, Viewport } from "next";
import { PatientFormPage } from "@/components/patient-form-page";

// Public questionnaire page: no login, never indexed, never leaks the link in a Referer.
export const metadata: Metadata = {
  title: "Patient questionnaire",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};
export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default async function FormPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <PatientFormPage token={token} />;
}
