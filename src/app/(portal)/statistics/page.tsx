import { redirect } from "next/navigation";

// The Dashboard used to live at /statistics. Keep old links and bookmarks working.
export default function StatisticsRedirect() {
  redirect("/dashboard");
}
