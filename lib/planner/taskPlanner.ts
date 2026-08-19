import { Capability, ExecutionPlan, ExecutionStep, WorkflowType } from "@/types";

const BUYER_SIGNAL_CAPABILITIES: Capability[] = [
  "funding-research",
  "hiring-signals",
  "cybersecurity-research",
  "ai-adoption-signal",
  "financial-research",
];

const BUYER_INTENT_PATTERN =
  /\bbuyers?\b|\bprospects?\b|\bprospecting\b|likely to (need|buy)|appear likely|buying signal/i;

/**
 * Task Planner, step 1: decide which workflow this goal belongs to. Buyer
 * discovery gets the rich structured deliverable (the V3 flagship); every
 * other goal gets the simpler generic deliverable carried over from V2.
 */
export function detectWorkflow(rawTask: string, capabilities: Capability[]): WorkflowType {
  const signalCount = capabilities.filter((c) => BUYER_SIGNAL_CAPABILITIES.includes(c)).length;
  const hasCompanyResearch = capabilities.includes("company-research");
  const explicitIntent = BUYER_INTENT_PATTERN.test(rawTask);

  if (hasCompanyResearch && (signalCount >= 2 || explicitIntent)) {
    return "buyer-discovery";
  }
  return "generic";
}

/**
 * Task Planner, step 2: turn the goal + capability graph into a structured
 * execution plan. Buyer discovery uses a fixed, purpose-built plan (the
 * shape a human analyst would actually follow); generic tasks get one step
 * per inferred capability, discovery-first if company research is present.
 */
export function buildExecutionPlan(
  rawTask: string,
  capabilities: Capability[],
  workflow: WorkflowType
): ExecutionPlan {
  const steps = workflow === "buyer-discovery"
    ? buildBuyerDiscoverySteps()
    : buildGenericSteps(capabilities);

  return { goal: rawTask, steps };
}

function emptyStep(id: string, capability: Capability, description: string, dependencies: string[]): ExecutionStep {
  return {
    id,
    capability,
    description,
    dependencies,
    candidates: [],
    fallbackProviderIds: [],
    usedFallback: false,
    status: "pending",
  };
}

/**
 * Buyer discovery always runs this fixed 6-step plan - discover, then four
 * signal-collection steps in parallel, then a validation pass. This is a
 * deliberately fixed template (the shape a human analyst would follow for
 * this exact workflow), not derived dynamically from `capabilities`.
 */
function buildBuyerDiscoverySteps(): ExecutionStep[] {
  return [
    emptyStep("discover", "company-research", "Discover relevant companies matching the target category", []),
    emptyStep("funding", "funding-research", "Verify recent funding activity", ["discover"]),
    emptyStep("ai-signal", "ai-adoption-signal", "Detect AI adoption or AI-related product signals", ["discover"]),
    emptyStep("hiring", "hiring-signals", "Detect security hiring or infrastructure growth", ["discover"]),
    emptyStep("contact", "contact-enrichment", "Find the likely security/technical decision maker", ["discover"]),
    emptyStep("validate", "data-validation", "Cross-check evidence across all collected signals", [
      "funding",
      "ai-signal",
      "hiring",
      "contact",
    ]),
  ];
}

const CAPABILITY_DESCRIPTIONS: Partial<Record<Capability, string>> = {
  "company-research": "Discover and profile relevant companies",
  "web-research": "Gather supporting information from the open web",
  "funding-research": "Research funding history and investment activity",
  "hiring-signals": "Detect hiring activity and headcount signals",
  "lead-generation": "Identify qualified leads",
  "contact-enrichment": "Enrich decision-maker contact details",
  "cybersecurity-research": "Research security posture and vendor landscape",
  "financial-research": "Research financial and valuation signals",
  "data-validation": "Validate collected data for accuracy",
  summarization: "Summarize findings into a digestible brief",
  "competitor-analysis": "Map the competitive landscape",
  "market-research": "Size the market and identify trends",
  "ai-adoption-signal": "Detect AI adoption or AI product signals",
};

/**
 * Generic (non buyer-discovery) tasks get one independent step per inferred
 * capability - no dependency chaining, so every step is eligible to run in
 * parallel immediately. This mirrors how V2 ran its single-shot team.
 */
function buildGenericSteps(capabilities: Capability[]): ExecutionStep[] {
  return capabilities.map((capability) =>
    emptyStep(
      capability,
      capability,
      CAPABILITY_DESCRIPTIONS[capability] ?? `Perform ${capability.replace(/-/g, " ")}`,
      []
    )
  );
}
