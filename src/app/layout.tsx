import type { Metadata } from "next";
import Script from "next/script";
import "./globals.css";
import { AppQueryClientProvider } from "@/lib/query-client-provider";
import { AppDialogHost } from "@/components/app-dialog";
import { BrandApplier } from "@/components/BrandApplier";
import { ThemeProvider } from "@/lib/theme";
import { THEME_SCRIPT } from "@/lib/theme-script";

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
      <body className="antialiased" suppressHydrationWarning>
        <Script id="theme-boot" strategy="beforeInteractive">
          {THEME_SCRIPT}
        </Script>
        <ThemeProvider>
          <BrandApplier />
          <AppQueryClientProvider>{children}</AppQueryClientProvider>
          <AppDialogHost />
        </ThemeProvider>
      </body>
    </html>
  );
}
