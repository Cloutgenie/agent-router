import { ALL_CAPABILITIES, Capability, CapabilityClassifier } from "@/types";

/**
 * Deterministic keyword/rule based capability classifier for V0.
 *
 * This is intentionally simple and fully transparent: every inferred
 * capability can be traced back to the keyword(s) that triggered it.
 * Swap in an LLM-backed classifier later by implementing the same
 * `CapabilityClassifier` interface - nothing downstream needs to change.
 */
const CAPABILITY_KEYWORDS: Record<Capability, string[]> = {
  "company-research": [
    "compan", // matches company/companies
    "startup",
    "business",
    "organization",
    "firm",
    "saas",
    "b2b",
  ],
  "web-research": [
    "web research",
    "online source",
    "publicly available",
    "internet",
    "browse the web",
    "gather information",
  ],
  "funding-research": [
    "funding",
    "raised",
    "series a",
    "series b",
    "series c",
    "investment",
    "investor",
    "venture capital",
    "capital raise",
    "funding round",
  ],
  "hiring-signals": [
    "hiring",
    "job posting",
    "job opening",
    "recruiting",
    "buying signal",
    "buying signals",
    "intent signal",
    "signals",
  ],
  "lead-generation": [
    "lead",
    "leads",
    "prospect",
    "decision-maker",
    "decision maker",
    "buyer",
  ],
  "contact-enrichment": [
    "decision-maker",
    "decision maker",
    "contact",
    "email address",
    "phone number",
    "enrich",
  ],
  "cybersecurity-research": [
    "cybersecurity",
    "cyber security",
    "infosec",
    "security",
    "cyber",
  ],
  "financial-research": [
    "financial",
    "revenue",
    "valuation",
    "acquisition",
    "m&a",
    "profit",
    "financials",
  ],
  "data-validation": [
    "verify",
    "validate",
    "confirm",
    "accuracy",
    "cross-check",
    "fact-check",
    "data quality",
  ],
  summarization: ["summarize", "summary", "overview", "report on", "brief me"],
  "competitor-analysis": [
    "competitor",
    "competitors",
    "competitive landscape",
    "rival",
  ],
  "market-research": ["market", "industry trend", "sector", "landscape"],
  "ai-adoption-signal": [
    "ai security",
    "ai adoption",
    "ai-powered",
    "artificial intelligence",
    "genai",
    "gen ai",
    "llm",
    "machine learning",
    "need ai",
    "ai product",
    "ai feature",
    "ai help",
    "ai services",
  ],
};

const DEFAULT_CAPABILITIES: Capability[] = ["web-research", "summarization"];

export class KeywordCapabilityClassifier implements CapabilityClassifier {
  classify(rawTask: string): Capability[] {
    const text = rawTask.toLowerCase();
    const matched = ALL_CAPABILITIES.filter((capability) =>
      CAPABILITY_KEYWORDS[capability].some((keyword) => text.includes(keyword))
    );

    return matched.length > 0 ? matched : DEFAULT_CAPABILITIES;
  }

  /** Returns the keywords that triggered a given capability, for UI transparency. */
  explain(rawTask: string, capability: Capability): string[] {
    const text = rawTask.toLowerCase();
    return CAPABILITY_KEYWORDS[capability].filter((keyword) =>
      text.includes(keyword)
    );
  }
}

export const capabilityClassifier = new KeywordCapabilityClassifier();
