import type { Metadata } from "next";
import "./globals.css";
import { AppQueryClientProvider } from "@/lib/query-client-provider";

export const metadata: Metadata = {
  title: "My Note Goat",
  description: "Secure chiropractic office workspace",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Apply the saved theme before first paint so there's no flash of
            the wrong palette. Mirrors src/lib/theme.ts. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "(function(){try{var p=localStorage.getItem('casemate.theme.v1')||'light';var d=p==='dark';document.documentElement.setAttribute('data-theme',d?'dark':'light');}catch(e){}})();",
          }}
        />
      </head>
      <body className="antialiased" suppressHydrationWarning>
        <AppQueryClientProvider>{children}</AppQueryClientProvider>
      </body>
    </html>
  );
}
