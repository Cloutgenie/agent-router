"use client";

import { useMemo, useState } from "react";
import { ActionBar } from "./ActionBar";
import { CapabilityBadges } from "./CapabilityBadges";
import { ComparisonPanel } from "./ComparisonPanel";
import { DetailDrawer } from "./DetailDrawer";
import { ExcludedPanel } from "./ExcludedPanel";
import { GenericResultCard } from "./GenericResultCard";
import { PlanGraph } from "./PlanGraph";
import { ResultsTable } from "./ResultsTable";
import { StageStepper } from "./StageStepper";
import { StatTileRow } from "./StatTiles";
import { TraceLog } from "./TraceLog";
import { buildCsv, buildJson, downloadFile } from "@/lib/export";
import {
  BudgetOutcome,
  BuyerRecord,
  Capability,
  EvaluationSummary,
  ExecutionPlan,
  FinalResult,
  FollowUpAction,
  ReviewState,
  StrategyComparison,
  TaskEconomics,
  TaskStatus,
  TraceEvent,
  WorkflowType,
} from "@/types";

export interface TaskResultViewProps {
  status: TaskStatus;
  workflow?: WorkflowType;
  capabilities: Capability[];
  plan: ExecutionPlan | null;
  buyerResults: BuyerRecord[];
  excludedResults: BuyerRecord[];
  finalResult?: FinalResult;
  evaluationSummary: EvaluationSummary | null;
  trace: TraceEvent[];
  comparison?: StrategyComparison;
  budgetOutcome?: BudgetOutcome;
  economics?: TaskEconomics;
  error?: string | null;
  onFollowUp?: (action: FollowUpAction, selectedIds: string[]) => void;
  onReview?: (id: string, state: ReviewState) => void;
  followUpBusy?: boolean;
}

function centsToDisplay(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

const BILLING_STATUS_LABEL: Record<TaskEconomics["billingStatus"], string> = {
  billable: "Charged",
  partially_billable: "Partially charged",
  not_billable: "Not charged - no usable result",
  refunded: "Refunded",
};

function Receipt({ economics, evaluationSummary }: { economics: TaskEconomics; evaluationSummary: EvaluationSummary | null }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <Section title="Receipt">
      <div className="card p-4 text-[13px]">
        <div className="flex flex-wrap items-center gap-4 font-mono">
          <span>Execution price: {centsToDisplay(economics.customerPriceCents)}</span>
          {evaluationSummary && <span>Execution time: {evaluationSummary.total_latency}s</span>}
          {evaluationSummary && <span>Verified claims: {Math.round(evaluationSummary.verified_claim_rate * 100)}%</span>}
          <span className="text-muted-dim">{BILLING_STATUS_LABEL[economics.billingStatus]}</span>
        </div>
        {economics.overageAmountCents > 0 && (
          <p className="mt-2 text-[12px] text-warn">
            {centsToDisplay(economics.overageAmountCents)} of this exceeded your included execution balance and will
            appear as overage.
          </p>
        )}
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-3 text-[11px] text-muted-dim underline decoration-dotted hover:text-foreground"
        >
          {expanded ? "Hide cost breakdown" : "View cost breakdown"}
        </button>
        {expanded && (
          <div className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 font-mono text-[12px] text-muted sm:grid-cols-4">
            <span>Provider cost: {centsToDisplay(economics.providerCostCents)}</span>
            <span>Verification cost: {centsToDisplay(economics.verificationCostCents)}</span>
            <span>Platform margin: {centsToDisplay(economics.platformCostCents)}</span>
            <span>Included credit applied: {centsToDisplay(economics.includedCreditAppliedCents)}</span>
          </div>
        )}
      </div>
    </Section>
  );
}

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="animate-fade-in-up">
      <div className="mb-3">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        {subtitle && <p className="text-xs text-muted-dim">{subtitle}</p>}
      </div>
      {children}
    </section>
  );
}

export function TaskResultView({
  status,
  workflow,
  capabilities,
  plan,
  buyerResults,
  excludedResults,
  finalResult,
  evaluationSummary,
  trace,
  comparison,
  budgetOutcome,
  economics,
  error,
  onFollowUp,
  onReview,
  followUpBusy,
}: TaskResultViewProps) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [detailRecord, setDetailRecord] = useState<BuyerRecord | null>(null);
  const [localResults, setLocalResults] = useState<BuyerRecord[] | null>(null);

  const results = localResults ?? buyerResults;

  const selectedRecords = useMemo(() => results.filter((r) => selectedIds.has(r.id)), [results, selectedIds]);

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll(ids: string[]) {
    setSelectedIds((prev) => {
      const allSelected = ids.every((id) => prev.has(id));
      if (allSelected) {
        const next = new Set(prev);
        ids.forEach((id) => next.delete(id));
        return next;
      }
      return new Set([...prev, ...ids]);
    });
  }

  function handleReview(id: string, state: ReviewState) {
    setLocalResults((prev) => (prev ?? buyerResults).map((r) => (r.id === id ? { ...r, reviewState: state } : r)));
    setDetailRecord((prev) => (prev && prev.id === id ? { ...prev, reviewState: state } : prev));
    onReview?.(id, state);
  }

  const stats = evaluationSummary
    ? [
        { label: "Qualified buyers", value: String(evaluationSummary.qualified_count) },
        { label: "Avg. confidence", value: `${Math.round(evaluationSummary.average_confidence * 100)}%` },
        { label: "Execution cost", value: `$${evaluationSummary.total_cost.toFixed(2)}` },
        { label: "Total time", value: `${evaluationSummary.total_latency}s` },
        { label: "Providers used", value: String(evaluationSummary.providers_used) },
      ]
    : [];

  return (
    <div className="space-y-8">
      <div className="card p-4">
        <StageStepper status={status} />
      </div>

      {error && <div className="rounded-lg border border-bad/30 bg-bad-soft p-4 text-sm text-bad">{error}</div>}

      {capabilities.length > 0 && (
        <Section title="1 · Capabilities inferred" subtitle="Deterministic keyword classifier">
          <CapabilityBadges capabilities={capabilities} />
        </Section>
      )}

      {plan && plan.steps.length > 0 && (
        <Section title="2 · Execution plan" subtitle="Each step routed to its own provider - independent steps run in parallel">
          <PlanGraph steps={plan.steps} />
        </Section>
      )}

      {economics && <Receipt economics={economics} evaluationSummary={evaluationSummary} />}

      {budgetOutcome && (
        <Section title="Budget">
          <div className="card p-4 text-[13px]">
            <div className="flex flex-wrap gap-4 font-mono">
              <span>Budget: ${budgetOutcome.budget.toFixed(2)}</span>
              <span>Estimated: ${budgetOutcome.estimated.toFixed(2)}</span>
              <span>Actual: ${budgetOutcome.actual.toFixed(2)}</span>
            </div>
            <ul className="mt-2 space-y-0.5 text-muted">
              {budgetOutcome.adjustments.map((a, i) => (
                <li key={i}>- {a}</li>
              ))}
            </ul>
          </div>
        </Section>
      )}

      {comparison && (
        <Section title="Routing strategy comparison" subtitle="Single provider vs. the routed multi-provider execution">
          <ComparisonPanel comparison={comparison} />
        </Section>
      )}

      {trace.length > 0 && <TraceLog trace={trace} />}

      {evaluationSummary && (results.length > 0 || finalResult) && (
        <Section title="3 · Results" subtitle="The final deliverable">
          {stats.length > 0 && <div className="mb-4"><StatTileRow tiles={stats} /></div>}

          {workflow === "buyer-discovery" ? (
            <div className="space-y-4">
              <ActionBar
                selectedCount={selectedIds.size}
                disabled={followUpBusy}
                onFollowUp={(action) => onFollowUp?.(action, Array.from(selectedIds))}
                onExportCsv={() => downloadFile("task-dropoff-results.csv", buildCsv(selectedRecords), "text/csv")}
                onExportJson={() => downloadFile("task-dropoff-results.json", buildJson(selectedRecords), "application/json")}
              />
              <ResultsTable
                records={results}
                selectedIds={selectedIds}
                onToggleSelect={toggleSelect}
                onToggleSelectAll={toggleSelectAll}
                onOpenDetail={setDetailRecord}
              />
              <ExcludedPanel records={excludedResults} />
            </div>
          ) : (
            finalResult && <GenericResultCard result={finalResult} />
          )}
        </Section>
      )}

      {detailRecord && (
        <DetailDrawer
          record={results.find((r) => r.id === detailRecord.id) ?? detailRecord}
          onClose={() => setDetailRecord(null)}
          onReview={handleReview}
          onFollowUp={(action) => onFollowUp?.(action, [detailRecord.id])}
        />
      )}
    </div>
  );
}
