import { RuntimeConfig } from "@/lib/config";
import { makeEvidence } from "@/lib/providers/shared";
import { AgentProvider, Capability, DecisionMakerContact, Evidence, ProviderResult, ProviderTask } from "@/types";

/**
 * Apollo.io - real contact/lead database integration, not a placeholder.
 * Deliberately does not advertise `company-research`: Apollo's own search
 * doesn't return a company list shaped like `{ companies, byCompany }`, and
 * a real adapter that can actually complete (unlike the old
 * always-throwing placeholder) could otherwise get routed to the flagship
 * discovery step and silently produce zero results - the same reasoning
 * already applied to Tavily/MCP for that step.
 *
 * Two real endpoints, confirmed against the live API while building this
 * (Apollo's docs list an older `mixed_people/search` path that the API
 * itself now rejects with a 422 pointing at the replacement):
 *   - `POST /api/v1/mixed_people/api_search` finds a likely decision-maker
 *     by title at the company's domain. The response is privacy-redacted
 *     by design (obfuscated last name, no email/LinkedIn) - just enough to
 *     confirm a role exists and get that person's Apollo id.
 *   - `POST /api/v1/people/match` with that id reveals the full record
 *     (name, title, email, email_status, linkedin_url) - only called when
 *     the step's `deepEnrichment` context flag is set, since this is the
 *     credit-consuming call.
 *
 * `email = null`/`undefined` whenever Apollo doesn't return one - never
 * inferred from a name+domain pattern (spec: "null is valid").
 */

const SECURITY_DECISION_MAKER_TITLES = [
  "Chief Information Security Officer",
  "CISO",
  "Chief Security Officer",
  "VP of Security",
  "VP Security",
  "Vice President of Security",
  "Head of Security",
  "Head of Information Security",
  "Head of Trust and Safety",
  "Director of Security",
  "Director of Information Security",
  "Director of Security Engineering",
  "Chief Trust Officer",
  "Security Lead",
];

interface DiscoveredCompany {
  name: string;
  website: string;
}

interface ApolloPerson {
  id: string;
  first_name?: string;
  last_name?: string;
  name?: string;
  title?: string;
  email?: string;
  email_status?: string;
  linkedin_url?: string;
  organization?: { name?: string };
}

async function apolloRequest(apiKey: string, path: string, body: Record<string, unknown>): Promise<unknown> {
  const res = await fetch(`https://api.apollo.io/api/v1/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": apiKey },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`Apollo API error: ${res.status} ${await res.text().catch(() => "")}`);
  }
  return res.json();
}

async function searchDecisionMaker(apiKey: string, domain: string): Promise<ApolloPerson | null> {
  const body = await apolloRequest(apiKey, "mixed_people/api_search", {
    q_organization_domains_list: [domain],
    person_titles: SECURITY_DECISION_MAKER_TITLES,
    page: 1,
    per_page: 1,
  });
  const person = (body as { people?: ApolloPerson[] })?.people?.[0];
  return person ?? null;
}

async function revealContact(apiKey: string, personId: string): Promise<ApolloPerson | null> {
  const body = await apolloRequest(apiKey, "people/match", { id: personId });
  return (body as { person?: ApolloPerson })?.person ?? null;
}

function fullName(person: ApolloPerson): string | undefined {
  if (person.name) return person.name;
  if (person.first_name || person.last_name) return [person.first_name, person.last_name].filter(Boolean).join(" ");
  return undefined;
}

export function createApolloProvider(config: RuntimeConfig): AgentProvider {
  const capabilities: Capability[] = ["contact-enrichment", "lead-generation"];

  return {
    id: "apollo-provider",
    name: "Apollo",
    description: "Contact and lead database - decision-maker discovery and contact enrichment.",
    capabilities,
    protocol: "rest",
    quality_score: 0.92,
    reliability_score: 0.9,
    success_rate: 0.9,
    price_per_task: 1.2,
    average_latency_seconds: 2.5,
    configured: config.apolloConfigured,

    async execute(task: ProviderTask): Promise<ProviderResult> {
      const apiKey = process.env.APOLLO_API_KEY;
      if (!apiKey) {
        return {
          status: "failed",
          data: {},
          evidence: [],
          confidence: 0,
          cost: 0,
          duration_seconds: 0,
          error: "Apollo is not configured - missing APOLLO_API_KEY.",
        };
      }

      const companies = (task.context.companies as DiscoveredCompany[] | undefined) ?? [];
      if (companies.length === 0) {
        return {
          status: "failed",
          data: {},
          evidence: [],
          confidence: 0,
          cost: 0,
          duration_seconds: 0,
          error: "Apollo requires upstream company context.",
        };
      }

      const deepEnrichment = task.context.deepEnrichment === true;
      const started = Date.now();
      const byCompany: Record<string, { decisionMakerRole: string; evidence: Evidence[]; contact?: DecisionMakerContact }> = {};
      const evidence: Evidence[] = [];

      try {
        for (const company of companies) {
          const person = await searchDecisionMaker(apiKey, company.website);
          if (!person) continue; // no match found - never invent one

          const role = person.title ?? "Unknown";
          const item = makeEvidence({
            type: "company_data",
            title: `Likely decision maker - ${company.name}`,
            source: "Apollo",
            excerpt: `${role} identified at ${company.name} via Apollo.`,
            confidence: 0.75,
            sourceQuality: "medium",
            query: `security decision maker at ${company.website}`,
          });
          evidence.push(item);

          let contact: DecisionMakerContact | undefined;
          if (deepEnrichment) {
            const revealed = (await revealContact(apiKey, person.id).catch(() => null)) ?? person;
            const email = typeof revealed.email === "string" && revealed.email.includes("@") ? revealed.email : undefined;
            contact = {
              fullName: fullName(revealed),
              role,
              company: company.name,
              linkedinUrl: revealed.linkedin_url,
              email,
              emailConfidence: email ? (revealed.email_status === "verified" ? 0.92 : 0.55) : undefined,
              source: "Apollo",
              verificationStatus: !email ? "not-found" : revealed.email_status === "verified" ? "verified" : "unverified",
            };
          }

          byCompany[company.name] = { decisionMakerRole: role, evidence: [item], contact };
        }
      } catch (err) {
        return {
          status: "failed",
          data: {},
          evidence: [],
          confidence: 0,
          cost: 0,
          duration_seconds: (Date.now() - started) / 1000,
          error: err instanceof Error ? err.message : "Apollo lookup failed",
        };
      }

      return {
        status: "completed",
        data: { byCompany },
        evidence,
        confidence: evidence.length > 0 ? 0.8 : 0.3,
        cost: this.price_per_task,
        duration_seconds: Math.round(((Date.now() - started) / 1000) * 10) / 10,
      };
    },

    async healthCheck(): Promise<boolean> {
      return config.apolloConfigured;
    },
  };
}
