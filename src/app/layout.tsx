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
      <body className="antialiased" suppressHydrationWarning>
        <AppQueryClientProvider>{children}</AppQueryClientProvider>
      </body>
    </html>
  );
}
