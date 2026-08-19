import {
  Agent,
  AgentProvider,
  AgentTaskRequest,
  AgentTaskResult,
  Capability,
} from "@/types";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function jitter(base: number, spread: number): number {
  return base + (Math.random() * 2 - 1) * spread;
}

function pick<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

const SAMPLE_COMPANY_NAMES = [
  "Nimbus Shield",
  "Redgate Security",
  "Vantage Point Labs",
  "Cipherline",
  "Northbeam Analytics",
  "Fortknox Systems",
  "Bluewire Technologies",
  "Sentry Path",
  "Halo Defense",
  "Greymatter AI",
  "Ironclad Cloud",
  "Trustframe",
];

const SAMPLE_ROLES = [
  "VP of Security",
  "CISO",
  "Head of Information Security",
  "Director of Security Engineering",
  "Chief Trust Officer",
];

/**
 * Generates a realistic, capability-shaped mock payload. This is the seam
 * where a real integration would instead parse an actual provider response.
 */
function mockPayloadFor(
  capability: Capability,
  request: AgentTaskRequest
): Record<string, unknown> {
  const volumeHint = request.raw_task.match(/\d+/)?.[0];
  const targetCount = volumeHint ? Math.min(Number(volumeHint), 200) : 25;

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
    case "funding-research":
      return {
        funding_rounds_identified: Math.round(jitter(targetCount * 0.6, 5)),
        total_funding_tracked_usd: Math.round(jitter(targetCount * 4_500_000, 2_000_000)),
      };
    case "hiring-signals":
      return {
        hiring_signals_detected: Math.round(jitter(targetCount * 0.5, 4)),
        roles_identified: Array.from({ length: 3 }, () => pick(SAMPLE_ROLES)),
      };
    case "lead-generation":
      return {
        leads_found: targetCount,
        qualified_leads: Math.round(targetCount * jitter(0.7, 0.1)),
      };
    case "contact-enrichment":
      return {
        contacts_enriched: Math.round(targetCount * jitter(0.8, 0.1)),
        emails_found: Math.round(targetCount * jitter(0.65, 0.1)),
        phone_numbers_found: Math.round(targetCount * jitter(0.3, 0.1)),
      };
    case "cybersecurity-research":
      return {
        vendors_profiled: Math.round(jitter(targetCount * 0.4, 4)),
        security_focus_confirmed_pct: Math.round(jitter(0.82, 0.08) * 100) / 100,
      };
    case "financial-research":
      return {
        valuation_estimates_produced: Math.round(jitter(targetCount * 0.5, 4)),
        revenue_signals_found: Math.round(jitter(targetCount * 0.35, 3)),
      };
    case "data-validation":
      return {
        records_validated: targetCount,
        accuracy_rate: Math.round(jitter(0.94, 0.03) * 100) / 100,
      };
    case "summarization":
      return {
        summary_word_count: Math.round(jitter(180, 40)),
      };
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
    default:
      return {};
  }
}

/**
 * MockAgentProvider simulates a real agent call: a bounded artificial delay
 * plus a structured, capability-shaped result. Every real integration
 * (REST, MCP, A2A, webhook, LangGraph, CrewAI...) should implement the same
 * `AgentProvider` interface so the router and execution engine never need to
 * change - only the provider wiring in `lib/agents/providers/` does.
 */
export class MockAgentProvider implements AgentProvider {
  async execute(agent: Agent, request: AgentTaskRequest): Promise<AgentTaskResult> {
    // Scaled-down artificial delay so the UI stays responsive while still
    // feeling like real work is happening.
    const simulatedSeconds = Math.max(0.6, jitter(agent.average_latency_seconds, 1));
    const wallClockMs = Math.min(simulatedSeconds * 350, 2600);
    await sleep(wallClockMs);

    const failed = Math.random() > agent.success_rate;
    if (failed) {
      return {
        status: "failed",
        duration_seconds: Math.round(simulatedSeconds * 10) / 10,
        cost: Math.round(agent.price_per_task * 0.4 * 100) / 100,
        confidence: 0,
        result: {},
        error: `${agent.name} could not complete the assignment (simulated failure).`,
      };
    }

    const combinedResult: Record<string, unknown> = {};
    for (const capability of request.assigned_capabilities) {
      Object.assign(combinedResult, mockPayloadFor(capability, request));
    }

    const confidence = Math.min(
      0.99,
      Math.max(0.5, jitter(agent.quality_score, 0.06))
    );

    return {
      status: "completed",
      duration_seconds: Math.round(simulatedSeconds * 10) / 10,
      cost: agent.price_per_task,
      confidence: Math.round(confidence * 100) / 100,
      result: combinedResult,
    };
  }

  async healthCheck(agent: Agent): Promise<boolean> {
    await sleep(50);
    return agent.active;
  }
}

export const mockAgentProvider = new MockAgentProvider();
