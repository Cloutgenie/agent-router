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
  "official-source-verification": [
    "official source",
    "official website",
    "official page",
    "browser verification",
    "verify on their site",
  ],
  "crm-read": ["read from crm", "crm data", "check the crm", "look up in crm"],
  "crm-write": ["update crm", "write to crm", "log to crm", "log in crm"],
  "email-read": ["check email", "read email", "check inbox"],
  "email-send": ["send an email", "send email", "email them", "draft an email"],
  "calendar-read": ["check calendar", "view calendar", "check availability"],
  "calendar-write": ["schedule a meeting", "book a meeting", "add to calendar", "schedule a call"],
  "file-read": ["read file", "open file", "read the document"],
  "file-write": ["save file", "write file", "upload file", "save the document"],
  "long-running-task": ["long-running", "long running task", "keep working on this", "run this in the background"],
  "authenticated-browser": ["log into", "log in to", "sign into", "authenticated browser", "browse while logged in"],
  "terminal-execution": ["run a command", "run this command", "execute a script", "terminal command", "shell command"],
  "agent-delegation": ["delegate this to an agent", "hand this off to an agent", "have an agent handle", "assign this to an agent"],
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
