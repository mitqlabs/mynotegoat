import { SkeletonRows } from "@/components/ui/skeleton";

export default function Loading() {
  return <SkeletonRows label="Loading patients…" rows={8} />;
}
