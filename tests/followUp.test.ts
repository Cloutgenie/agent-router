import { describe, expect, it } from "vitest";
import { applyFollowUp, buildFollowUpPlan } from "@/lib/composer/followUp";
import { BuyerRecord, ExecutionPlan } from "@/types";

function makeRecord(): BuyerRecord {
  const fundingEvidence = {
    id: "ev-funding",
    type: "funding" as const,
    title: "Funding",
    source: "Funding DB",
    sourceQuality: "high" as const,
    retrievedAt: new Date().toISOString(),
    confidence: 0.9,
  };
  return {
    id: "rec-1",
    company: "VectorShield",
    normalizedName: "vectorshield",
    domain: "vectorshield.example",
    website: "vectorshield.example",
    industry: "AI Security",
    fundingStage: "Series A",
    fundingSignal: "Raised $18M",
    hiringSignal: "Hiring 6 roles",
    aiSignal: "Launched AI detection",
    securitySignal: "Hiring Head of Security",
    whyNow: "Raised funding",
    decisionMakerRole: "Unknown",
    decisionFactors: ["Raised $18M"],
    evidence: [fundingEvidence],
    verification: {
      verified: true,
      confidence: 0.9,
      issues: [],
      evidenceCoverage: 1,
      claims: [
        { id: "c1", type: "funding", statement: "Raised $18M", evidenceIds: ["ev-funding"], verified: true, confidence: 0.9, freshness: "strongest" },
      ],
      sourceCount: 1,
      verifiedClaimCount: 1,
      totalClaimCount: 1,
    },
    opportunityScore: { total: 50, funding: 20, hiring: 0, aiSignal: 0, companyFit: 0, contactability: 0, evidenceQuality: 10, freshness: 5 },
    confidence: 0.9,
    providersUsed: ["funding-intelligence"],
    reviewState: "unreviewed",
    mergedDuplicates: 0,
  };
}

describe("buildFollowUpPlan", () => {
  it("seeds a completed discover step from the parent records - no re-discovery", () => {
    const plan = buildFollowUpPlan([makeRecord()], "find-decision-makers");
    const discover = plan.steps.find((s) => s.id === "discover")!;
    expect(discover.status).toBe("completed");
    expect(discover.result?.data.companies).toEqual([{ name: "VectorShield", website: "vectorshield.example", industry: "AI Security" }]);
  });

  it("only routes the contact step for find-decision-makers", () => {
    const plan = buildFollowUpPlan([makeRecord()], "find-decision-makers");
    expect(plan.steps.map((s) => s.id)).toEqual(["discover", "contact"]);
    expect(plan.steps.find((s) => s.id === "contact")?.extraContext).toEqual({ deepEnrichment: true });
  });

  it("routes funding/ai/hiring/contact/validate for deeper-research", () => {
    const plan = buildFollowUpPlan([makeRecord()], "deeper-research");
    expect(plan.steps.map((s) => s.id)).toEqual(["discover", "funding", "ai-signal", "hiring", "contact", "validate"]);
  });
});

describe("applyFollowUp", () => {
  it("merges new contact evidence while preserving prior funding evidence", () => {
    const record = makeRecord();
    const plan: ExecutionPlan = {
      goal: "follow-up",
      steps: [
        {
          id: "contact",
          capability: "contact-enrichment",
          description: "contact",
          dependencies: ["discover"],
          candidates: [],
          fallbackProviderIds: [],
          usedFallback: false,
          status: "completed",
          selectedProviderId: "contact-miner",
          result: {
            status: "completed",
            data: {
              byCompany: {
                VectorShield: {
                  decisionMakerRole: "VP Security",
                  evidence: [
                    {
                      id: "ev-contact",
                      type: "company_data",
                      title: "Decision maker",
                      source: "team page",
                      sourceQuality: "medium",
                      retrievedAt: new Date().toISOString(),
                      confidence: 0.8,
                    },
                  ],
                  contact: {
                    fullName: "Jordan Reyes",
                    role: "VP Security",
                    company: "VectorShield",
                    email: "jordan.reyes@vectorshield.example",
                    emailConfidence: 0.75,
                    source: "Contact Miner",
                    verificationStatus: "verified",
                  },
                },
              },
            },
            evidence: [],
            confidence: 0.8,
            cost: 1.1,
            duration_seconds: 2,
          },
        },
      ],
    };

    const [merged] = applyFollowUp([record], plan, "find-decision-makers");
    expect(merged.decisionMakerRole).toBe("VP Security");
    expect(merged.contact?.email).toBe("jordan.reyes@vectorshield.example");
    // Prior funding evidence must survive the merge.
    expect(merged.evidence.some((e) => e.id === "ev-funding")).toBe(true);
    expect(merged.evidence.some((e) => e.id === "ev-contact")).toBe(true);
    expect(merged.fundingSignal).toBe(record.fundingSignal);
  });
});
