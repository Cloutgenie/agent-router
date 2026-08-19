import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Agent Router - goal in, verified outcome out",
  description:
    "Describe an outcome and Agent Router analyzes it, picks the best AI agent or team, executes, and evaluates the result.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased dark`}
    >
      <body className="min-h-full flex flex-col">
        <header className="sticky top-0 z-40 border-b border-border bg-background/80 backdrop-blur">
          <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 sm:px-6">
            <Link href="/" className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent text-sm font-bold text-white">
                AR
              </span>
              <span className="text-sm font-semibold tracking-tight text-foreground">
                Agent Router
              </span>
            </Link>
            <nav className="flex items-center gap-1 text-sm">
              <Link
                href="/"
                className="rounded-lg px-3 py-1.5 text-muted transition hover:bg-surface-raised hover:text-foreground"
              >
                Route
              </Link>
              <Link
                href="/history"
                className="rounded-lg px-3 py-1.5 text-muted transition hover:bg-surface-raised hover:text-foreground"
              >
                History
              </Link>
            </nav>
          </div>
        </header>
        <main className="flex-1">{children}</main>
        <footer className="border-t border-border py-6 text-center text-xs text-muted-dim">
          Agent Router prototype - mock execution engine, ready for real provider adapters.
        </footer>
      </body>
    </html>
  );
}
