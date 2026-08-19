import { RuntimeConfig } from "@/lib/config";
import { makeEvidence } from "@/lib/providers/shared";
import {
  collectEvidenceSnippets,
  EVIDENCE_ONLY_SYSTEM_PROMPT,
  runEvidenceOnlyAnalysis,
} from "@/lib/providers/llm/evidenceOnlyAnalysis";
import { AgentProvider, Capability, Evidence, ProviderResult, ProviderTask } from "@/types";

/**
 * OpenAI analysis provider - the third live LLM candidate alongside
 * Anthropic and Gemini (spec names Tavily/Apollo/OpenAI/Gemini as the
 * initial live stack). Shares the exact same evidence-only schema, system
 * prompt, and one-shot repair contract as the other two
 * (lib/providers/llm/evidenceOnlyAnalysis.ts) - with all three configured,
 * the router genuinely chooses among three interchangeable LLM executors
 * for `ai-adoption-signal` / `data-validation`, not a single hardcoded
 * model. Uses Chat Completions' `response_format: json_object` to get
 * strict JSON directly where the API supports it; the shared repair loop
 * still runs as a second line of defense for models/responses that don't
 * honor it.
 */

async function callOpenAI(apiKey: string, model: string, userPrompt: string, repairOf?: string): Promise<string> {
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

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
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
    throw new Error(`OpenAI API error: ${response.status} ${await response.text().catch(() => "")}`);
  }

  const body = await response.json();
  const text = body?.choices?.[0]?.message?.content;
  if (typeof text !== "string") throw new Error("Unexpected OpenAI response shape");
  return text;
}

interface DiscoveredCompany {
  name: string;
  website: string;
}

export function createOpenAIProvider(config: RuntimeConfig): AgentProvider {
  const configured = config.mode === "live" && Boolean(process.env.OPENAI_API_KEY);
  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
  const capabilities: Capability[] = ["ai-adoption-signal", "data-validation"];

  return {
    id: "openai-analysis-provider",
    name: "OpenAI",
    description: "Interprets already-retrieved evidence - fit classification, why-now synthesis, contradiction review.",
    capabilities,
    protocol: "rest",
    quality_score: 0.92,
    reliability_score: 0.85,
    success_rate: 0.87,
    price_per_task: 0.65,
    average_latency_seconds: 2.4,
    configured,

    async execute(task: ProviderTask): Promise<ProviderResult> {
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) {
        return {
          status: "failed",
          data: {},
          evidence: [],
          confidence: 0,
          cost: 0,
          duration_seconds: 0,
          error: "OpenAI is not configured - missing OPENAI_API_KEY.",
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
          error: "OpenAI requires upstream evidence (no companies in context).",
        };
      }

      const started = Date.now();
      const byCompany: Record<string, { aiSignal: string; evidence: Evidence[] }> = {};
      const evidence: Evidence[] = [];

      try {
        for (const company of companies) {
          const snippets = collectEvidenceSnippets(task.context, company.name);
          const analysis = await runEvidenceOnlyAnalysis(
            (prompt, repairOf) => callOpenAI(apiKey, model, prompt, repairOf),
            company.name,
            snippets
          );
          const item = makeEvidence({
            type: "provider_output",
            title: `OpenAI signal analysis - ${company.name}`,
            source: `OpenAI (${model})`,
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
          error: err instanceof Error ? err.message : "OpenAI analysis failed",
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
