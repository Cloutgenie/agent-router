import {
  Claim,
  ClaimType,
  Evidence,
  freshnessTierFor,
  FRESHNESS_SCORE,
  SOURCE_QUALITY_WEIGHT,
  VerificationResult,
} from "@/types";

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function ageDaysOf(evidence: Evidence): number {
  const published = evidence.publishedAt ?? evidence.retrievedAt;
  return Math.max(0, Math.round((Date.now() - new Date(published).getTime()) / (24 * 60 * 60 * 1000)));
}

function weightedConfidence(evidence: Evidence[]): number {
  if (evidence.length === 0) return 0;
  const weightSum = evidence.reduce((sum, e) => sum + SOURCE_QUALITY_WEIGHT[e.sourceQuality], 0);
  const scoreSum = evidence.reduce(
    (sum, e) => sum + e.confidence * SOURCE_QUALITY_WEIGHT[e.sourceQuality],
    0
  );
  return weightSum > 0 ? round2(scoreSum / weightSum) : 0;
}

/**
 * Minimum evidence thresholds (V4 #29): a claim needs either one
 * high-quality source, or two independent medium-or-better sources.
 */
function meetsEvidenceThreshold(evidence: Evidence[]): boolean {
  const highCount = evidence.filter((e) => e.sourceQuality === "high").length;
  const mediumPlusCount = evidence.filter(
    (e) => e.sourceQuality === "high" || e.sourceQuality === "medium"
  ).length;
  return highCount >= 1 || mediumPlusCount >= 2;
}

/** Contradiction detection (V4 #9): disagreeing publish dates across sources for the same claim. */
function detectContradiction(evidence: Evidence[]): string | undefined {
  if (evidence.length < 2) return undefined;
  const dated = evidence
    .map((e) => ({ e, date: new Date(e.publishedAt ?? e.retrievedAt) }))
    .sort((a, b) => a.date.getTime() - b.date.getTime());

  const earliest = dated[0];
  const latest = dated[dated.length - 1];
  const gapDays = Math.round((latest.date.getTime() - earliest.date.getTime()) / (24 * 60 * 60 * 1000));

  if (gapDays > 30) {
    const fmt = (d: Date) => d.toLocaleDateString(undefined, { year: "numeric", month: "long" });
    return `Date conflict detected - ${earliest.e.source}: ${fmt(earliest.date)} vs ${latest.e.source}: ${fmt(latest.date)}`;
  }
  return undefined;
}

function buildClaim(id: string, type: ClaimType, statement: string, evidence: Evidence[]): Claim {
  if (evidence.length === 0) {
    return {
      id,
      type,
      statement,
      evidenceIds: [],
      verified: false,
      confidence: 0,
      freshness: "weak",
    };
  }

  const contradiction = detectContradiction(evidence);
  const thresholdMet = meetsEvidenceThreshold(evidence);
  const freshestAgeDays = Math.min(...evidence.map(ageDaysOf));
  const freshness = freshnessTierFor(freshestAgeDays);
  const baseConfidence = weightedConfidence(evidence);
  // Freshness nudges confidence - a well-sourced but stale claim is still weaker.
  const confidence = round2(baseConfidence * (0.7 + 0.3 * FRESHNESS_SCORE[freshness]));

  return {
    id,
    type,
    statement,
    evidenceIds: evidence.map((e) => e.id),
    verified: thresholdMet && !contradiction,
    confidence: contradiction ? round2(confidence * 0.6) : confidence,
    freshness,
    contradiction,
  };
}

export interface VerifyRecordInput {
  companyFitEvidence: Evidence[];
  companyFitStatement: string;
  fundingEvidence: Evidence[];
  fundingStatement: string;
  hiringEvidence: Evidence[];
  hiringStatement: string;
  securityEvidence: Evidence[];
  securityStatement: string;
  aiEvidence: Evidence[];
  aiStatement: string;
  contactEvidence: Evidence[];
  contactStatement: string;
}

/**
 * Evaluator layer: independent, claim-level verification. Never trusts a
 * provider's self-reported confidence - every claim is re-scored from its
 * underlying evidence, source quality, freshness, and cross-source
 * agreement.
 */
export function verifyRecord(recordId: string, input: VerifyRecordInput): VerificationResult {
  const claims: Claim[] = [
    buildClaim(`${recordId}-company_fit`, "company_fit", input.companyFitStatement, input.companyFitEvidence),
    buildClaim(`${recordId}-funding`, "funding", input.fundingStatement, input.fundingEvidence),
    buildClaim(`${recordId}-hiring`, "hiring", input.hiringStatement, input.hiringEvidence),
    buildClaim(`${recordId}-security_signal`, "security_signal", input.securityStatement, input.securityEvidence),
    buildClaim(`${recordId}-ai_adoption`, "ai_adoption", input.aiStatement, input.aiEvidence),
    buildClaim(`${recordId}-contact`, "contact", input.contactStatement, input.contactEvidence),
  ];

  const verifiedClaimCount = claims.filter((c) => c.verified).length;
  const totalClaimCount = claims.length;
  const evidenceCoverage = totalClaimCount > 0 ? round2(verifiedClaimCount / totalClaimCount) : 0;

  const issues: string[] = [];
  for (const claim of claims) {
    if (claim.contradiction) {
      issues.push(`${claim.type.replace(/_/g, " ")}: ${claim.contradiction} - needs review.`);
    } else if (claim.evidenceIds.length === 0) {
      issues.push(`${claim.type.replace(/_/g, " ")}: no supporting evidence found.`);
    } else if (!claim.verified) {
      issues.push(`${claim.type.replace(/_/g, " ")}: insufficient independent source coverage.`);
    }
  }

  const sourceCount = new Set(claims.flatMap((c) => c.evidenceIds)).size;
  const confidence =
    claims.length > 0 ? round2(claims.reduce((sum, c) => sum + c.confidence, 0) / claims.length) : 0;

  // A record is verified overall once most of its claims individually clear the bar.
  const verified = totalClaimCount > 0 && verifiedClaimCount >= Math.ceil(totalClaimCount * 0.6);

  return {
    verified,
    confidence,
    issues,
    evidenceCoverage,
    claims,
    sourceCount,
    verifiedClaimCount,
    totalClaimCount,
  };
}
