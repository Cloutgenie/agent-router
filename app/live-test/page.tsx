"use client";

import { useEffect, useRef, useState } from "react";
import { ModeBadge } from "@/components/ModeBadge";
import { TaskResultView } from "@/components/TaskResultView";
import { useTaskRun } from "@/lib/hooks/useTaskRun";
import { ProviderSummary } from "@/types";

const STANDARD_TEST_GOAL =
  "Find 5 cybersecurity startups that recently raised funding, are actively hiring security or AI roles, and appear likely to need AI security services.";

const DEFAULT_CONSTRAINTS = {
  result_count: 5,
  budget: 10,
  quality_preference: "standard" as const,
  routing_preference: "balanced" as const,
  allow_parallel: true,
  compare_strategies: true,
};

const WATCHED_PROVIDER_IDS = ["tavily", "apollo-provider", "llm-analysis-provider", "gemini-analysis-provider"];

/**
 * Live Test workspace (spec #50): a fixed, non-negotiable configuration -
 * result count 5, budget $10, comparison mode on, claim verification always
 * on - so a run here is directly comparable across sessions and providers,
 * unlike the fully-configurable Execute page.
 */
export default function LiveTestPage() {
  const [goal, setGoal] = useState(STANDARD_TEST_GOAL);
  const [providers, setProviders] = useState<ProviderSummary[] | null>(null);
  const { run, isRunning, followUpBusy, runTask, handleFollowUp, handleReview } = useTaskRun();
  const resultsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/executors")
      .then((res) => res.json())
      .then((data: { providers: ProviderSummary[] }) => setProviders(data.providers ?? []))
      .catch(() => setProviders([]));
  }, []);

  const watched = providers?.filter((p) => WATCHED_PROVIDER_IDS.includes(p.id)) ?? [];

  async function handleRun() {
    requestAnimationFrame(() => resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
    await runTask(goal, DEFAULT_CONSTRAINTS);
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 sm:py-14">
      <div className="mb-8">
        <div className="mb-3"><ModeBadge /></div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Live Test</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted">
          A fixed configuration so every run is directly comparable: 5 results, $10 budget,
          comparison mode and claim verification always on. Live providers below run for real
          once their credentials are configured; anything not configured falls back to its mock.
        </p>
      </div>

      <div className="card mb-6 p-4">
        <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-dim">Fixed defaults</div>
        <div className="grid grid-cols-2 gap-3 text-[13px] sm:grid-cols-4">
          <DefaultStat label="Result count" value="5" />
          <DefaultStat label="Budget" value="$10.00" />
          <DefaultStat label="Comparison mode" value="Enabled" />
          <DefaultStat label="Claim verification" value="Enabled" />
        </div>
        <div className="mt-4 border-t border-border pt-3">
          <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-dim">Provider status</div>
          {providers === null ? (
            <p className="text-[12px] text-muted-dim">Checking provider health...</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {watched.map((p) => (
                <span
                  key={p.id}
                  className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${
                    p.configured ? "border-good/30 bg-good-soft text-good" : "border-border bg-surface text-muted-dim"
                  }`}
                >
                  {p.name} · {p.configured ? "live" : "not configured (mock fallback)"}
                </span>
              ))}
              <span className="rounded-full border border-border bg-surface px-2.5 py-1 text-[11px] font-medium text-muted-dim">
                Browser verification · not yet implemented
              </span>
            </div>
          )}
        </div>
      </div>

      <div className="card p-4 sm:p-5">
        <textarea
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          rows={3}
          disabled={isRunning}
          className="w-full resize-none rounded-lg border border-border bg-surface-raised p-3.5 text-[15px] leading-relaxed text-foreground focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-60"
        />
        <div className="mt-3 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => setGoal(STANDARD_TEST_GOAL)}
            disabled={isRunning}
            className="text-xs font-medium text-muted transition hover:text-foreground disabled:opacity-50"
          >
            Reset to standard test
          </button>
          <button
            type="button"
            onClick={handleRun}
            disabled={!goal.trim() || isRunning}
            className="inline-flex items-center gap-2 rounded-lg bg-accent px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isRunning ? (
              <>
                <span className="h-1.5 w-1.5 animate-pulse-dot rounded-full bg-white" />
                Routing...
              </>
            ) : (
              "Run Live Test"
            )}
          </button>
        </div>
      </div>

      {run && (
        <div ref={resultsRef} className="mt-10 scroll-mt-20">
          <TaskResultView
            status={run.status}
            workflow={run.workflow}
            capabilities={run.capabilities}
            plan={run.plan}
            buyerResults={run.buyerResults}
            excludedResults={run.excludedResults}
            finalResult={run.finalResult}
            evaluationSummary={run.evaluationSummary}
            trace={run.trace}
            comparison={run.comparison}
            budgetOutcome={run.budgetOutcome}
            error={run.error}
            onFollowUp={handleFollowUp}
            onReview={handleReview}
            followUpBusy={followUpBusy}
          />
        </div>
      )}
    </div>
  );
}

function DefaultStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-muted-dim">{label}</div>
      <div className="mt-0.5 font-medium text-foreground">{value}</div>
    </div>
  );
}
