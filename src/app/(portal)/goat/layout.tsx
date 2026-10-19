import type { Metadata, Viewport } from "next";
import { GOAT_MANIFEST_PATH, GOAT_THEME_COLOR } from "@/lib/goat-app";

/** The G.O.A.T. home-screen app: its own manifest (start_url /goat), icons and iOS standalone tags. */
export const metadata: Metadata = {
  title: "G.O.A.T.",
  applicationName: "G.O.A.T.",
  manifest: GOAT_MANIFEST_PATH,
  appleWebApp: { capable: true, title: "G.O.A.T.", statusBarStyle: "default" },
  icons: {
    icon: [
      { url: "/goat-app/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/goat-app/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/goat-app/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  other: { "mobile-web-app-capable": "yes" },
};

export const viewport: Viewport = {
  themeColor: GOAT_THEME_COLOR,
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function GoatAppLayout({ children }: { children: React.ReactNode }) {
  return children;
}
