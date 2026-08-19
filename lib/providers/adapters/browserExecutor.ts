import { RuntimeConfig } from "@/lib/config";
import { HiringSignalInfo, needsBrowserEscalation } from "@/lib/providers/browserEscalation";
import { makeEvidence } from "@/lib/providers/shared";
import { AgentProvider, Evidence, ProviderResult, ProviderTask } from "@/types";

/**
 * Live browser executor (spec #23-24). Read-only by construction: it only
 * ever issues GET requests against a company's own official pages, never
 * submits a form, logs in, or performs any write action.
 *
 * This is a lightweight static-HTML page reader (fetch + text extraction),
 * not full headless-browser JS rendering - most careers/newsroom pages are
 * server-rendered, which covers the "verify an official source" use case
 * this executor exists for. `BROWSERBASE_API_KEY` / `BROWSERBASE_PROJECT_ID`
 * are reserved for a future swap to real Browserbase/Stagehand sessions
 * (which would add JS-rendered page support) and are not read here yet -
 * only `ENABLE_BROWSER_EXECUTION` gates this adapter today.
 */

interface DiscoveredCompany {
  name: string;
  website: string;
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const CANDIDATE_PATHS = ["/careers", "/jobs", "/careers/open-roles"];

interface FetchedPage {
  url: string;
  title?: string;
  text: string;
}

async function fetchOfficialPage(website: string, timeoutMs: number): Promise<FetchedPage | null> {
  for (const path of CANDIDATE_PATHS) {
    const url = `https://${website}${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method: "GET",
        signal: controller.signal,
        headers: { "User-Agent": "TaskDropoff-BrowserExecutor/1.0 (+read-only evidence check)" },
      });
      if (!res.ok) continue;
      const html = await res.text();
      const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
      return { url, title: titleMatch?.[1]?.trim(), text: stripHtml(html).slice(0, 4000) };
    } catch {
      continue; // unreachable path or timeout - try the next candidate, never invent a result
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}

const HIRING_PAGE_PATTERN = /\b(open position|open role|we're hiring|open roles|apply now|job opening|current openings)\b/i;

export function createBrowserExecutor(config: RuntimeConfig): AgentProvider {
  const timeoutMs = Number(process.env.DEFAULT_EXECUTION_TIMEOUT_MS ?? 30000);
  const maxPages = config.maxBrowserPagesPerTask;

  return {
    id: "browser-executor",
    name: "Browser Verifier (Live)",
    description:
      "Read-only: fetches official careers pages directly to confirm or downgrade a weak hiring signal. Never submits forms, logs in, or performs any write action.",
    capabilities: ["official-source-verification"],
    protocol: "rest",
    quality_score: 0.95,
    reliability_score: 0.85,
    success_rate: 0.85,
    price_per_task: 0.3,
    average_latency_seconds: 2.0,
    configured: config.browserExecutionConfigured,

    async execute(task: ProviderTask): Promise<ProviderResult> {
      if (!config.browserExecutionConfigured) {
        return {
          status: "failed",
          data: {},
          evidence: [],
          confidence: 0,
          cost: 0,
          duration_seconds: 0,
          error: "Browser execution is not enabled - set ENABLE_BROWSER_EXECUTION=true.",
        };
      }

      const companies = (task.context.companies as DiscoveredCompany[] | undefined) ?? [];
      const hiringByCompany = (task.context.hiringByCompany as Record<string, HiringSignalInfo> | undefined) ?? {};
      const started = Date.now();
      const byCompany: Record<string, { hiringPageConfirmed: boolean; evidence: Evidence[] }> = {};
      const evidence: Evidence[] = [];
      let pagesFetched = 0;

      for (const company of companies) {
        if (pagesFetched >= maxPages) break;
        const hiringInfo = hiringByCompany[company.name] ?? {};
        if (!needsBrowserEscalation(hiringInfo)) continue;

        const page = await fetchOfficialPage(company.website, timeoutMs);
        pagesFetched += 1;
        if (!page) continue; // page unreachable - contributes no evidence rather than guessing

        const confirmed = HIRING_PAGE_PATTERN.test(page.text);
        const item = makeEvidence({
          type: "job_posting",
          title: page.title ?? `Careers page - ${company.name}`,
          source: `${company.website} (browser-verified)`,
          url: page.url,
          excerpt: page.text.slice(0, 300),
          confidence: confirmed ? 0.93 : 0.2,
          ageDays: 0,
          sourceQuality: "high",
        });
        byCompany[company.name] = { hiringPageConfirmed: confirmed, evidence: [item] };
        evidence.push(item);
      }

      return {
        status: "completed",
        data: { byCompany, pages_fetched: pagesFetched },
        evidence,
        confidence: evidence.length > 0 ? evidence.reduce((s, e) => s + e.confidence, 0) / evidence.length : 0.8,
        cost: Math.round(this.price_per_task * Math.max(1, pagesFetched) * 100) / 100,
        duration_seconds: Math.round(((Date.now() - started) / 1000) * 10) / 10,
      };
    },

    async healthCheck(): Promise<boolean> {
      return config.browserExecutionConfigured;
    },
  };
}
