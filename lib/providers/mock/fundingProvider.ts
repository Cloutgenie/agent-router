import { findDemoCompany } from "@/data/demo-companies";
import { AgentProvider, Capability, Evidence, ProviderResult, ProviderTask } from "@/types";
import { jitter, makeEvidence, round2, sleep } from "../shared";

interface DiscoveredCompany {
  name: string;
  website: string;
}

function runFundingByCompany(task: ProviderTask): { data: Record<string, unknown>; evidence: Evidence[] } {
  const companies = (task.context.companies as DiscoveredCompany[] | undefined) ?? [];
  const byCompany: Record<string, { fundingStage: string; fundingSignal: string; evidence: Evidence[] }> = {};
  const evidence: Evidence[] = [];

  for (const company of companies) {
    const demo = findDemoCompany(company.name);
    if (!demo) continue;
    const confidence = round2(Math.min(0.98, Math.max(0.4, jitter(demo.signalStrength, 0.06))));
    const primary = makeEvidence({
      type: "funding",
      title: `Funding record - ${company.name}`,
      source: "Funding Intelligence database",
      excerpt: demo.fundingSignal,
      confidence,
      ageDays: demo.fundingAgeDays,
      sourceQuality: "high",
      query: `${company.name} funding round`,
    });

    const companyEvidence = [primary];
    // ~40% of the time, a second independent source corroborates (or, ~half of
    // those, disagrees with) the primary claim - real verification needs
    // something to actually cross-check.
    if (Math.random() < 0.4) {
      const disagrees = Math.random() < 0.5;
      const secondAgeDays = disagrees
        ? demo.fundingAgeDays + 35 + Math.round(Math.random() * 25)
        : demo.fundingAgeDays + Math.round(jitter(0, 6));
      const secondary = makeEvidence({
        type: "news",
        title: `Funding coverage - ${company.name}`,
        source: "Industry press roundup",
        excerpt: disagrees
          ? `Press coverage lists the ${demo.fundingStage} round on a different date than the primary filing.`
          : `Independent press coverage corroborates the ${demo.fundingStage} round.`,
        confidence: round2(Math.min(0.95, Math.max(0.35, jitter(demo.signalStrength, 0.1)))),
        ageDays: Math.max(0, secondAgeDays),
        sourceQuality: "medium",
        query: `${company.name} funding news`,
      });
      companyEvidence.push(secondary);
    }

    byCompany[company.name] = {
      fundingStage: demo.fundingStage,
      fundingSignal: demo.fundingSignal,
      evidence: companyEvidence,
    };
    evidence.push(...companyEvidence);
  }

  return { data: { byCompany }, evidence };
}

function genericPayload(capability: Capability, targetCount: number): Record<string, unknown> {
  if (capability === "financial-research") {
    return {
      valuation_estimates_produced: Math.round(jitter(targetCount * 0.5, 4)),
      revenue_signals_found: Math.round(jitter(targetCount * 0.35, 3)),
    };
  }
  return {
    funding_rounds_identified: Math.round(jitter(targetCount * 0.6, 5)),
    total_funding_tracked_usd: Math.round(jitter(targetCount * 4_500_000, 2_000_000)),
  };
}

export const MockFundingProvider: AgentProvider = {
  id: "funding-intelligence",
  name: "Funding Intelligence",
  description: "Tracks funding rounds, cap tables, and investor activity with strong data validation.",
  capabilities: ["funding-research", "financial-research"],
  protocol: "mock",
  quality_score: 0.91,
  reliability_score: 0.95,
  success_rate: 0.94,
  price_per_task: 1.5,
  average_latency_seconds: 4.5,
  configured: true,

  async execute(task: ProviderTask): Promise<ProviderResult> {
    const simulatedSeconds = Math.max(0.6, jitter(this.average_latency_seconds, 1));
    await sleep(Math.min(simulatedSeconds * 300, 2200));

    if (Math.random() > this.success_rate) {
      return {
        status: "failed",
        data: {},
        evidence: [],
        confidence: 0,
        cost: round2(this.price_per_task * 0.4),
        duration_seconds: round2(simulatedSeconds),
        error: `${this.name} could not verify funding data in time (simulated failure).`,
      };
    }

    let data: Record<string, unknown>;
    let evidence: Evidence[];

    if (task.context.companies) {
      const result = runFundingByCompany(task);
      data = result.data;
      evidence = result.evidence;
    } else {
      const volumeHint = task.goal.match(/\d+/)?.[0];
      const targetCount = volumeHint ? Math.min(Number(volumeHint), 200) : task.resultCount;
      data = genericPayload(task.capability, targetCount);
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
      confidence: round2(Math.min(0.99, Math.max(0.5, jitter(this.quality_score, 0.06)))),
      cost: this.price_per_task,
      duration_seconds: round2(simulatedSeconds),
    };
  },

  async healthCheck() {
    await sleep(30);
    return true;
  },
};
