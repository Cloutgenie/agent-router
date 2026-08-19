import { RuntimeConfig } from "@/lib/config";
import { makeEvidence } from "@/lib/providers/shared";
import {
  collectEvidenceSnippets,
  EVIDENCE_ONLY_SYSTEM_PROMPT,
  runEvidenceOnlyAnalysis,
} from "@/lib/providers/llm/evidenceOnlyAnalysis";
import { AgentProvider, Capability, Evidence, ProviderResult, ProviderTask } from "@/types";

/**
 * xAI (Grok) analysis provider - a fourth live LLM candidate alongside
 * Anthropic/Gemini/OpenAI, genuinely new scope (never one of the spec's
 * originally-named Tavily/Apollo/OpenAI/Gemini stack). Shares the exact
 * same evidence-only schema, system prompt, and one-shot repair contract
 * (lib/providers/llm/evidenceOnlyAnalysis.ts). xAI's Chat Completions API
 * is OpenAI-compatible - confirmed live against the real API (same
 * request/response shape, `response_format: json_object` honored, and the
 * shared system prompt's "(0-1)" confidence hint is respected) - so this
 * mirrors openaiProvider.ts almost exactly rather than inventing a new
 * request shape.
 */

async function callXAI(apiKey: string, model: string, userPrompt: string, repairOf?: string): Promise<string> {
  const messages = repairOf
    ? [
        { role: "system", content: EVIDENCE_ONLY_SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
        { role: "assistant", content: repairOf },
        {
          role: "user",
          content: "That was not valid JSON matching the required shape. Reply with ONLY the corrected JSON object.",
        },
      ]
    : [
        { role: "system", content: EVIDENCE_ONLY_SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ];

  const response = await fetch("https://api.x.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0,
      max_tokens: 300,
      response_format: { type: "json_object" },
    }),
  });

  if (!response.ok) {
    throw new Error(`xAI API error: ${response.status} ${await response.text().catch(() => "")}`);
  }

  const body = await response.json();
  const text = body?.choices?.[0]?.message?.content;
  if (typeof text !== "string") throw new Error("Unexpected xAI response shape");
  return text;
}

interface DiscoveredCompany {
  name: string;
  website: string;
}

export function createXAIProvider(config: RuntimeConfig): AgentProvider {
  const model = process.env.XAI_MODEL || "grok-4.20-non-reasoning-latest";
  const capabilities: Capability[] = ["ai-adoption-signal", "data-validation"];

  return {
    id: "xai-analysis-provider",
    name: "Grok (xAI)",
    description: "Interprets already-retrieved evidence - fit classification, why-now synthesis, contradiction review.",
    capabilities,
    protocol: "rest",
    quality_score: 0.9,
    reliability_score: 0.85,
    success_rate: 0.87,
    price_per_task: 0.65,
    average_latency_seconds: 2.4,
    configured: config.xaiConfigured,

    async execute(task: ProviderTask): Promise<ProviderResult> {
      const apiKey = process.env.XAI_API_KEY;
      if (!apiKey) {
        return {
          status: "failed",
          data: {},
          evidence: [],
          confidence: 0,
          cost: 0,
          duration_seconds: 0,
          error: "xAI is not configured - missing XAI_API_KEY.",
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
          error: "xAI requires upstream evidence (no companies in context).",
        };
      }

      const started = Date.now();
      const byCompany: Record<string, { aiSignal: string; evidence: Evidence[] }> = {};
      const evidence: Evidence[] = [];

      try {
        for (const company of companies) {
          const snippets = collectEvidenceSnippets(task.context, company.name);
          const analysis = await runEvidenceOnlyAnalysis(
            (prompt, repairOf) => callXAI(apiKey, model, prompt, repairOf),
            company.name,
            snippets
          );
          const item = makeEvidence({
            type: "provider_output",
            title: `Grok signal analysis - ${company.name}`,
            source: `Grok (${model})`,
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
          error: err instanceof Error ? err.message : "xAI analysis failed",
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
      return config.xaiConfigured;
    },
  };
}
