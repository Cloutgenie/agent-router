import { verifyRecord } from "@/lib/evaluation/verifier";
import { scoreOpportunity } from "@/lib/scoring/opportunity";
import { claimOf, stepByCompany } from "./buyerComposer";
import {
  BuyerRecord,
  DecisionMakerContact,
  Evidence,
  ExecutionPlan,
  ExecutionStep,
  FollowUpAction,
} from "@/types";

export const FOLLOW_UP_LABELS: Record<FollowUpAction, string> = {
  "find-decision-makers": "Find decision makers",
  "enrich-contacts": "Enrich contacts",
  "verify-emails": "Verify emails",
  "deeper-research": "Run deeper research",
};

export function describeFollowUp(action: FollowUpAction, companies: string[]): string {
  const list =
    companies.length <= 3 ? companies.join(", ") : `${companies.slice(0, 3).join(", ")} and ${companies.length - 3} more`;
  switch (action) {
    case "find-decision-makers":
      return `Find decision makers at: ${list}`;
    case "enrich-contacts":
      return `Enrich contact details for: ${list}`;
    case "verify-emails":
      return `Verify decision-maker emails for: ${list}`;
    case "deeper-research":
      return `Run deeper research on: ${list}`;
  }
}

function emptyStep(id: string, capability: ExecutionStep["capability"], description: string, dependencies: string[]): ExecutionStep {
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

function seededDiscoverStep(records: BuyerRecord[]): ExecutionStep {
  return {
    id: "discover",
    capability: "company-research",
    description: "Companies carried forward from the parent task",
    dependencies: [],
    candidates: [],
    fallbackProviderIds: [],
    usedFallback: false,
    status: "completed",
    result: {
      status: "completed",
      data: {
        companies: records.map((r) => ({ name: r.company, website: r.website, industry: r.industry })),
      },
      evidence: [],
      confidence: 1,
      cost: 0,
      duration_seconds: 0,
    },
  };
}

/**
 * Builds a scoped execution plan for a follow-up task - reuses the parent's
 * discovered companies (no re-discovery) and only routes the steps the
 * requested action actually needs.
 */
export function buildFollowUpPlan(records: BuyerRecord[], action: FollowUpAction): ExecutionPlan {
  const discover = seededDiscoverStep(records);
  const steps: ExecutionStep[] = [discover];

  if (action === "find-decision-makers" || action === "enrich-contacts" || action === "verify-emails") {
    const contactStep = emptyStep("contact", "contact-enrichment", "Enrich decision-maker contact details", ["discover"]);
    contactStep.extraContext = { deepEnrichment: true };
    steps.push(contactStep);
  } else if (action === "deeper-research") {
    steps.push(emptyStep("funding", "funding-research", "Re-verify recent funding activity", ["discover"]));
    steps.push(emptyStep("ai-signal", "ai-adoption-signal", "Re-check AI adoption signals", ["discover"]));
    steps.push(emptyStep("hiring", "hiring-signals", "Re-check hiring and security signals", ["discover"]));
    const contactStep = emptyStep("contact", "contact-enrichment", "Enrich decision-maker contact details", ["discover"]);
    contactStep.extraContext = { deepEnrichment: true };
    steps.push(contactStep);
    steps.push(
      emptyStep("validate", "data-validation", "Cross-check evidence across all collected signals", [
        "funding",
        "ai-signal",
        "hiring",
        "contact",
      ])
    );
  }

  return { goal: describeFollowUp(action, records.map((r) => r.company)), steps };
}

function evidenceForClaim(record: BuyerRecord, type: BuyerRecord["verification"]["claims"][number]["type"]): Evidence[] {
  const claim = record.verification.claims.find((c) => c.type === type);
  if (!claim) return [];
  return record.evidence.filter((e) => claim.evidenceIds.includes(e.id));
}

/**
 * Merges a follow-up plan's fresh findings back into the parent's records,
 * re-verifying and re-scoring only what changed. Prior evidence for
 * untouched claims is preserved rather than discarded - this is how
 * recursive task execution builds on itself instead of starting over.
 */
export function applyFollowUp(records: BuyerRecord[], plan: ExecutionPlan, action: FollowUpAction): BuyerRecord[] {
  const contactByCompany = stepByCompany(plan, "contact");
  const fundingByCompany = stepByCompany(plan, "funding");
  const aiByCompany = stepByCompany(plan, "ai-signal");
  const hiringByCompany = stepByCompany(plan, "hiring");

  return records.map((record) => {
    const contactInfo = contactByCompany[record.company];
    const fundingInfo = fundingByCompany[record.company];
    const aiInfo = aiByCompany[record.company];
    const hiringInfo = hiringByCompany[record.company];

    const decisionMakerRole = (contactInfo?.decisionMakerRole as string) ?? record.decisionMakerRole;
    const contact = (contactInfo?.contact as DecisionMakerContact | undefined) ?? record.contact;
    const fundingSignal = (fundingInfo?.fundingSignal as string) ?? record.fundingSignal;
    const fundingStage = (fundingInfo?.fundingStage as string) ?? record.fundingStage;
    const aiSignal = (aiInfo?.aiSignal as string) ?? record.aiSignal;
    const hiringSignal = (hiringInfo?.hiringSignal as string) ?? record.hiringSignal;
    const securitySignal = (hiringInfo?.securitySignal as string) ?? record.securitySignal;

    const contactEvidence = contactInfo?.evidence ?? evidenceForClaim(record, "contact");
    const fundingEvidence = fundingInfo?.evidence ?? evidenceForClaim(record, "funding");
    const aiEvidence = aiInfo?.evidence ?? evidenceForClaim(record, "ai_adoption");
    const hiringEvidence = hiringInfo?.evidence ?? evidenceForClaim(record, "hiring");

    const verification = verifyRecord(record.id, {
      companyFitEvidence: evidenceForClaim(record, "company_fit"),
      companyFitStatement: claimOf(record.verification.claims, "company_fit").statement,
      fundingEvidence,
      fundingStatement: fundingSignal,
      hiringEvidence,
      hiringStatement: hiringSignal,
      securityEvidence: hiringEvidence,
      securityStatement: securitySignal,
      aiEvidence,
      aiStatement: aiSignal,
      contactEvidence,
      contactStatement: decisionMakerRole,
    });

    const opportunityScore = scoreOpportunity({
      fundingClaim: claimOf(verification.claims, "funding"),
      hiringClaim: claimOf(verification.claims, "hiring"),
      securityClaim: claimOf(verification.claims, "security_signal"),
      aiClaim: claimOf(verification.claims, "ai_adoption"),
      companyFitClaim: claimOf(verification.claims, "company_fit"),
      contactClaim: claimOf(verification.claims, "contact"),
      evidenceCoverage: verification.evidenceCoverage,
    });

    const newProviderId = plan.steps.find((s) => s.id === "contact" || s.id === "funding")?.selectedProviderId;
    const providersUsed = Array.from(new Set([...record.providersUsed, newProviderId].filter((v): v is string => Boolean(v))));

    const evidence = Array.from(
      new Map(
        [...evidenceForClaim(record, "company_fit"), ...fundingEvidence, ...hiringEvidence, ...aiEvidence, ...contactEvidence].map(
          (e) => [e.id, e]
        )
      ).values()
    );

    return {
      ...record,
      fundingStage,
      fundingSignal,
      hiringSignal,
      securitySignal,
      aiSignal,
      decisionMakerRole,
      contact,
      evidence,
      verification,
      opportunityScore,
      confidence: verification.confidence,
      providersUsed,
      decisionFactors:
        action === "deeper-research" ? record.decisionFactors : [...record.decisionFactors, `Re-verified via ${FOLLOW_UP_LABELS[action]}`],
    };
  });
}
