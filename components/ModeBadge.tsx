"use client";

import { useEffect, useState } from "react";
import { ExecutionMode } from "@/types";

interface ProvidersSummary {
  mode: ExecutionMode;
  demo_providers_available: number;
  live_providers_connected: number;
}

export function ModeBadge() {
  const [summary, setSummary] = useState<ProvidersSummary | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/executors")
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled) setSummary(data);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  if (!summary) return null;

  const isLive = summary.mode === "live";

  return (
    <div
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-medium ${
        isLive ? "border-good/30 bg-good-soft text-good" : "border-border bg-surface text-muted"
      }`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${isLive ? "bg-good" : "bg-muted-dim"}`} />
      {isLive
        ? `Live Providers: ${summary.live_providers_connected} connected`
        : `Demo Mode - ${summary.demo_providers_available} providers available`}
    </div>
  );
}
