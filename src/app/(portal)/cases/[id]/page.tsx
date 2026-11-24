import { redirect } from "next/navigation";

type PageProps = { params: Promise<{ id: string }> };

/** A case always opens the existing full patient file at /patients/[id]. */
export default async function CaseFilePage({ params }: PageProps) {
  const { id } = await params;
  redirect(`/patients/${id}`);
}
