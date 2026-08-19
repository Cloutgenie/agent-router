import { Capability, ExecutionApproval, ExecutionPolicy, RiskClass } from "@/types";

/**
 * Execution policy registry (spec #27) - the risk class for every
 * capability the platform knows about. Research/enrichment/interpretation
 * capabilities (Tavily, Apollo, the LLM adapters, browser verification, and
 * every *-read capability) are READ_ONLY; anything that writes or sends on
 * the user's behalf is classified above that, which is what
 * lib/execution/stepEngine.ts uses to decide whether a step may even be
 * routed to a provider (spec #10, #26, #28).
 */
const CAPABILITY_RISK_CLASS: Record<Capability, RiskClass> = {
  "company-research": "READ_ONLY",
  "web-research": "READ_ONLY",
  "funding-research": "READ_ONLY",
  "hiring-signals": "READ_ONLY",
  "lead-generation": "READ_ONLY",
  "contact-enrichment": "READ_ONLY",
  "cybersecurity-research": "READ_ONLY",
  "financial-research": "READ_ONLY",
  "data-validation": "READ_ONLY",
  summarization: "READ_ONLY",
  "competitor-analysis": "READ_ONLY",
  "market-research": "READ_ONLY",
  "ai-adoption-signal": "READ_ONLY",
  "official-source-verification": "READ_ONLY",
  "crm-read": "READ_ONLY",
  "crm-write": "LOW_RISK_WRITE",
  "email-read": "READ_ONLY",
  "email-send": "EXTERNAL_COMMUNICATION",
  "calendar-read": "READ_ONLY",
  "calendar-write": "LOW_RISK_WRITE",
  "file-read": "READ_ONLY",
  "file-write": "LOW_RISK_WRITE",
};

const RISK_CLASS_LABEL: Record<RiskClass, string> = {
  READ_ONLY: "read-only",
  LOW_RISK_WRITE: "low-risk write",
  EXTERNAL_COMMUNICATION: "external-communication",
  HIGH_RISK_WRITE: "high-risk write",
  FINANCIAL: "financial",
};

export function getRiskClass(capability: Capability): RiskClass {
  return CAPABILITY_RISK_CLASS[capability] ?? "READ_ONLY";
}

export function describeRiskClass(riskClass: RiskClass): string {
  return RISK_CLASS_LABEL[riskClass];
}

export function requiresApproval(riskClass: RiskClass): boolean {
  return riskClass !== "READ_ONLY";
}

export function isActionPreApproved(capability: Capability, approvedActions: Capability[] | undefined): boolean {
  return (approvedActions ?? []).includes(capability);
}

/**
 * The single decision point every non-read-only step passes through before
 * the execution engine will route it to a provider. Never defaults to
 * approved - the caller must explicitly pre-approve a capability via
 * `TaskConstraints.approved_actions` (spec #28: "All non-read-only actions
 * should require explicit approval by default").
 */
export function evaluateApproval(capability: Capability, approvedActions: Capability[] | undefined): ExecutionApproval {
  const riskClass = getRiskClass(capability);
  if (!requiresApproval(riskClass)) {
    return { required: false, status: "not_required" };
  }
  const approved = isActionPreApproved(capability, approvedActions);
  return {
    required: true,
    status: approved ? "approved" : "pending",
    reason: approved
      ? undefined
      : `This action is classified "${describeRiskClass(riskClass)}" and was not pre-approved, so it did not run.`,
  };
}

export function allExecutionPolicies(): ExecutionPolicy[] {
  return (Object.entries(CAPABILITY_RISK_CLASS) as [Capability, RiskClass][]).map(([capability, riskClass]) => ({
    capability,
    riskClass,
  }));
}
