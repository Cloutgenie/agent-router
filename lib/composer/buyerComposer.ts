import { verifyRecord } from "@/lib/evaluation/verifier";
import { scoreOpportunity } from "@/lib/scoring/opportunity";
import { BuyerRecord, Claim, ClaimType, Evidence, ExecutionPlan, TaskConstraints } from "@/types";

export interface CompanyByCapability {
  [company: string]: { evidence?: Evidence[]; [field: string]: unknown };
}

export function stepByCompany(plan: ExecutionPlan, stepId: string): CompanyByCapability {
  const step = plan.steps.find((s) => s.id === stepId);
  if (!step?.result || step.status !== "completed") return {};
  return (step.result.data.byCompany as CompanyByCapability | undefined) ?? {};
}

export function claimOf(claims: Claim[], type: ClaimType): Claim {
  const found = claims.find((c) => c.type === type);
  if (!found) {
    return { id: `missing-${type}`, type, statement: "", evidenceIds: [], verified: false, confidence: 0, freshness: "weak" };
  }
  return found;
}

export function normalize(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

const LOW_CONFIDENCE_EXCLUSION_THRESHOLD = 0.4;

export interface BuyerComposerResult {
  buyer_results: BuyerRecord[];
  excluded_results: BuyerRecord[];
}

/**
 * Result Composer for the flagship buyer-discovery workflow. Reads raw
 * provider evidence straight off the completed execution plan - it never
 * re-runs providers, and it never trusts a provider's claim without routing
 * it through the Evaluator first.
 */
export function composeBuyerResults(
  plan: ExecutionPlan,
  constraints: TaskConstraints
): BuyerComposerResult {
  const discover = plan.steps.find((s) => s.id === "discover");
  const companies = (discover?.result?.data.companies as { name: string; website: string; industry: string }[] | undefined) ?? [];

  const discoverByCompany = stepByCompany(plan, "discover");
  const fundingByCompany = stepByCompany(plan, "funding");
  const hiringByCompany = stepByCompany(plan, "hiring");
  const aiByCompany = stepByCompany(plan, "ai-signal");
  const contactByCompany = stepByCompany(plan, "contact");
  const browserByCompany = stepByCompany(plan, "browser-verify");

  const resultCount = constraints.result_count ?? 15;
  const records: BuyerRecord[] = [];

  companies.forEach((company, index) => {
    const discoverInfo = discoverByCompany[company.name] ?? {};
    const fundingInfo = fundingByCompany[company.name] ?? {};
    const hiringInfo = hiringByCompany[company.name] ?? {};
    const aiInfo = aiByCompany[company.name] ?? {};
    const contactInfo = contactByCompany[company.name] ?? {};
    const browserInfo = browserByCompany[company.name] ?? {};
    const browserVerified = Boolean(browserInfo.hiringPageConfirmed !== undefined);
    const hiringEvidenceForVerification = [...(hiringInfo.evidence ?? []), ...(browserInfo.evidence ?? [])];

    const fundingSignal = (fundingInfo.fundingSignal as string) ?? "No recent funding signal found";
    const fundingStage = (fundingInfo.fundingStage as string) ?? "Unknown";
    const hiringSignal = (hiringInfo.hiringSignal as string) ?? "No hiring signal found";
    const securitySignal = (hiringInfo.securitySignal as string) ?? "No security-specific hiring signal found";
    const aiSignal = (aiInfo.aiSignal as string) ?? "No AI adoption signal found";
    const decisionMakerRole = (contactInfo.decisionMakerRole as string) ?? "Unknown";

    const id = `${normalize(company.name)}-${index}`;

    const verification = verifyRecord(id, {
      companyFitEvidence: discoverInfo.evidence ?? [],
      companyFitStatement: `Matches target category: ${company.industry}`,
      fundingEvidence: fundingInfo.evidence ?? [],
      fundingStatement: fundingSignal,
      hiringEvidence: hiringEvidenceForVerification,
      hiringStatement: hiringSignal,
      securityEvidence: hiringEvidenceForVerification,
      securityStatement: securitySignal,
      aiEvidence: aiInfo.evidence ?? [],
      aiStatement: aiSignal,
      contactEvidence: contactInfo.evidence ?? [],
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

    const decisionFactors = buildDecisionFactors(verification.claims, {
      fundingSignal,
      hiringSignal,
      securitySignal,
      aiSignal,
      decisionMakerRole,
      sourceCount: verification.sourceCount,
    });
    if (browserVerified) {
      decisionFactors.push(
        browserInfo.hiringPageConfirmed
          ? "Hiring signal confirmed directly on the official careers page"
          : "Hiring signal downgraded - not found on the official careers page during direct verification"
      );
    }

    const whyNow = buildWhyNow(verification.claims, { fundingSignal, hiringSignal, aiSignal });

    const allEvidence = [
      ...(discoverInfo.evidence ?? []),
      ...(fundingInfo.evidence ?? []),
      ...(hiringInfo.evidence ?? []),
      ...(browserInfo.evidence ?? []),
      ...(aiInfo.evidence ?? []),
      ...(contactInfo.evidence ?? []),
    ];

    const providersUsed = Array.from(
      new Set(
        [
          discover?.selectedProviderId,
          fundingByCompany[company.name] ? plan.steps.find((s) => s.id === "funding")?.selectedProviderId : undefined,
          hiringByCompany[company.name] ? plan.steps.find((s) => s.id === "hiring")?.selectedProviderId : undefined,
          browserVerified ? plan.steps.find((s) => s.id === "browser-verify")?.selectedProviderId : undefined,
          aiByCompany[company.name] ? plan.steps.find((s) => s.id === "ai-signal")?.selectedProviderId : undefined,
          contactByCompany[company.name] ? plan.steps.find((s) => s.id === "contact")?.selectedProviderId : undefined,
        ].filter((v): v is string => Boolean(v))
      )
    );

    records.push({
      id,
      company: company.name,
      normalizedName: normalize(company.name),
      domain: company.website,
      website: company.website,
      industry: company.industry,
      fundingStage,
      fundingSignal,
      hiringSignal,
      aiSignal,
      securitySignal,
      whyNow,
      decisionMakerRole,
      decisionFactors,
      evidence: allEvidence,
      verification,
      opportunityScore,
      confidence: verification.confidence,
      providersUsed,
      reviewState: "unreviewed",
      mergedDuplicates: 0,
    });
  });

  records.sort((a, b) => b.opportunityScore.total - a.opportunityScore.total);

  const buyer_results: BuyerRecord[] = [];
  const excluded_results: BuyerRecord[] = [];

  for (const record of records) {
    const isWeak = !record.verification.verified && record.confidence < LOW_CONFIDENCE_EXCLUSION_THRESHOLD;
    if (isWeak) excluded_results.push(record);
    else buyer_results.push(record);
  }

  return {
    buyer_results: buyer_results.slice(0, resultCount),
    excluded_results,
  };
}

function buildDecisionFactors(
  claims: Claim[],
  text: {
    fundingSignal: string;
    hiringSignal: string;
    securitySignal: string;
    aiSignal: string;
    decisionMakerRole: string;
    sourceCount: number;
  }
): string[] {
  const factors: string[] = [];
  const funding = claims.find((c) => c.type === "funding");
  const hiring = claims.find((c) => c.type === "hiring");
  const security = claims.find((c) => c.type === "security_signal");
  const ai = claims.find((c) => c.type === "ai_adoption");
  const contact = claims.find((c) => c.type === "contact");

  if (funding?.verified) factors.push(text.fundingSignal);
  if (hiring?.verified) factors.push(text.hiringSignal);
  if (security?.verified && text.securitySignal !== text.hiringSignal) factors.push(text.securitySignal);
  if (ai?.verified) factors.push(text.aiSignal);
  if (contact?.verified) factors.push(`${text.decisionMakerRole} identified as the likely buyer`);
  factors.push(`${text.sourceCount} independent evidence source${text.sourceCount === 1 ? "" : "s"}`);

  return factors;
}

function buildWhyNow(
  claims: Claim[],
  text: { fundingSignal: string; hiringSignal: string; aiSignal: string }
): string {
  const parts: string[] = [];
  const funding = claims.find((c) => c.type === "funding");
  const hiring = claims.find((c) => c.type === "hiring");
  const ai = claims.find((c) => c.type === "ai_adoption");

  if (funding?.verified) parts.push(text.fundingSignal);
  if (hiring?.verified) parts.push(text.hiringSignal);
  if (ai?.verified) parts.push(text.aiSignal);

  if (parts.length === 0) return "Limited independently verified signal - review evidence before prioritizing.";
  return `${parts.join(". ")}.`;
}
