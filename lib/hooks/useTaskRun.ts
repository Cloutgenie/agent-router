"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { streamNdjson } from "@/lib/clientStream";
import type { PipelineEvent } from "@/lib/pipeline";
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
  TaskConstraints,
  TaskEconomics,
  TaskStatus,
  TraceEvent,
  WorkflowType,
} from "@/types";

export interface RunState {
  taskId: string | null;
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
  error: string | null;
}

const INITIAL_STATE: RunState = {
  taskId: null,
  status: "planning",
  capabilities: [],
  plan: null,
  buyerResults: [],
  excludedResults: [],
  evaluationSummary: null,
  trace: [],
  error: null,
};

function applyEvent(prev: RunState, event: PipelineEvent): RunState {
  switch (event.type) {
    case "trace":
      return { ...prev, trace: [...prev.trace, event.event] };
    case "capabilities":
      return { ...prev, capabilities: event.data, status: "planning" };
    case "plan":
      return { ...prev, plan: event.data, status: "routing" };
    case "step": {
      if (!prev.plan) return prev;
      const steps = prev.plan.steps.map((s) => (s.id === event.data.id ? event.data : s));
      return { ...prev, plan: { ...prev.plan, steps }, status: "executing" };
    }
    case "final":
      return {
        ...prev,
        taskId: event.data.id,
        status: event.data.status,
        workflow: event.data.workflow,
        buyerResults: event.data.buyer_results,
        excludedResults: event.data.excluded_results,
        finalResult: event.data.final_result,
        evaluationSummary: event.data.evaluation_summary,
        comparison: event.data.comparison,
        budgetOutcome: event.data.budget_outcome,
        economics: event.data.economics,
      };
    case "error":
      return { ...prev, error: event.message };
    default:
      return prev;
  }
}

/**
 * Shared streaming-run state machine behind every "run the pipeline and
 * watch it live" screen (Execute, Live Test). Kept as one hook so the two
 * screens can never drift on how NDJSON events get applied to UI state.
 */
export function useTaskRun() {
  const [isRunning, setIsRunning] = useState(false);
  const [followUpBusy, setFollowUpBusy] = useState(false);
  const [run, setRun] = useState<RunState | null>(null);
  const router = useRouter();

  const runTask = useCallback(async (rawTask: string, constraints: TaskConstraints) => {
    setIsRunning(true);
    setRun({ ...INITIAL_STATE });

    try {
      await streamNdjson<PipelineEvent>("/api/tasks", { raw_task: rawTask, ...constraints }, (event) => {
        setRun((prev) => applyEvent(prev ?? INITIAL_STATE, event));
      });
    } catch (err) {
      setRun((prev) => ({ ...(prev ?? INITIAL_STATE), error: err instanceof Error ? err.message : "Something went wrong" }));
    } finally {
      setIsRunning(false);
    }
  }, []);

  const handleFollowUp = useCallback(
    async (action: FollowUpAction, selectedIds: string[]) => {
      if (!run?.taskId || selectedIds.length === 0) return;
      setFollowUpBusy(true);
      try {
        let newTaskId: string | null = null;
        await streamNdjson<PipelineEvent>(`/api/tasks/${run.taskId}/follow-up`, { action, companyIds: selectedIds }, (event) => {
          if (event.type === "final") newTaskId = event.data.id;
        });
        if (newTaskId) router.push(`/tasks/${newTaskId}`);
      } catch (err) {
        setRun((prev) => (prev ? { ...prev, error: err instanceof Error ? err.message : "Follow-up failed" } : prev));
      } finally {
        setFollowUpBusy(false);
      }
    },
    [run?.taskId, router]
  );

  const handleReview = useCallback(
    async (id: string, reviewState: ReviewState) => {
      if (!run?.taskId) return;
      await fetch(`/api/tasks/${run.taskId}/feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId: id, reviewState }),
      }).catch(() => undefined);
    },
    [run?.taskId]
  );

  return { run, isRunning, followUpBusy, runTask, handleFollowUp, handleReview };
}
