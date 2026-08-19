import puppeteer from "puppeteer-core";
import { RuntimeConfig } from "@/lib/config";
import { HiringSignalInfo, needsBrowserEscalation } from "@/lib/providers/browserEscalation";
import { makeEvidence } from "@/lib/providers/shared";
import { AgentProvider, Evidence, ProviderResult, ProviderTask } from "@/types";

/**
 * Live browser executor (spec #23-24). Read-only by construction: it only
 * ever issues GET requests / page navigations against a company's own
 * official pages, never submits a form, logs in, or performs any write
 * action.
 *
 * Two page-fetch strategies, chosen per-call by `browserbaseConfigured`:
 *   - Real Browserbase session (`fetchOfficialPageViaBrowserbase`): creates a
 *     remote Chrome session via Browserbase's REST API, drives it over CDP
 *     with `puppeteer-core`, and reads `document.body.innerText` after JS
 *     has run - covers SPA/JS-rendered careers pages the static path can't.
 *     The session is always released (REQUEST_RELEASE) in a `finally`, since
 *     Browserbase concurrency is capped per-project and unreleased sessions
 *     burn a slot until their ~5-minute TTL expires. Session *creation* is
 *     also rate-limited per project (observed: HTTP 429, "burst rate limit
 *     (5 requests per 1 minute)", on a real project while building this) -
 *     `execute()` therefore wraps each company's `fetchOfficialPage` call in
 *     its own try/catch so one company hitting that limit (or any other
 *     session/navigation failure) degrades to "no evidence for this company"
 *     rather than discarding evidence already gathered for every other one.
 *   - Static fetch (`fetchOfficialPageViaStaticFetch`): the original
 *     lightweight fetch + text-extraction path, used whenever
 *     `ENABLE_BROWSER_EXECUTION=true` but no Browserbase credentials are
 *     configured - most careers pages are server-rendered, so this alone
 *     already covers the common case with zero extra cost or latency.
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

async function fetchOfficialPageViaStaticFetch(website: string, timeoutMs: number): Promise<FetchedPage | null> {
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

interface BrowserbaseSession {
  id: string;
  connectUrl: string;
}

async function createBrowserbaseSession(apiKey: string, projectId: string): Promise<BrowserbaseSession> {
  const res = await fetch("https://api.browserbase.com/v1/sessions", {
    method: "POST",
    headers: { "x-bb-api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({ projectId }),
  });
  if (!res.ok) {
    throw new Error(`Browserbase session create failed: ${res.status} ${await res.text().catch(() => "")}`);
  }
  return res.json();
}

async function releaseBrowserbaseSession(apiKey: string, projectId: string, sessionId: string): Promise<void> {
  await fetch(`https://api.browserbase.com/v1/sessions/${sessionId}`, {
    method: "POST",
    headers: { "x-bb-api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({ projectId, status: "REQUEST_RELEASE" }),
  }).catch(() => undefined); // best-effort - the session's own TTL is the backstop
}

async function fetchOfficialPageViaBrowserbase(
  website: string,
  apiKey: string,
  projectId: string,
  timeoutMs: number
): Promise<FetchedPage | null> {
  const session = await createBrowserbaseSession(apiKey, projectId);
  try {
    const browser = await puppeteer.connect({ browserWSEndpoint: session.connectUrl });
    try {
      const page = await browser.newPage();
      for (const path of CANDIDATE_PATHS) {
        const url = `https://${website}${path}`;
        try {
          const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
          if (!response || !response.ok()) continue;
          const title = await page.title();
          const text = await page.evaluate(() => document.body.innerText);
          return { url, title, text: text.replace(/\s+/g, " ").trim().slice(0, 4000) };
        } catch {
          continue; // unreachable path or timeout - try the next candidate, never invent a result
        }
      }
      return null;
    } finally {
      await browser.disconnect();
    }
  } finally {
    await releaseBrowserbaseSession(apiKey, projectId, session.id);
  }
}

const HIRING_PAGE_PATTERN = /\b(open position|open role|we're hiring|open roles|apply now|job opening|current openings)\b/i;

export function createBrowserExecutor(config: RuntimeConfig): AgentProvider {
  const timeoutMs = Number(process.env.DEFAULT_EXECUTION_TIMEOUT_MS ?? 30000);
  const maxPages = config.maxBrowserPagesPerTask;

  async function fetchOfficialPage(website: string): Promise<FetchedPage | null> {
    if (config.browserbaseConfigured) {
      return fetchOfficialPageViaBrowserbase(
        website,
        process.env.BROWSERBASE_API_KEY as string,
        process.env.BROWSERBASE_PROJECT_ID as string,
        timeoutMs
      );
    }
    return fetchOfficialPageViaStaticFetch(website, timeoutMs);
  }

  return {
    id: "browser-executor",
    name: "Browser Verifier (Live)",
    description: config.browserbaseConfigured
      ? "Read-only: drives a real headless Browserbase session to confirm or downgrade a weak hiring signal, including JS-rendered careers pages. Never submits forms, logs in, or performs any write action."
      : "Read-only: fetches official careers pages directly to confirm or downgrade a weak hiring signal. Never submits forms, logs in, or performs any write action.",
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

        pagesFetched += 1;
        let page: FetchedPage | null;
        try {
          page = await fetchOfficialPage(company.website);
        } catch {
          // A single company's session/navigation failure (e.g. Browserbase's
          // per-project rate limit on session creation - observed at 5/min on
          // a real project during development) must not discard evidence
          // already gathered for every other company in this same call.
          continue;
        }
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
