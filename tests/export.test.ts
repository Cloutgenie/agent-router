import { describe, expect, it } from "vitest";
import { buildCsv, buildJson, toCrmRow } from "@/lib/export";
import { BuyerRecord } from "@/types";

function makeRecord(overrides: Partial<BuyerRecord> = {}): BuyerRecord {
  return {
    id: "rec-1",
    company: 'VectorShield, Inc. "Global"',
    normalizedName: "vectorshield-inc",
    domain: "vectorshield.example",
    website: "vectorshield.example",
    industry: "AI Security",
    fundingStage: "Series A",
    fundingSignal: "Raised $18M",
    hiringSignal: "Hiring 6 roles",
    aiSignal: "Launched AI detection",
    securitySignal: "Hiring Head of Security",
    whyNow: "Raised funding, hiring, AI launch",
    decisionMakerRole: "VP Security",
    decisionFactors: ["Recent funding"],
    evidence: [
      {
        id: "ev-1",
        type: "funding",
        title: "Funding record",
        source: "Funding DB",
        sourceQuality: "high",
        url: "https://example.com/a",
        retrievedAt: new Date().toISOString(),
        confidence: 0.9,
      },
    ],
    verification: { verified: true, confidence: 0.9, issues: [], evidenceCoverage: 1, claims: [], sourceCount: 1, verifiedClaimCount: 6, totalClaimCount: 6 },
    opportunityScore: { total: 91, funding: 20, hiring: 18, aiSignal: 20, companyFit: 13, contactability: 10, evidenceQuality: 8, freshness: 2 },
    confidence: 0.9,
    providersUsed: ["research-agent"],
    reviewState: "unreviewed",
    mergedDuplicates: 0,
    ...overrides,
  };
}

describe("export", () => {
  it("produces CRM-ready fields with sensible fallbacks for missing contact info", () => {
    const row = toCrmRow(makeRecord());
    expect(row.company).toContain("VectorShield");
    expect(row.email).toBe("");
    expect(row.evidence_urls).toContain("example.com");
  });

  it("escapes commas, quotes, and newlines in CSV output", () => {
    const csv = buildCsv([makeRecord()]);
    const lines = csv.split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain('"VectorShield, Inc. ""Global"""');
  });

  it("round-trips through JSON export", () => {
    const record = makeRecord();
    const json = buildJson([record]);
    const parsed = JSON.parse(json);
    expect(parsed[0].company).toBe(record.company);
    expect(parsed[0].opportunityScore.total).toBe(91);
  });
});
