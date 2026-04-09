import type { Metadata, Viewport } from "next";
import { Barlow, Geist_Mono, Teko } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";
import { pingDB } from "@/lib/prisma";

const gymSans = Barlow({
  variable: "--font-geist-sans",
  weight: ["400", "500", "600", "700", "800"],
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const gymDisplay = Teko({
  variable: "--font-display",
  weight: ["500", "600", "700"],
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Royal Fitness — Gym Management",
  description: "Gym management system for Royal Fitness",
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: 'any' },
      { url: '/favicon-16x16.png', sizes: '16x16', type: 'image/png' },
      { url: '/favicon-32x32.png', sizes: '32x32', type: 'image/png' }
    ],
    apple: [
      { url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' },
      { url: '/icon-192.png', sizes: '192x192', type: 'image/png' }
    ],
    shortcut: '/favicon.ico',
  },
  manifest: '/manifest.json',
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Skip during CI / Vercel build so static prerender does not open Neon (timeouts / cold DB).
  if (!process.env.CI) {
    void pingDB()
  }

  return (
    <html
      lang="en"
      className={`${gymSans.variable} ${geistMono.variable} ${gymDisplay.variable} min-h-dvh overflow-x-hidden antialiased`}
    >
      <body className="flex min-h-dvh flex-col overflow-x-hidden overflow-y-auto touch-manipulation [-webkit-overflow-scrolling:touch]">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
