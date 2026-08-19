import { findDemoCompany } from "@/data/demo-companies";
import { AgentProvider, DecisionMakerContact, Evidence, ProviderResult, ProviderTask } from "@/types";
import { jitter, makeEvidence, pick, round2, sleep } from "../shared";

interface DiscoveredCompany {
  name: string;
  website: string;
}

const FIRST_NAMES = ["Jordan", "Priya", "Marcus", "Elena", "Sam", "Nadia", "Owen", "Yuki"];
const LAST_NAMES = ["Reyes", "Chen", "Okafor", "Novak", "Patel", "Larsen", "Whitfield", "Suzuki"];

/**
 * Deep enrichment (V4 #24, triggered via `context.deepEnrichment`) attempts
 * to resolve a real name/email/LinkedIn for the already-identified role.
 * Consistent with "do not invent missing emails": roughly 1 in 3 lookups
 * comes back with no email, and that is returned as `undefined`, not a
 * fabricated address.
 */
function runContactByCompany(
  task: ProviderTask
): { data: Record<string, unknown>; evidence: Evidence[] } {
  const companies = (task.context.companies as DiscoveredCompany[] | undefined) ?? [];
  const deepEnrichment = task.context.deepEnrichment === true;
  const byCompany: Record<
    string,
    { decisionMakerRole: string; evidence: Evidence[]; contact?: DecisionMakerContact }
  > = {};
  const evidence: Evidence[] = [];

  for (const company of companies) {
    const demo = findDemoCompany(company.name);
    if (!demo) continue;
    const confidence = round2(Math.min(0.97, Math.max(0.45, jitter(demo.signalStrength, 0.09))));
    const item = makeEvidence({
      type: "company_data",
      title: `Likely decision maker - ${company.name}`,
      source: `${company.website}/team`,
      url: `https://${company.website}/team`,
      excerpt: `${demo.decisionMakerRole} identified as the likely security buying stakeholder.`,
      confidence,
      ageDays: 5,
      sourceQuality: "medium",
    });

    let contact: DecisionMakerContact | undefined;
    if (deepEnrichment) {
      const found = Math.random() < 0.7;
      const fullName = found ? `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}` : undefined;
      const emailFound = found && Math.random() < 0.65;
      contact = {
        fullName,
        role: demo.decisionMakerRole,
        company: company.name,
        linkedinUrl: found ? `https://linkedin.com/in/${(fullName ?? "").toLowerCase().replace(/\s+/g, "-")}` : undefined,
        email: emailFound && fullName
          ? `${fullName.split(" ")[0].toLowerCase()}.${fullName.split(" ")[1].toLowerCase()}@${company.website}`
          : undefined,
        emailConfidence: emailFound ? round2(jitter(0.78, 0.12)) : undefined,
        source: "Contact Miner",
        verificationStatus: emailFound ? (Math.random() < 0.6 ? "verified" : "unverified") : "not-found",
      };
    }

    byCompany[company.name] = { decisionMakerRole: demo.decisionMakerRole, evidence: [item], contact };
    evidence.push(item);
  }

  return { data: { byCompany }, evidence };
}

export const MockContactProvider: AgentProvider = {
  id: "contact-miner",
  name: "Contact Miner",
  description: "Identifies and enriches decision-maker contact details across an org chart.",
  capabilities: ["contact-enrichment", "lead-generation"],
  protocol: "mock",
  quality_score: 0.83,
  reliability_score: 0.88,
  success_rate: 0.9,
  price_per_task: 1.1,
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
        error: `${this.name} could not enrich contact data (simulated failure).`,
      };
    }

    let data: Record<string, unknown>;
    let evidence: Evidence[];

    if (task.context.companies) {
      const result = runContactByCompany(task);
      data = result.data;
      evidence = result.evidence;
    } else {
      const volumeHint = task.goal.match(/\d+/)?.[0];
      const targetCount = volumeHint ? Math.min(Number(volumeHint), 200) : task.resultCount;
      data = {
        contacts_enriched: Math.round(targetCount * jitter(0.8, 0.1)),
        emails_found: Math.round(targetCount * jitter(0.65, 0.1)),
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
