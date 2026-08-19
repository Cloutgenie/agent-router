import { findDemoCompany } from "@/data/demo-companies";
import { HiringSignalInfo, needsBrowserEscalation } from "@/lib/providers/browserEscalation";
import { AgentProvider, Evidence, ProviderResult, ProviderTask } from "@/types";
import { jitter, makeEvidence, round2, sleep } from "../shared";

interface DiscoveredCompany {
  name: string;
  website: string;
}

function runBrowserVerification(task: ProviderTask): { data: Record<string, unknown>; evidence: Evidence[] } {
  const companies = (task.context.companies as DiscoveredCompany[] | undefined) ?? [];
  const hiringByCompany = (task.context.hiringByCompany as Record<string, HiringSignalInfo> | undefined) ?? {};
  const byCompany: Record<string, { hiringPageConfirmed: boolean; evidence: Evidence[] }> = {};
  const evidence: Evidence[] = [];

  for (const company of companies) {
    const demo = findDemoCompany(company.name);
    if (!demo) continue;
    const hiringInfo = hiringByCompany[company.name] ?? {};
    if (!needsBrowserEscalation(hiringInfo)) continue; // upstream signal was already strong - browsing wouldn't add value

    // Older postings are more likely to have been filled or pulled down by the time anyone re-checks them.
    const confirmProbability = demo.hiringAgeDays <= 45 ? 0.75 : 0.3;
    const confirmed = Math.random() < confirmProbability;

    const item = confirmed
      ? makeEvidence({
          type: "job_posting",
          title: `Careers page re-check - ${company.name}`,
          source: `${company.website}/careers (browser-verified)`,
          url: `https://${company.website}/careers`,
          excerpt: `Confirmed directly on the official careers page: ${demo.hiringSignal}.`,
          confidence: round2(Math.min(0.98, jitter(0.94, 0.03))),
          ageDays: 0,
          sourceQuality: "high",
        })
      : makeEvidence({
          type: "job_posting",
          title: `Careers page re-check - ${company.name}`,
          source: `${company.website}/careers (browser-verified)`,
          url: `https://${company.website}/careers`,
          excerpt: `Checked the official careers page directly - this specific posting is no longer listed.`,
          confidence: round2(Math.max(0.05, jitter(0.18, 0.05))),
          ageDays: 0,
          sourceQuality: "high",
        });

    byCompany[company.name] = { hiringPageConfirmed: confirmed, evidence: [item] };
    evidence.push(item);
  }

  return { data: { byCompany }, evidence };
}

export const MockBrowserExecutor: AgentProvider = {
  id: "browser-verifier",
  name: "Browser Verifier",
  description: "Read-only official-source check - opens careers/newsroom pages directly to confirm or downgrade a weak signal.",
  capabilities: ["official-source-verification"],
  protocol: "mock",
  quality_score: 0.93,
  reliability_score: 0.9,
  success_rate: 0.95,
  price_per_task: 0.45,
  average_latency_seconds: 3.0,
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
        error: `${this.name} could not reach the target pages (simulated failure).`,
      };
    }

    const { data, evidence } = runBrowserVerification(task);

    return {
      status: "completed",
      data,
      evidence,
      confidence: evidence.length > 0 ? round2(evidence.reduce((s, e) => s + e.confidence, 0) / evidence.length) : 0.8,
      // Only bill for companies actually checked, not the whole batch - escalation that adds no value costs nothing.
      cost: round2(this.price_per_task * Math.max(1, evidence.length) * 0.3),
      duration_seconds: round2(simulatedSeconds),
    };
  },

  async healthCheck() {
    await sleep(30);
    return true;
  },
};
