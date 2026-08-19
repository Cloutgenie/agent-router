import { ExecutionPolicy, RiskClass } from "@/types";

const RISK_CLASS_ORDER: RiskClass[] = ["READ_ONLY", "LOW_RISK_WRITE", "EXTERNAL_COMMUNICATION", "HIGH_RISK_WRITE", "FINANCIAL"];

const RISK_CLASS_LABEL: Record<RiskClass, string> = {
  READ_ONLY: "Read-only",
  LOW_RISK_WRITE: "Low-risk write",
  EXTERNAL_COMMUNICATION: "External communication",
  HIGH_RISK_WRITE: "High-risk write",
  FINANCIAL: "Financial",
};

const RISK_CLASS_STYLE: Record<RiskClass, string> = {
  READ_ONLY: "border-good/30 bg-good-soft text-good",
  LOW_RISK_WRITE: "border-warn/30 bg-warn-soft text-warn",
  EXTERNAL_COMMUNICATION: "border-warn/40 bg-warn-soft text-warn",
  HIGH_RISK_WRITE: "border-bad/30 bg-bad-soft text-bad",
  FINANCIAL: "border-bad/40 bg-bad-soft text-bad",
};

export function ExecutionPolicyCard({ policies }: { policies: ExecutionPolicy[] }) {
  return (
    <div className="card p-4 sm:p-5">
      <div className="mb-1 text-lg font-semibold text-foreground">Execution policy</div>
      <p className="mb-4 text-sm text-muted">
        Every capability carries a risk class. Anything above read-only requires the task to explicitly pre-approve
        it (&quot;Pre-approve actions&quot; in Execute&apos;s advanced options) - otherwise the router blocks the
        step before it ever reaches a provider.
      </p>
      <div className="space-y-3">
        {RISK_CLASS_ORDER.map((riskClass) => {
          const inClass = policies.filter((p) => p.riskClass === riskClass);
          if (inClass.length === 0) return null;
          return (
            <div key={riskClass}>
              <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${RISK_CLASS_STYLE[riskClass]}`}>
                {RISK_CLASS_LABEL[riskClass]}
              </span>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {inClass.map((p) => (
                  <span
                    key={p.capability}
                    className="rounded-full border border-border bg-surface px-2 py-0.5 text-[11px] text-muted"
                  >
                    {p.capability.replace(/-/g, " ")}
                  </span>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
