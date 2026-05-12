import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: "Eigo — 将棋YouTubeを世界へ",
  description: "AIで日本語動画を、海外視聴者に届く美しい英語字幕に。",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  viewportFit: "cover",
  themeColor: "#09090b",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ja" className={inter.variable}>
      <body className="min-h-screen bg-zinc-950 text-zinc-100 antialiased selection:bg-violet-500/30 selection:text-white">
        <div className="pointer-events-none fixed inset-0 -z-10 bg-[radial-gradient(60%_40%_at_50%_0%,rgba(139,92,246,0.10),transparent_70%),radial-gradient(40%_30%_at_100%_100%,rgba(6,182,212,0.08),transparent_70%)]" />
        {children}
      </body>
    </html>
  );
}
