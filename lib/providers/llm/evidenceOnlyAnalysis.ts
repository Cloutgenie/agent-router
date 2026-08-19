import { Evidence } from "@/types";

/**
 * Shared contract every LLM analysis adapter (Anthropic, Gemini, ...) must
 * honor (spec #13-15): strict JSON schema, one repair attempt on malformed
 * output, and evidence-only reasoning - the model only ever interprets
 * evidence upstream steps already retrieved, never invents facts.
 */
export interface AnalysisSchema {
  signal_detected: boolean;
  summary: string;
  confidence: number;
}

export const EVIDENCE_ONLY_SYSTEM_PROMPT = `You analyze evidence about a company's AI adoption and security posture.
You are given retrieved evidence snippets - not asked to invent facts.
Only make claims supported by the supplied evidence. If the evidence does not support a
signal, say so - never introduce facts, company details, or events from your own memory.
Respond with ONLY a JSON object matching exactly this shape, no prose, no markdown fences:
{"signal_detected": boolean, "summary": string (<= 200 chars), "confidence": number (0-1)}`;

export function buildAnalysisPrompt(companyName: string, evidenceSnippets: string[]): string {
  const evidenceBlock =
    evidenceSnippets.length > 0
      ? evidenceSnippets.map((s, i) => `[${i + 1}] ${s}`).join("\n")
      : "No evidence retrieved for this company.";
  return `Company: ${companyName}\n\nEvidence:\n${evidenceBlock}\n\nDoes this evidence support an AI adoption or AI-related security opportunity signal?`;
}

export function parseAnalysisResponse(text: string): AnalysisSchema | null {
  try {
    const parsed = JSON.parse(text.trim());
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof parsed.signal_detected === "boolean" &&
      typeof parsed.summary === "string" &&
      typeof parsed.confidence === "number" &&
      parsed.confidence >= 0 &&
      parsed.confidence <= 1
    ) {
      return parsed as AnalysisSchema;
    }
  } catch {
    // fall through to null - handled by the one-shot repair retry below
  }
  return null;
}

/**
 * Calls the model once; if it doesn't return valid JSON, retries exactly
 * once with a repair prompt before giving up (the execution engine's
 * fallback chain takes over from there - see stepEngine.ts).
 */
export async function runEvidenceOnlyAnalysis(
  callModel: (prompt: string, repairOf?: string) => Promise<string>,
  companyName: string,
  evidenceSnippets: string[]
): Promise<AnalysisSchema> {
  const prompt = buildAnalysisPrompt(companyName, evidenceSnippets);
  const first = await callModel(prompt);
  const parsed = parseAnalysisResponse(first);
  if (parsed) return parsed;

  const repaired = await callModel(prompt, first);
  const parsedRepaired = parseAnalysisResponse(repaired);
  if (parsedRepaired) return parsedRepaired;

  throw new Error("Model did not return valid JSON after one repair attempt");
}

/** Pulls whatever evidence upstream steps already gathered about a company, to ground the LLM call. */
export function collectEvidenceSnippets(context: Record<string, unknown>, companyName: string): string[] {
  const snippets: string[] = [];
  for (const key of ["fundingByCompany", "hiringByCompany", "contactByCompany"]) {
    const map = context[key] as Record<string, { evidence?: Evidence[] }> | undefined;
    const entry = map?.[companyName];
    entry?.evidence?.forEach((e) => {
      if (e.excerpt) snippets.push(e.excerpt);
    });
  }
  return snippets;
}
