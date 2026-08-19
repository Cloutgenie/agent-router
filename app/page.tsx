"use client";

import { useCallback, useRef, useState } from "react";
import { TaskForm } from "@/components/TaskForm";
import { ExampleTasks } from "@/components/ExampleTasks";
import { CapabilityBadges } from "@/components/CapabilityBadges";
import { StatusStepper } from "@/components/StatusStepper";
import { CandidateTable } from "@/components/CandidateTable";
import { RoutingPlanCard } from "@/components/RoutingPlanCard";
import { ExecutionGrid, TraceLog } from "@/components/ExecutionTimeline";
import { FinalResultCard } from "@/components/FinalResultCard";
import type { PipelineEvent } from "@/lib/pipeline";
import {
  AgentExecution,
  Capability,
  Evaluation,
  RoutingCandidate,
  RoutingPlan,
  Task,
  TaskConstraints,
  TaskStatus,
  TraceEvent,
} from "@/types";

interface RunState {
  status: TaskStatus | "idle";
  capabilities: Capability[];
  candidates: RoutingCandidate[];
  plan: RoutingPlan | null;
  executions: AgentExecution[];
  evaluation: Evaluation | null;
  finalTask: Task | null;
  trace: TraceEvent[];
  error: string | null;
}

const INITIAL_STATE: RunState = {
  status: "idle",
  capabilities: [],
  candidates: [],
  plan: null,
  executions: [],
  evaluation: null,
  finalTask: null,
  trace: [],
  error: null,
};

async function streamTaskRun(
  rawTask: string,
  constraints: TaskConstraints,
  onEvent: (event: PipelineEvent) => void
) {
  const response = await fetch("/api/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ raw_task: rawTask, ...constraints }),
  });

  if (!response.ok || !response.body) {
    const body = await response.json().catch(() => ({ error: "Request failed" }));
    throw new Error(body.error ?? "Request failed");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      onEvent(JSON.parse(line) as PipelineEvent);
    }
  }
  if (buffer.trim()) {
    onEvent(JSON.parse(buffer) as PipelineEvent);
  }
}

export default function Home() {
  const [rawTask, setRawTask] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const [run, setRun] = useState<RunState>(INITIAL_STATE);
  const resultsRef = useRef<HTMLDivElement>(null);

  const handleSubmit = useCallback(
    async (constraints: TaskConstraints) => {
      setIsRunning(true);
      setRun({ ...INITIAL_STATE, status: "analyzing" });
      requestAnimationFrame(() =>
        resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
      );

      try {
        await streamTaskRun(rawTask, constraints, (event) => {
          setRun((prev) => {
            switch (event.type) {
              case "trace":
                return { ...prev, trace: [...prev.trace, event.event] };
              case "capabilities":
                return { ...prev, capabilities: event.data, status: "analyzing" };
              case "candidates":
                return { ...prev, candidates: event.data, status: "routing" };
              case "plan":
                return { ...prev, plan: event.data, status: "routing" };
              case "execution":
                return {
                  ...prev,
                  executions: [...prev.executions, event.data],
                  status: "executing",
                };
              case "evaluation":
                return { ...prev, evaluation: event.data, status: "evaluating" };
              case "final":
                return { ...prev, finalTask: event.data, status: event.data.status };
              case "error":
                return { ...prev, error: event.message };
              default:
                return prev;
            }
          });
        });
      } catch (err) {
        setRun((prev) => ({
          ...prev,
          error: err instanceof Error ? err.message : "Something went wrong",
        }));
      } finally {
        setIsRunning(false);
      }
    },
    [rawTask]
  );

  const handleExampleSelect = useCallback((task: string) => {
    setRawTask(task);
  }, []);

  const showResults = run.status !== "idle";

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6 sm:py-14">
      <div className="mb-8 text-center sm:mb-10">
        <div className="mb-3 inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1 text-[11px] font-medium text-muted">
          <span className="h-1.5 w-1.5 rounded-full bg-good" />
          OpenRouter, for agents
        </div>
        <h1 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
          Describe the outcome. <span className="text-accent-strong">We&apos;ll route it.</span>
        </h1>
        <p className="mx-auto mt-3 max-w-xl text-[15px] text-muted">
          You don&apos;t choose an AI agent. You choose an outcome - the network chooses the
          machines.
        </p>
      </div>

      <TaskForm
        rawTask={rawTask}
        onRawTaskChange={setRawTask}
        onSubmit={handleSubmit}
        isRunning={isRunning}
      />

      <div className="mt-4">
        <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-dim">
          Or try an example
        </p>
        <ExampleTasks onSelect={handleExampleSelect} disabled={isRunning} />
      </div>

      {showResults && (
        <div ref={resultsRef} className="mt-10 space-y-8 scroll-mt-20">
          <div className="card p-4">
            <StatusStepper status={run.status === "idle" ? "analyzing" : run.status} />
          </div>

          {run.error && (
            <div className="rounded-lg border border-bad/30 bg-bad-soft p-4 text-sm text-bad">
              {run.error}
            </div>
          )}

          {run.capabilities.length > 0 && (
            <Section title="1 · Capabilities inferred" subtitle="Deterministic keyword classifier">
              <CapabilityBadges capabilities={run.capabilities} />
            </Section>
          )}

          {run.candidates.length > 0 && (
            <Section
              title="2 · Agent market evaluated"
              subtitle={`${run.candidates.length} eligible agents scored transparently`}
            >
              <CandidateTable candidates={run.candidates} />
            </Section>
          )}

          {run.plan && (
            <Section title="3 · Routing decision" subtitle="Why this agent (or team) won">
              <RoutingPlanCard plan={run.plan} />
            </Section>
          )}

          {run.plan && (
            <Section title="4 · Execution" subtitle="Simulated agent runs, streamed live">
              <ExecutionGrid team={run.plan.team} executions={run.executions} />
            </Section>
          )}

          {run.trace.length > 0 && <TraceLog trace={run.trace} />}

          {run.evaluation && run.finalTask?.final_result && run.plan && (
            <Section title="5 · Final result" subtitle="Evaluated outcome">
              <FinalResultCard
                result={run.finalTask.final_result}
                evaluation={run.evaluation}
                plan={run.plan}
              />
            </Section>
          )}
        </div>
      )}
    </div>
  );
}

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
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
