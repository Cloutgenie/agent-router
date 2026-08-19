import Link from "next/link";
import { Task } from "@/types";

export function TaskLineage({ lineage, currentId }: { lineage: Task[]; currentId: string }) {
  if (lineage.length <= 1) return null;

  return (
    <div className="card p-4">
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-dim">Task lineage</div>
      <div className="flex flex-wrap items-center gap-2 text-[13px]">
        {lineage.map((task, i) => (
          <span key={task.id} className="flex items-center gap-2">
            {i > 0 && <span className="text-muted-dim">→</span>}
            {task.id === currentId ? (
              <span className="rounded-full bg-accent-soft px-2.5 py-1 font-medium text-accent-strong">
                {task.followUpAction ? followUpLabel(task.followUpAction) : "Buyer search"}
              </span>
            ) : (
              <Link
                href={`/tasks/${task.id}`}
                className="rounded-full border border-border px-2.5 py-1 text-muted transition hover:border-accent/50 hover:text-foreground"
              >
                {task.followUpAction ? followUpLabel(task.followUpAction) : "Buyer search"}
              </Link>
            )}
          </span>
        ))}
      </div>
    </div>
  );
}

function followUpLabel(action: Task["followUpAction"]): string {
  switch (action) {
    case "find-decision-makers":
      return "Decision maker enrichment";
    case "enrich-contacts":
      return "Contact enrichment";
    case "verify-emails":
      return "Email verification";
    case "deeper-research":
      return "Deeper research";
    default:
      return "Follow-up";
  }
}
