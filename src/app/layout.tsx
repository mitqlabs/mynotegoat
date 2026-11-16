import type { Metadata } from "next";
import Script from "next/script";
import "./globals.css";
import { AppQueryClientProvider } from "@/lib/query-client-provider";
import { AppDialogHost } from "@/components/app-dialog";
import BrandApplier from "@/components/brand-applier";
import { BRAND_BOOT_SCRIPT } from "@/lib/brand-boot";

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
    <html lang="en" data-brand="blue" data-tone="light" suppressHydrationWarning>
      <body className="antialiased" suppressHydrationWarning>
        <Script id="brand-boot" strategy="beforeInteractive">
          {BRAND_BOOT_SCRIPT}
        </Script>
        <BrandApplier />
        <AppQueryClientProvider>{children}</AppQueryClientProvider>
        <AppDialogHost />
      </body>
    </html>
  );
}
