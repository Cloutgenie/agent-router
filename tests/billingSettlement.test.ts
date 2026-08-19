import { describe, expect, it } from "vitest";
import { TaskEconomics } from "@/types";
import { aggregateSettlements, computeTaskSettlement } from "@/lib/billing/settlement";
import { makeCompletedStep, makeTask, makeUnmetStep } from "./fixtures";

function makeEconomics(overrides: Partial<TaskEconomics> = {}): TaskEconomics {
  return {
    billingStatus: "billable",
    customerPriceCents: 200,
    includedCreditAppliedCents: 200,
    overageAmountCents: 0,
    providerCostCents: 100,
    verificationCostCents: 0,
    platformCostCents: 100,
    grossMarginCents: 100,
    ...overrides,
  };
}

describe("computeTaskSettlement", () => {
  it("is undefined for a task with no economics (demo mode, never billed)", () => {
    const task = makeTask({ economics: undefined });
    expect(computeTaskSettlement(task)).toBeUndefined();
  });

  it("returns an empty settlement carrying the platform fee when there are no completed steps with cost", () => {
    const task = makeTask({
      economics: makeEconomics({ platformCostCents: 50 }),
      plan: { goal: "g", steps: [makeUnmetStep("s1", "company-research")] },
    });
    const settlement = computeTaskSettlement(task);
    expect(settlement).toEqual({ taskId: task.id, totalExecutorPayoutCents: 0, totalPlatformFeeCents: 50, lines: [] });
  });

  it("apportions executor payout and platform fee across completed steps by cost share", () => {
    const step1 = makeCompletedStep("s1", "tavily-provider", { result: { status: "completed", data: {}, evidence: [], confidence: 0.9, cost: 3, duration_seconds: 1 } });
    const step2 = makeCompletedStep("s2", "apollo-provider", { result: { status: "completed", data: {}, evidence: [], confidence: 0.9, cost: 1, duration_seconds: 1 } });
    const task = makeTask({
      economics: makeEconomics({ platformCostCents: 400 }),
      plan: { goal: "g", steps: [step1, step2] },
    });

    const settlement = computeTaskSettlement(task)!;
    expect(settlement.lines).toHaveLength(2);

    const line1 = settlement.lines.find((l) => l.executorId === "tavily-provider")!;
    const line2 = settlement.lines.find((l) => l.executorId === "apollo-provider")!;
    expect(line1.executorPayoutCents).toBe(300); // $3.00 -> 300 cents
    expect(line2.executorPayoutCents).toBe(100); // $1.00 -> 100 cents
    expect(line1.platformFeeCents).toBe(300); // 3/4 share of 400
    expect(line2.platformFeeCents).toBe(100); // 1/4 share of 400

    expect(settlement.totalExecutorPayoutCents).toBe(400);
    expect(settlement.totalPlatformFeeCents).toBe(400);
  });

  it("skips steps that are not completed or have no selected provider", () => {
    const completed = makeCompletedStep("s1", "tavily-provider");
    const failed = makeUnmetStep("s2", "company-research");
    const task = makeTask({ economics: makeEconomics(), plan: { goal: "g", steps: [completed, failed] } });

    const settlement = computeTaskSettlement(task)!;
    expect(settlement.lines).toHaveLength(1);
    expect(settlement.lines[0].executorId).toBe("tavily-provider");
  });
});

describe("aggregateSettlements", () => {
  it("sums payouts per executor across tasks and counts distinct tasks, not steps", () => {
    const taskA = makeTask({
      id: "task-a",
      economics: makeEconomics({ platformCostCents: 100 }),
      plan: {
        goal: "g",
        steps: [
          makeCompletedStep("s1", "tavily-provider", { result: { status: "completed", data: {}, evidence: [], confidence: 0.9, cost: 1, duration_seconds: 1 } }),
          makeCompletedStep("s2", "tavily-provider", { id: "s2", result: { status: "completed", data: {}, evidence: [], confidence: 0.9, cost: 1, duration_seconds: 1 } }),
        ],
      },
    });
    const taskB = makeTask({
      id: "task-b",
      economics: makeEconomics({ platformCostCents: 100 }),
      plan: { goal: "g", steps: [makeCompletedStep("s1", "tavily-provider", { result: { status: "completed", data: {}, evidence: [], confidence: 0.9, cost: 2, duration_seconds: 1 } })] },
    });
    const taskC = makeTask({ id: "task-c", economics: undefined }); // demo mode, excluded entirely

    const totals = aggregateSettlements([taskA, taskB, taskC]);
    expect(totals).toHaveLength(1);
    expect(totals[0].executorId).toBe("tavily-provider");
    expect(totals[0].totalPayoutCents).toBe(400); // 100 + 100 + 200 cents
    expect(totals[0].taskCount).toBe(2); // task-a and task-b, not 3 steps
  });

  it("sorts executors by total payout, highest first", () => {
    const taskA = makeTask({
      economics: makeEconomics(),
      plan: { goal: "g", steps: [makeCompletedStep("s1", "low-provider", { result: { status: "completed", data: {}, evidence: [], confidence: 0.9, cost: 1, duration_seconds: 1 } })] },
    });
    const taskB = makeTask({
      economics: makeEconomics(),
      plan: { goal: "g", steps: [makeCompletedStep("s1", "high-provider", { result: { status: "completed", data: {}, evidence: [], confidence: 0.9, cost: 9, duration_seconds: 1 } })] },
    });

    const totals = aggregateSettlements([taskA, taskB]);
    expect(totals.map((t) => t.executorId)).toEqual(["high-provider", "low-provider"]);
  });
});
