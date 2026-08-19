import { describe, expect, it } from "vitest";
import { verifyRecord } from "@/lib/evaluation/verifier";
import { Evidence } from "@/types";

function evidence(overrides: Partial<Evidence>): Evidence {
  return {
    id: overrides.id ?? `ev-${Math.random()}`,
    type: overrides.type ?? "funding",
    title: overrides.title ?? "Evidence",
    source: overrides.source ?? "Source A",
    sourceQuality: overrides.sourceQuality ?? "high",
    confidence: overrides.confidence ?? 0.9,
    retrievedAt: overrides.retrievedAt ?? new Date().toISOString(),
    publishedAt: overrides.publishedAt ?? new Date().toISOString(),
    ...overrides,
  };
}

const baseInput = {
  companyFitEvidence: [evidence({ type: "website" })],
  companyFitStatement: "Matches target category",
  fundingEvidence: [evidence({ type: "funding" })],
  fundingStatement: "Raised Series A",
  hiringEvidence: [evidence({ type: "job_posting" })],
  hiringStatement: "Hiring security engineers",
  securityEvidence: [evidence({ type: "job_posting" })],
  securityStatement: "Hiring Head of Security",
  aiEvidence: [evidence({ type: "news" })],
  aiStatement: "Launched AI product",
  contactEvidence: [evidence({ type: "company_data" })],
  contactStatement: "VP Security",
};

describe("verifyRecord", () => {
  it("verifies a claim with a single high-quality source", () => {
    const result = verifyRecord("rec-1", baseInput);
    const funding = result.claims.find((c) => c.type === "funding")!;
    expect(funding.verified).toBe(true);
    expect(result.sourceCount).toBeGreaterThan(0);
  });

  it("does not verify a claim with no supporting evidence", () => {
    const result = verifyRecord("rec-2", { ...baseInput, contactEvidence: [] });
    const contact = result.claims.find((c) => c.type === "contact")!;
    expect(contact.verified).toBe(false);
    expect(result.issues.some((i) => i.includes("contact"))).toBe(true);
  });

  it("requires two medium sources when there is no high-quality source", () => {
    const oneMediumSource = { ...baseInput, fundingEvidence: [evidence({ type: "funding", sourceQuality: "medium" })] };
    const twoMediumSources = {
      ...baseInput,
      fundingEvidence: [
        evidence({ type: "funding", sourceQuality: "medium", publishedAt: new Date().toISOString() }),
        evidence({ type: "news", sourceQuality: "medium", publishedAt: new Date().toISOString() }),
      ],
    };

    expect(verifyRecord("rec-3a", oneMediumSource).claims.find((c) => c.type === "funding")!.verified).toBe(false);
    expect(verifyRecord("rec-3b", twoMediumSources).claims.find((c) => c.type === "funding")!.verified).toBe(true);
  });

  it("detects contradictions when two sources disagree on date by more than 30 days", () => {
    const now = Date.now();
    const conflicting = {
      ...baseInput,
      fundingEvidence: [
        evidence({ publishedAt: new Date(now).toISOString(), sourceQuality: "high" }),
        evidence({ publishedAt: new Date(now - 60 * 24 * 60 * 60 * 1000).toISOString(), sourceQuality: "medium" }),
      ],
    };

    const result = verifyRecord("rec-4", conflicting);
    const funding = result.claims.find((c) => c.type === "funding")!;
    expect(funding.contradiction).toBeDefined();
    expect(funding.verified).toBe(false);
    expect(result.issues.some((i) => i.includes("needs review"))).toBe(true);
  });

  it("scores freshness tiers correctly and folds them into claim confidence", () => {
    const fresh = { ...baseInput, fundingEvidence: [evidence({ publishedAt: new Date().toISOString() })] };
    const stale = {
      ...baseInput,
      fundingEvidence: [evidence({ publishedAt: new Date(Date.now() - 200 * 24 * 60 * 60 * 1000).toISOString() })],
    };

    const freshResult = verifyRecord("rec-5a", fresh).claims.find((c) => c.type === "funding")!;
    const staleResult = verifyRecord("rec-5b", stale).claims.find((c) => c.type === "funding")!;

    expect(freshResult.freshness).toBe("strongest");
    expect(staleResult.freshness).toBe("weak");
    expect(freshResult.confidence).toBeGreaterThan(staleResult.confidence);
  });
});
