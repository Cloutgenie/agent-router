"use client";

export const EXAMPLE_TASKS = [
  "Find 20 cybersecurity startups that recently raised funding and appear likely to need AI security help.",
  "Find 50 Series A cybersecurity companies that recently raised funding and are hiring security leaders.",
  "Research 20 competitors for a B2B SaaS product.",
  "Find decision-makers at 100 healthcare software companies.",
  "Identify companies showing strong security buying signals.",
];

export function ExampleTasks({ onSelect, disabled }: { onSelect: (task: string) => void; disabled?: boolean }) {
  return (
    <div className="flex flex-wrap gap-2">
      {EXAMPLE_TASKS.map((task) => (
        <button
          key={task}
          type="button"
          disabled={disabled}
          onClick={() => onSelect(task)}
          className="rounded-full border border-border bg-surface px-3 py-1.5 text-left text-xs text-muted transition hover:border-accent/50 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
        >
          {task.length > 64 ? `${task.slice(0, 61)}...` : task}
        </button>
      ))}
    </div>
  );
}
