import { TaskStatus } from "@/types";

const STAGES: { key: TaskStatus; label: string }[] = [
  { key: "analyzing", label: "Analyzing" },
  { key: "routing", label: "Routing" },
  { key: "executing", label: "Executing" },
  { key: "evaluating", label: "Evaluating" },
  { key: "completed", label: "Completed" },
];

export function StatusStepper({ status }: { status: TaskStatus }) {
  const currentIndex = STAGES.findIndex((s) => s.key === status);
  const failed = status === "failed";

  return (
    <div className="flex items-center gap-1 overflow-x-auto scrollbar-thin sm:gap-2">
      {STAGES.map((stage, index) => {
        const isDone = !failed && currentIndex > index;
        const isActive = !failed && currentIndex === index;
        const isFailedHere = failed && index === STAGES.length - 1;

        return (
          <div key={stage.key} className="flex items-center gap-1 sm:gap-2">
            <div
              className={`flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-[11px] font-medium transition sm:text-xs ${
                isActive
                  ? "border-accent bg-accent-soft text-accent-strong"
                  : isDone
                    ? "border-good/30 bg-good-soft text-good"
                    : isFailedHere
                      ? "border-bad/30 bg-bad-soft text-bad"
                      : "border-border text-muted-dim"
              }`}
            >
              {isActive && (
                <span className="h-1.5 w-1.5 animate-pulse-dot rounded-full bg-accent-strong" />
              )}
              {isDone && <span>✓</span>}
              {stage.label}
            </div>
            {index < STAGES.length - 1 && (
              <div
                className={`h-px w-3 sm:w-6 ${
                  isDone ? "bg-good/40" : "bg-border"
                }`}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
