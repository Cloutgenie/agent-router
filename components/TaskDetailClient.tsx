"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { TaskResultView } from "./TaskResultView";
import { streamNdjson } from "@/lib/clientStream";
import type { PipelineEvent } from "@/lib/pipeline";
import { FollowUpAction, ReviewState, Task } from "@/types";

export function TaskDetailClient({ task }: { task: Task }) {
  const [followUpBusy, setFollowUpBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const handleFollowUp = useCallback(
    async (action: FollowUpAction, selectedIds: string[]) => {
      if (selectedIds.length === 0) return;
      setFollowUpBusy(true);
      setError(null);
      try {
        let newTaskId: string | null = null;
        await streamNdjson<PipelineEvent>(`/api/tasks/${task.id}/follow-up`, { action, companyIds: selectedIds }, (event) => {
          if (event.type === "final") newTaskId = event.data.id;
        });
        if (newTaskId) router.push(`/tasks/${newTaskId}`);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Follow-up failed");
      } finally {
        setFollowUpBusy(false);
      }
    },
    [task.id, router]
  );

  const handleReview = useCallback(
    async (id: string, reviewState: ReviewState) => {
      await fetch(`/api/tasks/${task.id}/feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId: id, reviewState }),
      }).catch(() => undefined);
    },
    [task.id]
  );

  return (
    <TaskResultView
      status={task.status}
      workflow={task.workflow}
      capabilities={task.inferred_capabilities}
      plan={task.plan}
      buyerResults={task.buyer_results}
      excludedResults={task.excluded_results}
      finalResult={task.final_result}
      evaluationSummary={task.evaluation_summary}
      trace={task.execution_trace}
      comparison={task.comparison}
      budgetOutcome={task.budget_outcome}
      error={error}
      onFollowUp={handleFollowUp}
      onReview={handleReview}
      followUpBusy={followUpBusy}
    />
  );
}
