import { AgentProvider, Evidence, ProviderResult, ProviderTask } from "@/types";
import { jitter, makeEvidence, round2, sleep } from "../shared";

interface DiscoveredCompany {
  name: string;
  website: string;
}

interface ByCompanyMap {
  [company: string]: { evidence?: Evidence[] };
}

/**
 * Cross-checks upstream provider output for internal consistency before the
 * Evaluator runs its own independent verification pass. This provider is
 * still just "a provider" - it produces evidence, it does not decide
 * pass/fail for the final record. That judgment belongs to
 * lib/evaluation/verifier.ts, which never blindly trusts this output either.
 */
function runCrossCheck(task: ProviderTask): { data: Record<string, unknown>; evidence: Evidence[] } {
  const companies = (task.context.companies as DiscoveredCompany[] | undefined) ?? [];
  const fundingByCompany = (task.context.fundingByCompany as ByCompanyMap | undefined) ?? {};
  const hiringByCompany = (task.context.hiringByCompany as ByCompanyMap | undefined) ?? {};
  const aiByCompany = (task.context.aiByCompany as ByCompanyMap | undefined) ?? {};
  const contactByCompany = (task.context.contactByCompany as ByCompanyMap | undefined) ?? {};

  const byCompany: Record<string, { signalsCovered: number; notes: string; evidence: Evidence[] }> = {};
  const evidence: Evidence[] = [];

  for (const company of companies) {
    const signals = [
      fundingByCompany[company.name],
      hiringByCompany[company.name],
      aiByCompany[company.name],
      contactByCompany[company.name],
    ].filter(Boolean);

    const notes =
      signals.length >= 3
        ? "Cross-checked signals agree across independent sources."
        : signals.length > 0
          ? "Partial signal coverage - some claims could not be cross-checked."
          : "No independent signals available to cross-check.";

    const item = makeEvidence({
      type: "provider_output",
      title: `Cross-check - ${company.name}`,
      source: "Verification Agent",
      excerpt: `${signals.length} of 4 upstream signals present. ${notes}`,
      confidence: round2(Math.min(0.95, 0.4 + signals.length * 0.14)),
      ageDays: 0,
    });

    byCompany[company.name] = { signalsCovered: signals.length, notes, evidence: [item] };
    evidence.push(item);
  }

  return { data: { byCompany }, evidence };
}

export const MockVerificationProvider: AgentProvider = {
  id: "verification-agent",
  name: "Verification Agent",
  description: "Cross-checks upstream provider claims against each other before evaluation.",
  capabilities: ["data-validation"],
  protocol: "mock",
  quality_score: 0.93,
  reliability_score: 0.96,
  success_rate: 0.97,
  price_per_task: 0.7,
  average_latency_seconds: 2.5,
  configured: true,

  async execute(task: ProviderTask): Promise<ProviderResult> {
    const simulatedSeconds = Math.max(0.5, jitter(this.average_latency_seconds, 0.6));
    await sleep(Math.min(simulatedSeconds * 300, 1800));

    if (Math.random() > this.success_rate) {
      return {
        status: "failed",
        data: {},
        evidence: [],
        confidence: 0,
        cost: round2(this.price_per_task * 0.4),
        duration_seconds: round2(simulatedSeconds),
        error: `${this.name} could not complete cross-checking (simulated failure).`,
      };
    }

    let data: Record<string, unknown>;
    let evidence: Evidence[];

    if (task.context.companies) {
      const result = runCrossCheck(task);
      data = result.data;
      evidence = result.evidence;
    } else {
      data = { records_validated: task.resultCount, accuracy_rate: round2(jitter(0.94, 0.03)) };
      evidence = [
        makeEvidence({
          type: "provider_output",
          title: `${this.name} findings`,
          source: this.name,
          confidence: round2(jitter(this.quality_score, 0.05)),
        }),
      ];
    }

    return {
      status: "completed",
      data,
      evidence,
      confidence: round2(Math.min(0.99, Math.max(0.5, jitter(this.quality_score, 0.05)))),
      cost: this.price_per_task,
      duration_seconds: round2(simulatedSeconds),
    };
  },

  async healthCheck() {
    await sleep(30);
    return true;
  },
};
