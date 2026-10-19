"use client";

import { GlobalGoatPopup } from "@/components/global-goat";

/** /goat — only the G.O.A.T. chat, full screen (the home-screen app). Same login, data, confirm cards and admin gating as the popup. ?q= prefills the box. */
export default function GoatAppPage() {
  return <GlobalGoatPopup fullScreen />;
}
