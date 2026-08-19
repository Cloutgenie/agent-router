import { beforeEach, describe, expect, it, vi } from "vitest";
import { MockPersistentAgentExecutor } from "@/lib/providers/mock/persistentAgentExecutor";
import { ProviderTask } from "@/types";

function makeTask(overrides: Partial<ProviderTask> = {}): ProviderTask {
  return {
    taskId: "t1",
    traceId: "trace-1",
    stepId: "step-1",
    capability: "terminal-execution",
    goal: "run a diagnostic script",
    context: {},
    resultCount: 5,
    ...overrides,
  };
}

describe("MockPersistentAgentExecutor lifecycle", () => {
  it("startTask returns immediately with a real, trackable execution", async () => {
    const execution = await MockPersistentAgentExecutor.startTask(makeTask());
    expect(execution.executionId).toBeTruthy();
    expect(["pending", "running"]).toContain(execution.status);
    expect(execution.startedAt).toBeTruthy();
  });

  it("getStatus reflects the in-progress execution and throws for an unknown id", async () => {
    const { executionId } = await MockPersistentAgentExecutor.startTask(makeTask());
    const status = await MockPersistentAgentExecutor.getStatus(executionId);
    expect(status.executionId).toBe(executionId);
    expect(["pending", "running"]).toContain(status.status);

    await expect(MockPersistentAgentExecutor.getStatus("no-such-id")).rejects.toThrow(/Unknown execution/);
  });

  it("resumeTask refuses to return a result before the execution has finished", async () => {
    const { executionId } = await MockPersistentAgentExecutor.startTask(makeTask());
    await expect(MockPersistentAgentExecutor.resumeTask!(executionId)).rejects.toThrow(/has not finished yet/);
  });

  it("cancelTask marks a running execution as cancelled", async () => {
    const { executionId } = await MockPersistentAgentExecutor.startTask(makeTask());
    await MockPersistentAgentExecutor.cancelTask!(executionId);
    const status = await MockPersistentAgentExecutor.getStatus(executionId);
    expect(status.status).toBe("cancelled");
  });

  it("cancelTask on an unknown id is a safe no-op", async () => {
    await expect(MockPersistentAgentExecutor.cancelTask!("no-such-id")).resolves.toBeUndefined();
  });

  describe("execute() end-to-end", () => {
    beforeEach(() => {
      vi.spyOn(Math, "random").mockReturnValue(0.01); // always below success_rate - deterministic success
    });

    it("runs exactly once per call - not twice - and resumeTask then returns the same result", async () => {
      const task = makeTask({ capability: "agent-delegation", goal: "delegate the outreach draft" });
      const result = await MockPersistentAgentExecutor.execute(task);

      expect(result.status).toBe("completed");
      expect(result.evidence).toHaveLength(1); // would be 2 if execute() double-ran the lifecycle
      expect(result.cost).toBe(MockPersistentAgentExecutor.price_per_task); // would be doubled if it ran twice
      expect(result.data.narrative).toContain("[DEMO SIMULATION]");
      expect(result.data.narrative).toContain("delegate the outreach draft");

      const executionId = result.data.executionId as string;
      const status = await MockPersistentAgentExecutor.getStatus(executionId);
      expect(status.status).toBe("completed");

      const resumed = await MockPersistentAgentExecutor.resumeTask!(executionId);
      expect(resumed).toEqual(result);
    }, 5000);
  });
});
