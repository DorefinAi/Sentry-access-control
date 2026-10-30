import type { Metadata, Viewport } from "next";
import { Chakra_Petch, IBM_Plex_Mono, IBM_Plex_Sans, Noto_Sans_Devanagari } from "next/font/google";
import "./globals.css";
import { AppRouterCacheProvider } from "@mui/material-nextjs/v16-appRouter";
import MuiProvider from "@/providers/MuiProvider";

// Chakra Petch is the console voice (panel designations, status words, gauge labels);
// IBM Plex Sans is for reading; IBM Plex Mono for every number, clock and slug.
// Noto Sans Devanagari covers Hindi headlines.
const display = Chakra_Petch({ subsets: ["latin"], weight: ["500", "600", "700"], display: "swap", variable: "--font-display" });
const ui = IBM_Plex_Sans({ subsets: ["latin", "latin-ext"], weight: ["400", "500", "600", "700"], display: "swap", variable: "--font-ui" });
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500", "600"], display: "swap", variable: "--font-mono" });
const devanagari = Noto_Sans_Devanagari({ subsets: ["devanagari"], weight: ["400", "500", "600", "700"], display: "swap", variable: "--font-devanagari" });

export const metadata: Metadata = {
  title: { default: "Overview - Sentry", template: "%s - Sentry" },
  description: "Private mission control for the newsroom pipelines: assignment, digital, database, backups and AI.",
};

// Browser chrome matches the ops room: night ground in dark, daylight ground in light
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#060A12" },
    { media: "(prefers-color-scheme: light)", color: "#E8EDF3" },
  ],
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning className={`${display.variable} ${ui.variable} ${mono.variable} ${devanagari.variable}`}>
      <body>
        {/* Collects Emotion's styles into <head> during server rendering, so the HTML matches on hydration */}
        <AppRouterCacheProvider>
          <MuiProvider>{children}</MuiProvider>
        </AppRouterCacheProvider>
      </body>
    </html>
  );
}
