import {
  Claim,
  DEFAULT_OPPORTUNITY_WEIGHTS,
  FRESHNESS_SCORE,
  OpportunityScore,
  OpportunityScoreWeights,
} from "@/types";

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function claimStrength(claim: Claim, unverifiedPenalty = 0.5): number {
  if (claim.evidenceIds.length === 0) return 0;
  return claim.confidence * (claim.verified ? 1 : unverifiedPenalty);
}

export interface OpportunityScoreInput {
  fundingClaim: Claim;
  hiringClaim: Claim;
  securityClaim: Claim;
  aiClaim: Claim;
  companyFitClaim: Claim;
  contactClaim: Claim;
  evidenceCoverage: number;
  weights?: OpportunityScoreWeights;
}

/**
 * Result Composer input, computed by the Evaluator's claims: a transparent,
 * configurable 0-100 opportunity score. Every sub-score is exposed in the
 * UI's score breakdown - nothing is a black box.
 */
export function scoreOpportunity(input: OpportunityScoreInput): OpportunityScore {
  const weights = input.weights ?? DEFAULT_OPPORTUNITY_WEIGHTS;

  const fundingFactor = claimStrength(input.fundingClaim);
  const hiringFactor =
    (claimStrength(input.hiringClaim) + claimStrength(input.securityClaim)) / 2;
  const aiSignalFactor = claimStrength(input.aiClaim);
  const companyFitFactor = claimStrength(input.companyFitClaim, 0.7);
  const contactabilityFactor = claimStrength(input.contactClaim);
  const evidenceQualityFactor = Math.min(1, Math.max(0, input.evidenceCoverage));

  const freshnessRelevantClaims = [input.fundingClaim, input.hiringClaim, input.aiClaim].filter(
    (c) => c.evidenceIds.length > 0
  );
  const freshnessFactor =
    freshnessRelevantClaims.length > 0
      ? freshnessRelevantClaims.reduce((sum, c) => sum + FRESHNESS_SCORE[c.freshness], 0) /
        freshnessRelevantClaims.length
      : 0;

  const funding = round1(fundingFactor * weights.funding);
  const hiring = round1(hiringFactor * weights.hiring);
  const aiSignal = round1(aiSignalFactor * weights.aiSignal);
  const companyFit = round1(companyFitFactor * weights.companyFit);
  const contactability = round1(contactabilityFactor * weights.contactability);
  const evidenceQuality = round1(evidenceQualityFactor * weights.evidenceQuality);
  const freshness = round1(freshnessFactor * weights.freshness);

  const total = Math.round(funding + hiring + aiSignal + companyFit + contactability + evidenceQuality + freshness);

  return { total, funding, hiring, aiSignal, companyFit, contactability, evidenceQuality, freshness };
}
