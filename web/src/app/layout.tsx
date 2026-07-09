import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./emic.css";
import { Toaster } from "@/components/ui/toaster";

export const metadata: Metadata = {
  title: "智慧雲端動態救護系統",
  description: "EMIC 智慧雲端動態救護儀表板 — 新北市消防局 EPCR 即時救護車追蹤",
  icons: {
    icon: "/favicon.ico",
    apple: "/bird50.png",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#17c7c1",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-TW" suppressHydrationWarning>
      <body className="emic-body antialiased">
        {children}
        <Toaster />
      </body>
    </html>
  );
}
