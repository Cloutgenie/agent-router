"use client";

import { useState } from "react";
import { QualityPreference, RoutingPreference, TaskConstraints } from "@/types";

const INPUT_CLASS =
  "w-full rounded-lg border border-border bg-surface-raised px-2.5 py-1.5 text-xs text-foreground focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-60";

export function TaskForm({
  rawTask,
  onRawTaskChange,
  onSubmit,
  isRunning,
}: {
  rawTask: string;
  onRawTaskChange: (value: string) => void;
  onSubmit: (constraints: TaskConstraints) => void;
  isRunning: boolean;
}) {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [budget, setBudget] = useState("");
  const [deadlineMinutes, setDeadlineMinutes] = useState("");
  const [qualityPreference, setQualityPreference] = useState<QualityPreference>("standard");
  const [routingPreference, setRoutingPreference] = useState<RoutingPreference>("balanced");
  const [resultCount, setResultCount] = useState("15");
  const [allowParallel, setAllowParallel] = useState(true);
  const [compareStrategies, setCompareStrategies] = useState(false);
  const [approvedActions, setApprovedActions] = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!rawTask.trim() || isRunning) return;
    onSubmit({
      budget: budget ? Number(budget) : undefined,
      deadline_minutes: deadlineMinutes ? Number(deadlineMinutes) : undefined,
      quality_preference: qualityPreference,
      routing_preference: routingPreference,
      allow_parallel: allowParallel,
      result_count: resultCount ? Number(resultCount) : undefined,
      compare_strategies: compareStrategies,
      approved_actions: approvedActions
        .split(",")
        .map((a) => a.trim())
        .filter(Boolean) as TaskConstraints["approved_actions"],
    });
  }

  return (
    <form onSubmit={handleSubmit} className="card p-4 sm:p-5">
      <textarea
        value={rawTask}
        onChange={(e) => onRawTaskChange(e.target.value)}
        placeholder="What outcome do you want accomplished?"
        rows={4}
        disabled={isRunning}
        className="w-full resize-none rounded-lg border border-border bg-surface-raised p-3.5 text-[15px] leading-relaxed text-foreground placeholder:text-muted-dim focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-60"
      />

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => setShowAdvanced((v) => !v)}
          className="text-xs font-medium text-muted transition hover:text-foreground"
        >
          {showAdvanced ? "Hide" : "Show"} advanced options
          <span className="ml-1">{showAdvanced ? "▴" : "▾"}</span>
        </button>

        <button
          type="submit"
          disabled={!rawTask.trim() || isRunning}
          className="inline-flex items-center gap-2 rounded-lg bg-accent px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isRunning ? (
            <>
              <span className="h-1.5 w-1.5 animate-pulse-dot rounded-full bg-white" />
              Routing...
            </>
          ) : (
            "Route & Execute"
          )}
        </button>
      </div>

      {showAdvanced && (
        <div className="mt-4 grid grid-cols-2 gap-3 border-t border-border pt-4 sm:grid-cols-3 lg:grid-cols-6">
          <Field label="Budget ($)">
            <input type="number" min={0} step={0.5} value={budget} onChange={(e) => setBudget(e.target.value)} placeholder="No limit" disabled={isRunning} className={INPUT_CLASS} />
          </Field>
          <Field label="Deadline (min)">
            <input type="number" min={0} value={deadlineMinutes} onChange={(e) => setDeadlineMinutes(e.target.value)} placeholder="No limit" disabled={isRunning} className={INPUT_CLASS} />
          </Field>
          <Field label="Quality">
            <select value={qualityPreference} onChange={(e) => setQualityPreference(e.target.value as QualityPreference)} disabled={isRunning} className={INPUT_CLASS}>
              <option value="standard">Standard</option>
              <option value="high">High</option>
              <option value="best">Best</option>
            </select>
          </Field>
          <Field label="Optimize for">
            <select value={routingPreference} onChange={(e) => setRoutingPreference(e.target.value as RoutingPreference)} disabled={isRunning} className={INPUT_CLASS}>
              <option value="balanced">Balanced</option>
              <option value="best-quality">Best quality</option>
              <option value="lowest-cost">Lowest cost</option>
              <option value="fastest">Fastest result</option>
              <option value="highest-reliability">Highest reliability</option>
              <option value="market-optimal">Market optimal</option>
            </select>
          </Field>
          <Field label="Result count">
            <input type="number" min={1} max={50} value={resultCount} onChange={(e) => setResultCount(e.target.value)} disabled={isRunning} className={INPUT_CLASS} />
          </Field>
          <div className="col-span-2 flex flex-col justify-end gap-1.5 sm:col-span-1">
            <label className="flex items-center gap-1.5 text-[11px] text-muted">
              <input type="checkbox" checked={allowParallel} onChange={(e) => setAllowParallel(e.target.checked)} disabled={isRunning} className="h-3.5 w-3.5 rounded border-border-strong accent-accent" />
              Parallel execution
            </label>
            <label className="flex items-center gap-1.5 text-[11px] text-muted">
              <input type="checkbox" checked={compareStrategies} onChange={(e) => setCompareStrategies(e.target.checked)} disabled={isRunning} className="h-3.5 w-3.5 rounded border-border-strong accent-accent" />
              Compare routing strategy
            </label>
          </div>
          <Field label="Pre-approve actions">
            <input
              type="text"
              value={approvedActions}
              onChange={(e) => setApprovedActions(e.target.value)}
              placeholder="e.g. email-send, crm-write"
              disabled={isRunning}
              className={INPUT_CLASS}
            />
          </Field>
        </div>
      )}
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] font-medium uppercase tracking-wide text-muted-dim">{label}</span>
      {children}
    </label>
  );
}
