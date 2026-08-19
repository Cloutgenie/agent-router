import Link from "next/link";
import { HistoryTable } from "@/components/HistoryTable";
import { listHistory } from "@/lib/history/store";

export const dynamic = "force-dynamic";

export default async function HistoryPage() {
  const history = await listHistory();

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-14">
      <div className="mb-6 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Task history</h1>
          <p className="mt-1 text-sm text-muted">
            Every routed task, the agents it picked, and how it scored - the record that makes
            future routing decisions smarter.
          </p>
        </div>
        <Link
          href="/"
          className="shrink-0 rounded-lg border border-border px-3.5 py-2 text-sm font-medium text-foreground transition hover:bg-surface-raised"
        >
          + New task
        </Link>
      </div>

      <div className="card p-4 sm:p-5">
        <HistoryTable history={history} />
      </div>
    </div>
  );
}
