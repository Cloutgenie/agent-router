import Link from "next/link";
import { ComparisonPanel } from "@/components/ComparisonPanel";
import { listExperiments } from "@/lib/history/store";

export const dynamic = "force-dynamic";

function DeltaTile({ label, value, isPercent = true }: { label: string; value: number; isPercent?: boolean }) {
  const positive = value > 0;
  return (
    <div className="card p-3">
      <div className="text-[11px] uppercase tracking-wide text-muted-dim">{label}</div>
      <div className={`mt-1 text-xl font-semibold ${positive ? "text-good" : value < 0 ? "text-bad" : "text-foreground"}`}>
        {positive ? "+" : ""}
        {isPercent ? Math.round(value * 100) : value}
        {isPercent ? "%" : ""}
      </div>
    </div>
  );
}

export default async function ExperimentsPage() {
  const experiments = await listExperiments();

  const advantage =
    experiments.length > 0
      ? {
          quality: avg(experiments.map((e) => e.comparison.qualityDelta)),
          evidenceCoverage: avg(experiments.map((e) => e.comparison.evidenceCoverageDelta)),
          verifiedClaimRate: avg(experiments.map((e) => e.comparison.verifiedClaimRateDelta)),
          failedRate: avg(experiments.map((e) => e.comparison.failedRateDelta)),
        }
      : null;

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 sm:py-14">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Routing experiments</h1>
        <p className="mt-1 text-sm text-muted">
          Every task run with &quot;Compare routing strategy&quot; on pits a single-provider baseline against the
          routed multi-provider execution. This is the evidence behind the product thesis.
        </p>
      </div>

      {advantage ? (
        <div className="mb-8 card-raised p-5">
          <div className="mb-3 text-sm font-semibold text-foreground">Routing Advantage</div>
          <p className="mb-3 text-xs text-muted-dim">Average improvement of routed execution over a single provider, across {experiments.length} experiment{experiments.length === 1 ? "" : "s"}.</p>
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            <DeltaTile label="Quality" value={advantage.quality} isPercent={false} />
            <DeltaTile label="Evidence coverage" value={advantage.evidenceCoverage} />
            <DeltaTile label="Verified claims" value={advantage.verifiedClaimRate} />
            <DeltaTile label="Failed records" value={-advantage.failedRate} />
          </div>
        </div>
      ) : (
        <div className="card mb-8 p-6 text-center text-sm text-muted-dim">
          No experiments yet. Enable &quot;Compare routing strategy&quot; in advanced options on{" "}
          <Link href="/" className="text-accent-strong hover:underline">
            Execute
          </Link>{" "}
          to run one.
        </div>
      )}

      <div className="space-y-6">
        {experiments.map((exp) => (
          <div key={exp.id} className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <Link href={`/tasks/${exp.taskId}`} className="text-sm font-medium text-foreground hover:text-accent-strong hover:underline">
                {exp.raw_task}
              </Link>
              <span className="text-[11px] text-muted-dim">{new Date(exp.createdAt).toLocaleString()}</span>
            </div>
            <ComparisonPanel comparison={exp.comparison} />
          </div>
        ))}
      </div>
    </div>
  );
}

function avg(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((s, v) => s + v, 0) / values.length;
}
