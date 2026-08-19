import { describe, expect, it } from "vitest";
import { detectWorkflow, buildExecutionPlan } from "@/lib/planner/taskPlanner";
import { KeywordCapabilityClassifier } from "@/lib/capabilities/classifier";

const classifier = new KeywordCapabilityClassifier();

describe("detectWorkflow", () => {
  it("classifies the canonical buyer-discovery task", () => {
    const raw = "Find 20 cybersecurity startups that recently raised funding and appear likely to need AI security help.";
    const workflow = detectWorkflow(raw, classifier.classify(raw));
    expect(workflow).toBe("buyer-discovery");
  });

  it("classifies a plain competitor research task as generic", () => {
    const raw = "Research 20 competitors for a B2B SaaS product.";
    const workflow = detectWorkflow(raw, classifier.classify(raw));
    expect(workflow).toBe("generic");
  });

  it("classifies via explicit buyer/prospect language even with fewer signal capabilities", () => {
    const raw = "Find companies that are likely to buy our product.";
    const workflow = detectWorkflow(raw, classifier.classify(raw));
    expect(workflow).toBe("buyer-discovery");
  });
});

describe("buildExecutionPlan", () => {
  it("builds a 6-step multi-provider plan for buyer discovery with correct dependencies", () => {
    const plan = buildExecutionPlan("goal", [], "buyer-discovery");
    const ids = plan.steps.map((s) => s.id);
    expect(ids).toEqual(["discover", "funding", "ai-signal", "hiring", "contact", "validate"]);

    const discover = plan.steps.find((s) => s.id === "discover")!;
    expect(discover.dependencies).toEqual([]);

    const funding = plan.steps.find((s) => s.id === "funding")!;
    expect(funding.dependencies).toEqual(["discover"]);

    const validate = plan.steps.find((s) => s.id === "validate")!;
    expect(validate.dependencies.sort()).toEqual(["ai-signal", "contact", "funding", "hiring"].sort());
  });

  it("builds one independent step per capability for generic tasks", () => {
    const capabilities = ["company-research", "competitor-analysis", "market-research"] as const;
    const plan = buildExecutionPlan("goal", [...capabilities], "generic");
    expect(plan.steps).toHaveLength(3);
    expect(plan.steps.every((s) => s.dependencies.length === 0)).toBe(true);
  });
});
