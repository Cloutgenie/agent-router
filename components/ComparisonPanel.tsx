import { StrategyComparison } from "@/types";

function StrategyCard({ label, run }: { label: string; run: StrategyComparison["single"] }) {
  return (
    <div className="card p-4">
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-dim">{label}</div>
      <div className="text-[11px] text-muted-dim">{run.providerNames.join(", ") || "No providers used"}</div>
      <dl className="mt-3 space-y-1.5 text-[13px]">
        <Row label="Quality" value={String(run.quality)} />
        <Row label="Evidence coverage" value={`${Math.round(run.evidenceCoverage * 100)}%`} />
        <Row label="Verified claims" value={`${Math.round(run.verifiedClaimRate * 100)}%`} />
        <Row label="Cost" value={`$${run.totalCost.toFixed(2)}`} />
        <Row label="Latency" value={`${run.totalLatency}s`} />
        <Row label="Results" value={String(run.resultCount)} />
        <Row label="Failed steps" value={String(run.failedCount)} />
      </dl>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <dt className="text-muted">{label}</dt>
      <dd className="font-mono text-foreground">{value}</dd>
    </div>
  );
}

function DeltaLine({ label, delta, isPercent = true }: { label: string; delta: number; isPercent?: boolean }) {
  const positive = delta > 0;
  const sign = positive ? "+" : "";
  return (
    <div className={`flex items-center justify-between rounded-lg px-3 py-1.5 text-[13px] ${positive ? "bg-good-soft" : delta < 0 ? "bg-bad-soft" : "bg-surface-raised"}`}>
      <span className="text-muted">{label}</span>
      <span className={`font-mono font-semibold ${positive ? "text-good" : delta < 0 ? "text-bad" : "text-muted"}`}>
        {sign}
        {isPercent ? Math.round(delta * 100) : delta}
        {isPercent ? "%" : ""}
      </span>
    </div>
  );
}

export function ComparisonPanel({ comparison }: { comparison: StrategyComparison }) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <StrategyCard label="Single provider" run={comparison.single} />
        <StrategyCard label="Multi-provider route" run={comparison.routed} />
      </div>
      <div className="card p-4">
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-dim">
          Routing improvement ({comparison.winner === "routed" ? "routed wins" : comparison.winner === "single" ? "single wins" : "tie"})
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <DeltaLine label="Quality" delta={comparison.qualityDelta} isPercent={false} />
          <DeltaLine label="Evidence coverage" delta={comparison.evidenceCoverageDelta} />
          <DeltaLine label="Verified claims" delta={comparison.verifiedClaimRateDelta} />
          <DeltaLine label="Failed rate" delta={comparison.failedRateDelta} />
        </div>
      </div>
    </div>
  );
}
