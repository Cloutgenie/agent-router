import { describe, expect, it } from "vitest";
import {
  allExecutionPolicies,
  describeRiskClass,
  evaluateApproval,
  getRiskClass,
  isActionPreApproved,
  requiresApproval,
} from "@/lib/policy/executionPolicy";

describe("getRiskClass", () => {
  it("classifies research/enrichment/interpretation capabilities as read-only", () => {
    expect(getRiskClass("company-research")).toBe("READ_ONLY");
    expect(getRiskClass("funding-research")).toBe("READ_ONLY");
    expect(getRiskClass("ai-adoption-signal")).toBe("READ_ONLY");
    expect(getRiskClass("official-source-verification")).toBe("READ_ONLY");
    expect(getRiskClass("crm-read")).toBe("READ_ONLY");
  });

  it("classifies write/send capabilities above read-only", () => {
    expect(getRiskClass("crm-write")).toBe("LOW_RISK_WRITE");
    expect(getRiskClass("calendar-write")).toBe("LOW_RISK_WRITE");
    expect(getRiskClass("file-write")).toBe("LOW_RISK_WRITE");
    expect(getRiskClass("email-send")).toBe("EXTERNAL_COMMUNICATION");
  });
});

describe("requiresApproval", () => {
  it("is false only for READ_ONLY", () => {
    expect(requiresApproval("READ_ONLY")).toBe(false);
    expect(requiresApproval("LOW_RISK_WRITE")).toBe(true);
    expect(requiresApproval("EXTERNAL_COMMUNICATION")).toBe(true);
    expect(requiresApproval("HIGH_RISK_WRITE")).toBe(true);
    expect(requiresApproval("FINANCIAL")).toBe(true);
  });
});

describe("isActionPreApproved", () => {
  it("checks membership in the pre-approved list", () => {
    expect(isActionPreApproved("email-send", ["email-send"])).toBe(true);
    expect(isActionPreApproved("email-send", ["crm-write"])).toBe(false);
    expect(isActionPreApproved("email-send", undefined)).toBe(false);
  });
});

describe("evaluateApproval", () => {
  it("never requires approval for a read-only capability, regardless of pre-approval list", () => {
    const approval = evaluateApproval("company-research", []);
    expect(approval).toEqual({ required: false, status: "not_required" });
  });

  it("defaults an un-pre-approved write action to pending, never approved", () => {
    const approval = evaluateApproval("email-send", []);
    expect(approval.required).toBe(true);
    expect(approval.status).toBe("pending");
    expect(approval.reason).toMatch(/external-communication/);
  });

  it("approves a write action once it's in the pre-approved list", () => {
    const approval = evaluateApproval("crm-write", ["crm-write"]);
    expect(approval).toEqual({ required: true, status: "approved", reason: undefined });
  });

  it("does not approve one write action just because a different one was pre-approved", () => {
    const approval = evaluateApproval("email-send", ["crm-write"]);
    expect(approval.status).toBe("pending");
  });
});

describe("allExecutionPolicies", () => {
  it("assigns exactly one risk class to every known capability", () => {
    const policies = allExecutionPolicies();
    const capabilities = new Set(policies.map((p) => p.capability));
    expect(capabilities.size).toBe(policies.length);
    expect(policies.length).toBeGreaterThan(0);
  });

  it("labels risk classes in plain language", () => {
    expect(describeRiskClass("READ_ONLY")).toBe("read-only");
    expect(describeRiskClass("EXTERNAL_COMMUNICATION")).toBe("external-communication");
  });
});
