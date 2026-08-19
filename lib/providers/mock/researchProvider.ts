import { findDemoCompany, sampleDemoCompanies } from "@/data/demo-companies";
import { canonicalizeCompanies } from "@/lib/dedup";
import { AgentProvider, Capability, Evidence, ProviderResult, ProviderTask } from "@/types";
import { jitter, makeEvidence, pick, round2, sleep } from "../shared";

const SAMPLE_COMPANY_NAMES = [
  "Nimbus Shield",
  "Redgate Security",
  "Vantage Point Labs",
  "Cipherline",
  "Northbeam Analytics",
];

interface DiscoveredCompany {
  name: string;
  website: string;
  industry: string;
}

function isDiscoveryTask(task: ProviderTask): boolean {
  return task.capability === "company-research" && !task.context.companies;
}

function runDiscovery(task: ProviderTask): { data: Record<string, unknown>; evidence: Evidence[] } {
  const pool = sampleDemoCompanies(Math.min(task.resultCount + 6, 24));
  // Canonicalize/dedupe (V4 #26-27) - a no-op today since the demo pool has
  // unique names, but this is the same merge path a live multi-provider
  // discovery run (which *will* return duplicates) goes through.
  const deduped = canonicalizeCompanies(pool.map((demo) => ({ name: demo.name, website: demo.website, demo })));

  const companies: DiscoveredCompany[] = [];
  const byCompany: Record<string, { website: string; industry: string; evidence: Evidence[] }> = {};
  const evidence: Evidence[] = [];

  for (const { canonical, sources } of deduped) {
    const demo = sources[0].demo;
    companies.push({ name: canonical.name, website: canonical.website ?? demo.website, industry: demo.industry });
    const websiteEvidence = makeEvidence({
      type: "website",
      title: `${demo.name} company site`,
      source: demo.website,
      url: `https://${demo.website}`,
      excerpt: `${demo.name} operates in ${demo.industry}.`,
      confidence: round2(jitter(0.9, 0.05)),
      ageDays: 2,
    });
    byCompany[demo.name] = { website: demo.website, industry: demo.industry, evidence: [websiteEvidence] };
    evidence.push(websiteEvidence);
  }

  return { data: { companies, byCompany }, evidence };
}

function runAiSignal(task: ProviderTask): { data: Record<string, unknown>; evidence: Evidence[] } {
  const companies = (task.context.companies as DiscoveredCompany[] | undefined) ?? [];
  const byCompany: Record<string, { aiSignal: string; evidence: Evidence[] }> = {};
  const evidence: Evidence[] = [];

  for (const company of companies) {
    const demo = findDemoCompany(company.name);
    if (!demo) continue;
    const confidence = round2(Math.min(0.98, Math.max(0.35, jitter(demo.signalStrength, 0.08))));
    const item = makeEvidence({
      type: "news",
      title: `AI signal - ${company.name}`,
      source: `${company.website}/product-updates`,
      url: `https://${company.website}/product-updates`,
      excerpt: demo.aiSignal,
      confidence,
      ageDays: demo.aiAgeDays,
    });
    byCompany[company.name] = { aiSignal: demo.aiSignal, evidence: [item] };
    evidence.push(item);
  }

  return { data: { byCompany }, evidence };
}

function genericPayload(capability: Capability, task: ProviderTask): Record<string, unknown> {
  const volumeHint = task.goal.match(/\d+/)?.[0];
  const targetCount = volumeHint ? Math.min(Number(volumeHint), 200) : task.resultCount;

  switch (capability) {
    case "company-research":
      return {
        companies_found: targetCount,
        sample_companies: Array.from({ length: 5 }, () => pick(SAMPLE_COMPANY_NAMES)),
      };
    case "web-research":
      return {
        sources_reviewed: Math.round(jitter(40, 15)),
        pages_indexed: Math.round(jitter(120, 40)),
      };
    case "summarization":
      return { summary_word_count: Math.round(jitter(180, 40)) };
    case "competitor-analysis":
      return {
        competitors_identified: Math.round(jitter(Math.max(targetCount, 8), 3)),
        positioning_gaps_found: Math.round(jitter(3, 1)),
      };
    case "market-research":
      return {
        market_size_estimate_usd: Math.round(jitter(2_500_000_000, 800_000_000)),
        trends_identified: Math.round(jitter(4, 1)),
      };
    case "cybersecurity-research":
      return {
        vendors_profiled: Math.round(jitter(targetCount * 0.4, 4)),
        security_focus_confirmed_pct: round2(jitter(0.82, 0.08)),
      };
    case "ai-adoption-signal":
      return {
        ai_products_identified: Math.round(jitter(targetCount * 0.3, 3)),
        ai_adoption_confidence: round2(jitter(0.75, 0.1)),
      };
    default:
      return {};
  }
}

export const MockResearchProvider: AgentProvider = {
  id: "research-agent",
  name: "Research Agent",
  description: "General-purpose company and market research - discovery, competitive landscapes, AI signal detection.",
  capabilities: [
    "company-research",
    "web-research",
    "summarization",
    "competitor-analysis",
    "market-research",
    "cybersecurity-research",
    "ai-adoption-signal",
  ],
  protocol: "mock",
  quality_score: 0.86,
  reliability_score: 0.92,
  success_rate: 0.94,
  price_per_task: 0.9,
  average_latency_seconds: 3.5,
  configured: true,

  async execute(task: ProviderTask): Promise<ProviderResult> {
    const simulatedSeconds = Math.max(0.6, jitter(this.average_latency_seconds, 1));
    await sleep(Math.min(simulatedSeconds * 300, 2200));

    if (Math.random() > this.success_rate) {
      return failResult(this, simulatedSeconds);
    }

    let data: Record<string, unknown>;
    let evidence: Evidence[];

    if (isDiscoveryTask(task)) {
      const result = runDiscovery(task);
      data = result.data;
      evidence = result.evidence;
    } else if (task.capability === "ai-adoption-signal" && task.context.companies) {
      const result = runAiSignal(task);
      data = result.data;
      evidence = result.evidence;
    } else {
      data = genericPayload(task.capability, task);
      evidence = [
        makeEvidence({
          type: "provider_output",
          title: `${this.name} findings for "${task.capability.replace(/-/g, " ")}"`,
          source: this.name,
          confidence: round2(jitter(this.quality_score, 0.05)),
        }),
      ];
    }

    const confidence = round2(Math.min(0.99, Math.max(0.5, jitter(this.quality_score, 0.06))));

    return {
      status: "completed",
      data,
      evidence,
      confidence,
      cost: this.price_per_task,
      duration_seconds: round2(simulatedSeconds),
    };
  },

  async healthCheck() {
    await sleep(30);
    return true;
  },
};

function failResult(provider: AgentProvider, simulatedSeconds: number): ProviderResult {
  return {
    status: "failed",
    data: {},
    evidence: [],
    confidence: 0,
    cost: round2(provider.price_per_task * 0.4),
    duration_seconds: round2(simulatedSeconds),
    error: `${provider.name} could not complete the assignment (simulated failure).`,
  };
}

export { failResult };
