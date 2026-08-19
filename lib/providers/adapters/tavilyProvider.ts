import { RuntimeConfig } from "@/lib/config";
import { canonicalizeCompanies } from "@/lib/dedup";
import { makeEvidence } from "@/lib/providers/shared";
import { AgentProvider, Capability, Evidence, ProviderResult, ProviderTask } from "@/types";

/**
 * Tavily - the platform's live web-search executor (spec #11). Used for
 * company discovery, funding/hiring/AI-signal research, and general
 * evidence gathering. It only ever returns what Tavily's index actually
 * returned - company names are derived from result domains/titles, never
 * invented, and every fact is carried with its source URL and retrieval
 * time so the deterministic verifier (lib/evaluation/verifier.ts) can judge
 * it independently.
 */

interface TavilyResult {
  title: string;
  url: string;
  content: string;
  score?: number;
  published_date?: string;
}

interface TavilyResponse {
  results: TavilyResult[];
}

async function tavilySearch(apiKey: string, query: string, maxResults: number): Promise<TavilyResult[]> {
  const response = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      search_depth: "basic",
      max_results: maxResults,
      include_answer: false,
    }),
  });

  if (!response.ok) {
    throw new Error(`Tavily API error: ${response.status} ${await response.text().catch(() => "")}`);
  }

  const body = (await response.json()) as TavilyResponse;
  return Array.isArray(body.results) ? body.results : [];
}

function hostnameOf(url: string): string | undefined {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return undefined;
  }
}

/** Best-effort, non-fabricated company name from a search result - prefers the page title's first clause, falls back to the domain. */
function deriveCompanyName(result: TavilyResult, domain: string): string {
  const firstClause = result.title.split(/\s+[-|:–]\s+/)[0]?.trim();
  if (firstClause && firstClause.length >= 2 && firstClause.length <= 60) return firstClause;
  const label = domain.split(".")[0];
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function ageDaysFrom(publishedDate?: string): number | undefined {
  if (!publishedDate) return undefined;
  const parsed = Date.parse(publishedDate);
  if (Number.isNaN(parsed)) return undefined;
  return Math.max(0, Math.round((Date.now() - parsed) / (24 * 60 * 60 * 1000)));
}

interface DiscoveredCompany {
  name: string;
  website: string;
  industry?: string;
}

async function runDiscovery(apiKey: string, task: ProviderTask): Promise<{ data: Record<string, unknown>; evidence: Evidence[] }> {
  const volumeHint = task.goal.match(/\d+/)?.[0];
  const targetCount = volumeHint ? Math.min(Number(volumeHint), 25) : Math.min(task.resultCount, 25);
  const results = await tavilySearch(apiKey, task.goal, Math.min(targetCount + 5, 20));

  const raw = results
    .map((r) => {
      const domain = hostnameOf(r.url);
      if (!domain) return null;
      return { name: deriveCompanyName(r, domain), website: domain, result: r };
    })
    .filter((r): r is { name: string; website: string; result: TavilyResult } => r !== null);

  const deduped = canonicalizeCompanies(raw);
  const companies: DiscoveredCompany[] = [];
  const byCompany: Record<string, { website: string; industry: string; evidence: Evidence[] }> = {};
  const evidence: Evidence[] = [];

  for (const { canonical, sources } of deduped) {
    const source = sources[0];
    companies.push({ name: canonical.name, website: canonical.website ?? source.website, industry: "" });
    const item = makeEvidence({
      type: "website",
      title: source.result.title,
      source: canonical.website ?? source.website,
      url: source.result.url,
      excerpt: source.result.content?.slice(0, 300),
      confidence: source.result.score ?? 0.7,
      ageDays: ageDaysFrom(source.result.published_date),
      sourceQuality: "medium",
      query: task.goal,
    });
    byCompany[canonical.name] = { website: canonical.website ?? source.website, industry: "", evidence: [item] };
    evidence.push(item);
  }

  return { data: { companies, byCompany }, evidence };
}

const FUNDING_STAGE_PATTERN = /(pre-seed|seed|series [a-f])/i;

async function runFundingEnrichment(apiKey: string, task: ProviderTask): Promise<{ data: Record<string, unknown>; evidence: Evidence[] }> {
  const companies = (task.context.companies as DiscoveredCompany[] | undefined) ?? [];
  const byCompany: Record<string, { fundingStage: string; fundingSignal: string; evidence: Evidence[] }> = {};
  const evidence: Evidence[] = [];

  for (const company of companies) {
    const results = await tavilySearch(apiKey, `${company.name} funding round raised`, 2);
    if (results.length === 0) continue;
    const top = results[0];
    const combined = `${top.title} ${top.content}`;
    const stageMatch = combined.match(FUNDING_STAGE_PATTERN);
    const isOfficial = hostnameOf(top.url) === company.website;
    const item = makeEvidence({
      type: "funding",
      title: top.title,
      source: hostnameOf(top.url) ?? top.url,
      url: top.url,
      excerpt: top.content?.slice(0, 300),
      confidence: top.score ?? 0.65,
      ageDays: ageDaysFrom(top.published_date),
      sourceQuality: isOfficial ? "high" : "medium",
      query: `${company.name} funding round raised`,
    });
    byCompany[company.name] = {
      fundingStage: stageMatch ? stageMatch[0] : "Unknown",
      fundingSignal: top.content?.slice(0, 200) ?? top.title,
      evidence: [item],
    };
    evidence.push(item);
  }

  return { data: { byCompany }, evidence };
}

async function runHiringEnrichment(apiKey: string, task: ProviderTask): Promise<{ data: Record<string, unknown>; evidence: Evidence[] }> {
  const companies = (task.context.companies as DiscoveredCompany[] | undefined) ?? [];
  const byCompany: Record<string, { hiringSignal: string; securitySignal: string; evidence: Evidence[] }> = {};
  const evidence: Evidence[] = [];

  for (const company of companies) {
    const results = await tavilySearch(apiKey, `${company.name} careers hiring security engineer`, 2);
    if (results.length === 0) continue;
    const top = results[0];
    const isOfficial = hostnameOf(top.url) === company.website;
    const item = makeEvidence({
      type: "job_posting",
      title: top.title,
      source: hostnameOf(top.url) ?? top.url,
      url: top.url,
      excerpt: top.content?.slice(0, 300),
      confidence: top.score ?? 0.65,
      ageDays: ageDaysFrom(top.published_date),
      sourceQuality: isOfficial ? "high" : "medium",
      query: `${company.name} careers hiring security engineer`,
    });
    const signal = top.content?.slice(0, 200) ?? top.title;
    byCompany[company.name] = { hiringSignal: signal, securitySignal: signal, evidence: [item] };
    evidence.push(item);
  }

  return { data: { byCompany }, evidence };
}

async function runAiSignalEnrichment(apiKey: string, task: ProviderTask): Promise<{ data: Record<string, unknown>; evidence: Evidence[] }> {
  const companies = (task.context.companies as DiscoveredCompany[] | undefined) ?? [];
  const byCompany: Record<string, { aiSignal: string; evidence: Evidence[] }> = {};
  const evidence: Evidence[] = [];

  for (const company of companies) {
    const results = await tavilySearch(apiKey, `${company.name} AI product artificial intelligence`, 2);
    if (results.length === 0) continue;
    const top = results[0];
    const item = makeEvidence({
      type: "news",
      title: top.title,
      source: hostnameOf(top.url) ?? top.url,
      url: top.url,
      excerpt: top.content?.slice(0, 300),
      confidence: top.score ?? 0.65,
      ageDays: ageDaysFrom(top.published_date),
      sourceQuality: "medium",
      query: `${company.name} AI product artificial intelligence`,
    });
    byCompany[company.name] = { aiSignal: top.content?.slice(0, 200) ?? top.title, evidence: [item] };
    evidence.push(item);
  }

  return { data: { byCompany }, evidence };
}

export function createTavilyProvider(config: RuntimeConfig): AgentProvider {
  const capabilities: Capability[] = [
    "web-research",
    "company-research",
    "market-research",
    "funding-research",
    "hiring-signals",
    "cybersecurity-research",
    "ai-adoption-signal",
  ];

  return {
    id: "tavily",
    name: "Tavily",
    description: "Live web search - company discovery, funding/hiring/AI signal research, and general evidence gathering.",
    capabilities,
    protocol: "rest",
    quality_score: 0.9,
    reliability_score: 0.88,
    success_rate: 0.9,
    price_per_task: 0.35,
    average_latency_seconds: 2.5,
    configured: config.tavilyConfigured,

    async execute(task: ProviderTask): Promise<ProviderResult> {
      const apiKey = process.env.TAVILY_API_KEY;
      if (!apiKey) {
        return {
          status: "failed",
          data: {},
          evidence: [],
          confidence: 0,
          cost: 0,
          duration_seconds: 0,
          error: "Tavily is not configured - missing TAVILY_API_KEY.",
        };
      }

      const started = Date.now();
      try {
        let result: { data: Record<string, unknown>; evidence: Evidence[] };

        if (task.capability === "company-research" && !task.context.companies) {
          result = await runDiscovery(apiKey, task);
        } else if (task.capability === "funding-research" && task.context.companies) {
          result = await runFundingEnrichment(apiKey, task);
        } else if (task.capability === "hiring-signals" && task.context.companies) {
          result = await runHiringEnrichment(apiKey, task);
        } else if (task.capability === "ai-adoption-signal" && task.context.companies) {
          result = await runAiSignalEnrichment(apiKey, task);
        } else {
          // Generic evidence-gathering fallback for capabilities without a
          // dedicated byCompany contract (web-research, market-research,
          // cybersecurity-research without upstream company context).
          const results = await tavilySearch(apiKey, task.goal, 5);
          const evidence = results.map((r) =>
            makeEvidence({
              type: "news",
              title: r.title,
              source: hostnameOf(r.url) ?? r.url,
              url: r.url,
              excerpt: r.content?.slice(0, 300),
              confidence: r.score ?? 0.65,
              ageDays: ageDaysFrom(r.published_date),
              sourceQuality: "medium",
              query: task.goal,
            })
          );
          result = { data: { sources_reviewed: results.length }, evidence };
        }

        return {
          status: "completed",
          data: result.data,
          evidence: result.evidence,
          confidence: result.evidence.length > 0
            ? Math.min(0.98, result.evidence.reduce((sum, e) => sum + e.confidence, 0) / result.evidence.length)
            : 0.4,
          cost: this.price_per_task,
          duration_seconds: Math.round(((Date.now() - started) / 1000) * 10) / 10,
        };
      } catch (err) {
        return {
          status: "failed",
          data: {},
          evidence: [],
          confidence: 0,
          cost: 0,
          duration_seconds: (Date.now() - started) / 1000,
          error: err instanceof Error ? err.message : "Tavily search failed",
        };
      }
    },

    async healthCheck(): Promise<boolean> {
      return config.tavilyConfigured;
    },
  };
}
