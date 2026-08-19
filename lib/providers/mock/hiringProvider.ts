import { findDemoCompany } from "@/data/demo-companies";
import { AgentProvider, Evidence, ProviderResult, ProviderTask } from "@/types";
import { jitter, makeEvidence, pick, round2, sleep } from "../shared";

interface DiscoveredCompany {
  name: string;
  website: string;
}

const SAMPLE_ROLES = [
  "VP of Security",
  "CISO",
  "Head of Information Security",
  "Director of Security Engineering",
  "Chief Trust Officer",
];

function runHiringByCompany(task: ProviderTask): { data: Record<string, unknown>; evidence: Evidence[] } {
  const companies = (task.context.companies as DiscoveredCompany[] | undefined) ?? [];
  const byCompany: Record<
    string,
    { hiringSignal: string; securitySignal: string; evidence: Evidence[] }
  > = {};
  const evidence: Evidence[] = [];

  for (const company of companies) {
    const demo = findDemoCompany(company.name);
    if (!demo) continue;
    const confidence = round2(Math.min(0.98, Math.max(0.4, jitter(demo.signalStrength, 0.07))));
    const item = makeEvidence({
      type: "job_posting",
      title: `Open roles - ${company.name}`,
      source: `${company.website}/careers`,
      url: `https://${company.website}/careers`,
      excerpt: `${demo.hiringSignal}. ${demo.securitySignal}.`,
      confidence,
      ageDays: demo.hiringAgeDays,
    });
    byCompany[company.name] = {
      hiringSignal: demo.hiringSignal,
      securitySignal: demo.securitySignal,
      evidence: [item],
    };
    evidence.push(item);
  }

  return { data: { byCompany }, evidence };
}

export const MockHiringProvider: AgentProvider = {
  id: "signal-hunter",
  name: "Signal Hunter",
  description: "Detects hiring activity, headcount growth, and security-team buildout from job postings.",
  capabilities: ["hiring-signals", "lead-generation"],
  protocol: "mock",
  quality_score: 0.88,
  reliability_score: 0.93,
  success_rate: 0.95,
  price_per_task: 1.15,
  average_latency_seconds: 4.0,
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
        error: `${this.name} could not complete hiring signal detection (simulated failure).`,
      };
    }

    let data: Record<string, unknown>;
    let evidence: Evidence[];

    if (task.context.companies) {
      const result = runHiringByCompany(task);
      data = result.data;
      evidence = result.evidence;
    } else {
      const volumeHint = task.goal.match(/\d+/)?.[0];
      const targetCount = volumeHint ? Math.min(Number(volumeHint), 200) : task.resultCount;
      data = {
        hiring_signals_detected: Math.round(jitter(targetCount * 0.5, 4)),
        roles_identified: Array.from({ length: 3 }, () => pick(SAMPLE_ROLES)),
      };
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
