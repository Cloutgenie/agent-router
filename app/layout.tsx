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
  title: "Task Dropoff - tell us the outcome, we route the work",
  description:
    "Describe an outcome. Task Dropoff plans the work, routes each step to the right provider, verifies the evidence, and returns a ranked, evidence-backed result.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased dark`}
    >
      <body className="min-h-full flex flex-col">
        <header className="sticky top-0 z-40 border-b border-border bg-background/80 backdrop-blur">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-2 px-3 py-3 sm:px-6">
            <Link href="/" className="flex shrink-0 items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent text-sm font-bold text-white">
                TD
              </span>
              <span className="text-sm font-semibold tracking-tight whitespace-nowrap text-foreground">
                Task Dropoff
              </span>
            </Link>
            <nav className="flex min-w-0 items-center gap-0.5 overflow-x-auto text-sm scrollbar-thin sm:gap-1">
              <Link href="/" className="shrink-0 whitespace-nowrap rounded-lg px-2 py-1.5 text-muted transition hover:bg-surface-raised hover:text-foreground sm:px-3">
                Execute
              </Link>
              <Link href="/history" className="shrink-0 whitespace-nowrap rounded-lg px-2 py-1.5 text-muted transition hover:bg-surface-raised hover:text-foreground sm:px-3">
                History
              </Link>
              <Link href="/benchmarks" className="shrink-0 whitespace-nowrap rounded-lg px-2 py-1.5 text-muted transition hover:bg-surface-raised hover:text-foreground sm:px-3">
                Benchmarks
              </Link>
              <Link href="/live-test" className="shrink-0 whitespace-nowrap rounded-lg px-2 py-1.5 text-muted transition hover:bg-surface-raised hover:text-foreground sm:px-3">
                Live Test
              </Link>
              <Link href="/executors" className="shrink-0 whitespace-nowrap rounded-lg px-2 py-1.5 text-muted transition hover:bg-surface-raised hover:text-foreground sm:px-3">
                Executors
              </Link>
              <Link href="/experiments" className="shrink-0 whitespace-nowrap rounded-lg px-2 py-1.5 text-muted transition hover:bg-surface-raised hover:text-foreground sm:px-3">
                Experiments
              </Link>
              <Link href="/market" className="shrink-0 whitespace-nowrap rounded-lg px-2 py-1.5 text-muted transition hover:bg-surface-raised hover:text-foreground sm:px-3">
                Market
              </Link>
              <Link href="/supply" className="shrink-0 whitespace-nowrap rounded-lg px-2 py-1.5 text-muted transition hover:bg-surface-raised hover:text-foreground sm:px-3">
                Supply
              </Link>
              <Link href="/demand" className="shrink-0 whitespace-nowrap rounded-lg px-2 py-1.5 text-muted transition hover:bg-surface-raised hover:text-foreground sm:px-3">
                Demand
              </Link>
            </nav>
          </div>
        </header>
        <main className="flex-1">{children}</main>
        <footer className="border-t border-border py-6 text-center text-xs text-muted-dim">
          Task Dropoff prototype - Demo Mode by default, ready for live provider credentials.
        </footer>
      </body>
    </html>
  );
}
