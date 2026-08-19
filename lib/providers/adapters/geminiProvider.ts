import { RuntimeConfig } from "@/lib/config";
import { makeEvidence } from "@/lib/providers/shared";
import {
  collectEvidenceSnippets,
  EVIDENCE_ONLY_SYSTEM_PROMPT,
  runEvidenceOnlyAnalysis,
} from "@/lib/providers/llm/evidenceOnlyAnalysis";
import { AgentProvider, Capability, Evidence, ProviderResult, ProviderTask } from "@/types";

/**
 * Gemini analysis provider - the second of the two live LLM candidates the
 * spec asks for (Tavily/Apollo/OpenAI/Gemini). It shares the exact same
 * evidence-only schema, system prompt, and one-shot repair contract as the
 * Anthropic adapter (lib/providers/llm/evidenceOnlyAnalysis.ts), so the
 * router genuinely chooses between two interchangeable LLM executors for
 * `ai-adoption-signal` / `data-validation` rather than routing to a single
 * hardcoded model.
 */

async function callGemini(apiKey: string, model: string, userPrompt: string, repairOf?: string): Promise<string> {
  const contents = repairOf
    ? [
        { role: "user", parts: [{ text: userPrompt }] },
        { role: "model", parts: [{ text: repairOf }] },
        {
          role: "user",
          parts: [
            { text: "That was not valid JSON matching the required shape. Reply with ONLY the corrected JSON object." },
          ],
        },
      ]
    : [{ role: "user", parts: [{ text: userPrompt }] }];

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: EVIDENCE_ONLY_SYSTEM_PROMPT }] },
        contents,
        generationConfig: { temperature: 0, maxOutputTokens: 300 },
      }),
    }
  );

  if (!response.ok) {
    throw new Error(`Gemini API error: ${response.status} ${await response.text().catch(() => "")}`);
  }

  const body = await response.json();
  const text = body?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (typeof text !== "string") throw new Error("Unexpected Gemini response shape");
  return text;
}

interface DiscoveredCompany {
  name: string;
  website: string;
}

export function createGeminiAnalysisProvider(config: RuntimeConfig): AgentProvider {
  const configured = config.mode === "live" && Boolean(process.env.GEMINI_API_KEY);
  const model = process.env.GEMINI_MODEL || "gemini-2.0-flash";
  const capabilities: Capability[] = ["ai-adoption-signal", "data-validation"];

  return {
    id: "gemini-analysis-provider",
    name: "Gemini",
    description: "Interprets already-retrieved evidence - fit classification, why-now synthesis, contradiction review.",
    capabilities,
    protocol: "rest",
    quality_score: 0.91,
    reliability_score: 0.84,
    success_rate: 0.86,
    price_per_task: 0.55,
    average_latency_seconds: 1.9,
    configured,

    async execute(task: ProviderTask): Promise<ProviderResult> {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        return {
          status: "failed",
          data: {},
          evidence: [],
          confidence: 0,
          cost: 0,
          duration_seconds: 0,
          error: "Gemini is not configured - missing GEMINI_API_KEY.",
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
          error: "Gemini requires upstream evidence (no companies in context).",
        };
      }

      const started = Date.now();
      const byCompany: Record<string, { aiSignal: string; evidence: Evidence[] }> = {};
      const evidence: Evidence[] = [];

      try {
        for (const company of companies) {
          const snippets = collectEvidenceSnippets(task.context, company.name);
          const analysis = await runEvidenceOnlyAnalysis(
            (prompt, repairOf) => callGemini(apiKey, model, prompt, repairOf),
            company.name,
            snippets
          );
          const item = makeEvidence({
            type: "provider_output",
            title: `Gemini signal analysis - ${company.name}`,
            source: `Gemini (${model})`,
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
          error: err instanceof Error ? err.message : "Gemini analysis failed",
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
