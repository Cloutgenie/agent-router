"use client";

import { useRef, useState } from "react";
import { ExampleTasks } from "@/components/ExampleTasks";
import { ModeBadge } from "@/components/ModeBadge";
import { TaskForm } from "@/components/TaskForm";
import { TaskResultView } from "@/components/TaskResultView";
import { useTaskRun } from "@/lib/hooks/useTaskRun";
import { TaskConstraints } from "@/types";

export default function Home() {
  const [rawTask, setRawTask] = useState("");
  const { run, isRunning, followUpBusy, runTask, handleFollowUp, handleReview } = useTaskRun();
  const resultsRef = useRef<HTMLDivElement>(null);

  const handleSubmit = async (constraints: TaskConstraints) => {
    requestAnimationFrame(() => resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
    await runTask(rawTask, constraints);
  };

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 sm:py-14">
      <div className="mb-8 text-center sm:mb-10">
        <div className="mb-3 flex justify-center">
          <ModeBadge />
        </div>
        <h1 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
          Tell us the outcome. <span className="text-accent-strong">We route the work.</span>
        </h1>
        <p className="mx-auto mt-3 max-w-xl text-[15px] text-muted">
          You don&apos;t choose an AI agent. You choose an outcome - the execution network chooses the machines.
        </p>
      </div>

      <TaskForm rawTask={rawTask} onRawTaskChange={setRawTask} onSubmit={handleSubmit} isRunning={isRunning} />

      <div className="mt-4">
        <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-dim">Or try an example</p>
        <ExampleTasks onSelect={setRawTask} disabled={isRunning} />
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
