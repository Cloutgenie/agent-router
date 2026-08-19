import { RuntimeConfig } from "@/lib/config";
import { makeEvidence } from "@/lib/providers/shared";
import {
  collectEvidenceSnippets,
  EVIDENCE_ONLY_SYSTEM_PROMPT,
  runEvidenceOnlyAnalysis,
} from "@/lib/providers/llm/evidenceOnlyAnalysis";
import { AgentProvider, Capability, Evidence, ProviderResult, ProviderTask } from "@/types";

/**
 * LLM analysis provider (V4 #6) backed by Anthropic. Used only for
 * interpretation - classifying fit, summarizing why-now, assessing
 * contradictory signals - never as a substitute for evidence gathering. It
 * operates strictly on evidence already collected by upstream steps (passed
 * via `task.context`), and shares its schema/retry contract with every other
 * LLM adapter (see lib/providers/llm/evidenceOnlyAnalysis.ts) so the router
 * can genuinely pick between them (spec #16-17).
 */

async function callAnthropic(apiKey: string, model: string, userPrompt: string, repairOf?: string): Promise<string> {
  const messages = repairOf
    ? [
        { role: "user", content: userPrompt },
        { role: "assistant", content: repairOf },
        {
          role: "user",
          content: "That was not valid JSON matching the required shape. Reply with ONLY the corrected JSON object.",
        },
      ]
    : [{ role: "user", content: userPrompt }];

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 300,
      system: EVIDENCE_ONLY_SYSTEM_PROMPT,
      messages,
    }),
  });

  if (!response.ok) {
    throw new Error(`Anthropic API error: ${response.status} ${await response.text().catch(() => "")}`);
  }

  const body = await response.json();
  const text = body?.content?.[0]?.text;
  if (typeof text !== "string") throw new Error("Unexpected Anthropic response shape");
  return text;
}

interface DiscoveredCompany {
  name: string;
  website: string;
}

export function createLLMAnalysisProvider(config: RuntimeConfig): AgentProvider {
  const configured = config.mode === "live" && Boolean(process.env.ANTHROPIC_API_KEY);
  const model = process.env.ANTHROPIC_MODEL || "claude-haiku-4-5-20251001";
  const capabilities: Capability[] = ["ai-adoption-signal", "data-validation"];

  return {
    id: "llm-analysis-provider",
    name: "LLM Analysis (Anthropic)",
    description: "Interprets already-retrieved evidence - fit classification, why-now synthesis, contradiction review.",
    capabilities,
    protocol: "rest",
    quality_score: 0.9,
    reliability_score: 0.82,
    success_rate: 0.85,
    price_per_task: 0.6,
    average_latency_seconds: 2.2,
    configured,

    async execute(task: ProviderTask): Promise<ProviderResult> {
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) {
        return {
          status: "failed",
          data: {},
          evidence: [],
          confidence: 0,
          cost: 0,
          duration_seconds: 0,
          error: "LLM Analysis (Anthropic) is not configured - missing ANTHROPIC_API_KEY.",
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
          error: "LLM Analysis requires upstream evidence (no companies in context).",
        };
      }

      const started = Date.now();
      const byCompany: Record<string, { aiSignal: string; evidence: Evidence[] }> = {};
      const evidence: Evidence[] = [];

      try {
        for (const company of companies) {
          const snippets = collectEvidenceSnippets(task.context, company.name);
          const analysis = await runEvidenceOnlyAnalysis(
            (prompt, repairOf) => callAnthropic(apiKey, model, prompt, repairOf),
            company.name,
            snippets
          );
          const item = makeEvidence({
            type: "provider_output",
            title: `LLM signal analysis - ${company.name}`,
            source: `LLM Analysis (${model})`,
            excerpt: analysis.summary,
            confidence: analysis.confidence,
            sourceQuality: "medium",
            query: `AI adoption signal for ${company.name}`,
          });
          byCompany[company.name] = {
            aiSignal: analysis.signal_detected ? analysis.summary : "No AI adoption signal detected",
            evidence: [item],
          };
          evidence.push(item);
        }
      } catch (err) {
        return {
          status: "failed",
          data: {},
          evidence: [],
          confidence: 0,
          cost: 0,
          duration_seconds: (Date.now() - started) / 1000,
          error: err instanceof Error ? err.message : "LLM analysis failed",
        };
      }

      return {
        status: "completed",
        data: { byCompany },
        evidence,
        confidence: 0.85,
        cost: this.price_per_task,
        duration_seconds: Math.round(((Date.now() - started) / 1000) * 10) / 10,
      };
    },

    async healthCheck(): Promise<boolean> {
      return configured;
    },
  };
}
