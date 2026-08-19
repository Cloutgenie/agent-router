import Link from "next/link";
import { notFound } from "next/navigation";
import { ModeBadge } from "@/components/ModeBadge";
import { TaskDetailClient } from "@/components/TaskDetailClient";
import { TaskLineage } from "@/components/TaskLineage";
import { getHistoryTask, getTaskLineage } from "@/lib/history/store";

export const dynamic = "force-dynamic";

export default async function TaskDetailPage({ params }: PageProps<"/tasks/[id]">) {
  const { id } = await params;
  const task = await getHistoryTask(id);
  if (!task) notFound();

  const lineage = await getTaskLineage(task.rootTaskId);

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 sm:py-14">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <ModeBadge />
          <h1 className="mt-2 text-xl font-semibold tracking-tight text-foreground">{task.raw_task}</h1>
          <p className="mt-1 text-xs text-muted-dim">
            {new Date(task.created_at).toLocaleString()} · trace{" "}
            <Link href={`/traces/${task.traceId}`} className="underline decoration-dotted hover:text-foreground">
              {task.traceId}
            </Link>
          </p>
        </div>
        <Link href="/" className="shrink-0 rounded-lg border border-border px-3.5 py-2 text-sm font-medium text-foreground transition hover:bg-surface-raised">
          + New task
        </Link>
      </div>

      <div className="mb-6">
        <TaskLineage lineage={lineage} currentId={task.id} />
      </div>

      <TaskDetailClient task={task} />
    </div>
  );
}
