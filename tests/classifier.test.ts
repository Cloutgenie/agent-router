import { describe, expect, it } from "vitest";
import { KeywordCapabilityClassifier } from "@/lib/capabilities/classifier";

describe("KeywordCapabilityClassifier", () => {
  const classifier = new KeywordCapabilityClassifier();

  it("infers the canonical buyer-discovery capability set", () => {
    const capabilities = classifier.classify(
      "Find 20 cybersecurity startups that recently raised funding and appear likely to need AI security help."
    );
    expect(capabilities).toContain("company-research");
    expect(capabilities).toContain("funding-research");
    expect(capabilities).toContain("cybersecurity-research");
    expect(capabilities).toContain("ai-adoption-signal");
  });

  it("infers contact/lead capabilities for decision-maker tasks", () => {
    const capabilities = classifier.classify("Find decision-makers at 100 healthcare software companies.");
    expect(capabilities).toContain("contact-enrichment");
    expect(capabilities).toContain("lead-generation");
    expect(capabilities).toContain("company-research");
  });

  it("falls back to web-research + summarization when nothing matches", () => {
    const capabilities = classifier.classify("zzz qqq xyz");
    expect(capabilities).toEqual(["web-research", "summarization"]);
  });

  it("is deterministic for the same input", () => {
    const a = classifier.classify("Research 20 competitors for a B2B SaaS product.");
    const b = classifier.classify("Research 20 competitors for a B2B SaaS product.");
    expect(a).toEqual(b);
  });
});
