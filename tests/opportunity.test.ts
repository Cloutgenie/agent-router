import { describe, expect, it } from "vitest";
import { scoreOpportunity } from "@/lib/scoring/opportunity";
import { Claim } from "@/types";

function claim(overrides: Partial<Claim>): Claim {
  return {
    id: overrides.id ?? "c1",
    type: overrides.type ?? "funding",
    statement: "statement",
    evidenceIds: overrides.evidenceIds ?? ["ev-1"],
    verified: overrides.verified ?? true,
    confidence: overrides.confidence ?? 0.9,
    freshness: overrides.freshness ?? "strongest",
    ...overrides,
  };
}

const allStrong = {
  fundingClaim: claim({ type: "funding" }),
  hiringClaim: claim({ type: "hiring" }),
  securityClaim: claim({ type: "security_signal" }),
  aiClaim: claim({ type: "ai_adoption" }),
  companyFitClaim: claim({ type: "company_fit" }),
  contactClaim: claim({ type: "contact" }),
  evidenceCoverage: 1,
};

describe("scoreOpportunity", () => {
  it("produces a total near the maximum when every claim is strong and verified", () => {
    const score = scoreOpportunity(allStrong);
    expect(score.total).toBeGreaterThan(80);
    const sumOfParts =
      score.funding + score.hiring + score.aiSignal + score.companyFit + score.contactability + score.evidenceQuality + score.freshness;
    // `total` is Math.round()-ed from the sum of already-rounded parts, so it can be off by at most ~1.
    expect(Math.abs(sumOfParts - score.total)).toBeLessThanOrEqual(1);
  });

  it("scores near zero when no claims have any evidence", () => {
    const noEvidence = {
      fundingClaim: claim({ evidenceIds: [], verified: false, confidence: 0 }),
      hiringClaim: claim({ evidenceIds: [], verified: false, confidence: 0 }),
      securityClaim: claim({ evidenceIds: [], verified: false, confidence: 0 }),
      aiClaim: claim({ evidenceIds: [], verified: false, confidence: 0 }),
      companyFitClaim: claim({ evidenceIds: [], verified: false, confidence: 0 }),
      contactClaim: claim({ evidenceIds: [], verified: false, confidence: 0 }),
      evidenceCoverage: 0,
    };
    const score = scoreOpportunity(noEvidence);
    expect(score.total).toBe(0);
  });

  it("penalizes unverified claims relative to verified ones", () => {
    const verified = scoreOpportunity(allStrong);
    const unverifiedFunding = scoreOpportunity({ ...allStrong, fundingClaim: claim({ type: "funding", verified: false }) });
    expect(unverifiedFunding.funding).toBeLessThan(verified.funding);
  });

  it("respects custom weights", () => {
    const heavyFunding = scoreOpportunity({
      ...allStrong,
      weights: { funding: 100, hiring: 0, aiSignal: 0, companyFit: 0, contactability: 0, evidenceQuality: 0, freshness: 0 },
    });
    expect(heavyFunding.hiring).toBe(0);
    expect(heavyFunding.funding).toBeGreaterThanOrEqual(90);
  });
});
