import { RuntimeConfig } from "@/lib/config";
import { makeEvidence } from "@/lib/providers/shared";
import { Evidence, PersistentAgentExecutor, PersistentExecution, PersistentExecutionStatus, ProviderResult, ProviderTask } from "@/types";

/**
 * Real Cursor Cloud Agent integration (formerly "Background Agent") - a
 * genuine `PersistentAgentExecutor` (spec #9), replacing the honest shell
 * this app carried since Phase 6 ("no concrete vendor has a settled
 * contract yet") now that one does. Cursor's Cloud Agent API is confirmed
 * live against the real endpoints before writing this (GET /v1/me,
 * GET /v1/models, GET /v1/repositories all called directly with the real
 * key first) rather than assumed from memory.
 *
 * Deliberately wired to the EXISTING `terminal-execution`/`agent-delegation`
 * capabilities rather than a new one: this agent can genuinely edit a real
 * codebase and open a real PR against a real GitHub repo, so it must go
 * through the same HIGH_RISK_WRITE pre-approval gate every other
 * write-capable capability already does (lib/policy/executionPolicy.ts) -
 * inventing a separate capability/workflow the planner could reach on its
 * own would bypass that gate for no real benefit, since nothing in this
 * app's existing buyer-discovery workflow produces a target repo anyway.
 * A task reaches this provider only by supplying `context.repos` directly
 * (e.g. via a direct POST /api/tasks call, not the natural-language
 * planner) - if it's missing, this fails cleanly rather than guessing a
 * repo, the same "never fabricate the input" convention every other
 * adapter in this app follows.
 *
 * `executionId` (the single string PersistentExecution carries) encodes
 * both of Cursor's own two-level ids as `${agentId}:${runId}`, since
 * Cursor tracks a durable agent plus per-prompt runs under it - this app's
 * shared type only has room for one id, and this is the least invasive way
 * to fit Cursor's shape into it without changing that type for every other
 * persistent-agent vendor.
 */

const API_BASE = "https://api.cursor.com";
const POLL_INTERVAL_MS = 4000;

interface CursorRepoRef {
  url: string;
  startingRef?: string;
}

interface CursorRun {
  id: string;
  agentId: string;
  status: "CREATING" | "RUNNING" | "FINISHED" | "CANCELLED" | "ERROR" | "EXPIRED";
  durationMs?: number;
  result?: string;
  git?: { branches?: Array<{ repoUrl: string; branch: string; prUrl?: string }> };
}

interface CursorCreateAgentResponse {
  agent: { id: string; url: string };
  run: CursorRun;
}

function authHeader(apiKey: string): string {
  return `Basic ${Buffer.from(`${apiKey}:`).toString("base64")}`;
}

async function cursorFetch<T>(apiKey: string, path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: authHeader(apiKey),
      ...init?.headers,
    },
  });
  if (!response.ok) {
    throw new Error(`Cursor API error: ${response.status} ${await response.text().catch(() => "")}`);
  }
  return response.json() as Promise<T>;
}

function encodeExecutionId(agentId: string, runId: string): string {
  return `${agentId}:${runId}`;
}

function decodeExecutionId(executionId: string): { agentId: string; runId: string } {
  const [agentId, runId] = executionId.split(":");
  if (!agentId || !runId) throw new Error(`Malformed Cursor execution id: ${executionId}`);
  return { agentId, runId };
}

function mapStatus(status: CursorRun["status"]): PersistentExecutionStatus {
  switch (status) {
    case "CREATING":
      return "pending";
    case "RUNNING":
      return "running";
    case "FINISHED":
      return "completed";
    case "CANCELLED":
      return "cancelled";
    case "ERROR":
    case "EXPIRED":
    default:
      return "failed";
  }
}

function runToResult(run: CursorRun, priceIfCompleted: number): ProviderResult {
  const durationSeconds = run.durationMs ? run.durationMs / 1000 : 0;
  if (run.status !== "FINISHED") {
    return {
      status: "failed",
      data: { agentId: run.agentId, runId: run.id },
      evidence: [],
      confidence: 0,
      cost: 0,
      duration_seconds: durationSeconds,
      error: `Cursor agent run ended with status ${run.status}${run.status === "ERROR" ? " (see the agent's own run log at cursor.com for detail)" : ""}.`,
    };
  }

  const prUrls = (run.git?.branches ?? []).map((b) => b.prUrl).filter((url): url is string => Boolean(url));
  const evidence: Evidence[] = [
    makeEvidence({
      type: "provider_output",
      title: "Cursor Cloud Agent result",
      source: "Cursor",
      url: prUrls[0],
      excerpt: run.result ?? "Cursor agent completed with no summary text.",
      confidence: 0.75,
      sourceQuality: "medium",
      query: `Cloud Agent run ${run.id}`,
    }),
  ];

  return {
    status: "completed",
    data: { agentId: run.agentId, runId: run.id, summary: run.result, prUrls, branches: run.git?.branches ?? [] },
    evidence,
    confidence: 0.75,
    cost: priceIfCompleted,
    duration_seconds: durationSeconds,
  };
}

export function createCursorProvider(config: RuntimeConfig): PersistentAgentExecutor {
  const model = process.env.CURSOR_MODEL || "default";

  const provider: PersistentAgentExecutor = {
    id: "cursor-agent",
    name: "Cursor Cloud Agent",
    description: "Real coding agent - edits a target GitHub repo and opens a PR. Requires context.repos; never guesses a repository.",
    capabilities: ["terminal-execution", "agent-delegation"],
    protocol: "persistent_agent",
    quality_score: 0.85,
    reliability_score: 0.8,
    success_rate: 0.8,
    price_per_task: 2.5,
    // Real code changes genuinely take minutes, not seconds - honest here so
    // the router's own cost/latency scoring isn't quietly lying about it.
    // An operator running this for real should also raise this provider's
    // timeoutMs override (lib/providers/overrideStore.ts) well past the
    // engine's 30s default, or every real run will be killed as "timed out."
    average_latency_seconds: 180,
    configured: config.cursorConfigured,

    async startTask(input: ProviderTask): Promise<PersistentExecution> {
      const apiKey = process.env.CURSOR_API_KEY;
      if (!apiKey) throw new Error("Cursor is not configured - missing CURSOR_API_KEY.");

      const repos = input.context.repos as CursorRepoRef[] | undefined;
      if (!repos || repos.length === 0) {
        throw new Error("Cursor requires a target repository - task.context.repos was not provided.");
      }

      const response = await cursorFetch<CursorCreateAgentResponse>(apiKey, "/v1/agents", {
        method: "POST",
        body: JSON.stringify({
          prompt: { text: input.goal },
          model: { id: model },
          repos,
          autoCreatePR: true,
        }),
      });

      return {
        executionId: encodeExecutionId(response.agent.id, response.run.id),
        status: mapStatus(response.run.status),
        startedAt: new Date().toISOString(),
      };
    },

    async getStatus(executionId: string): Promise<PersistentExecution> {
      const apiKey = process.env.CURSOR_API_KEY;
      if (!apiKey) throw new Error("Cursor is not configured - missing CURSOR_API_KEY.");
      const { agentId, runId } = decodeExecutionId(executionId);
      const run = await cursorFetch<CursorRun>(apiKey, `/v1/agents/${agentId}/runs/${runId}`);
      return { executionId, status: mapStatus(run.status), startedAt: new Date().toISOString() };
    },

    async resumeTask(executionId: string): Promise<ProviderResult> {
      const apiKey = process.env.CURSOR_API_KEY;
      if (!apiKey) throw new Error("Cursor is not configured - missing CURSOR_API_KEY.");
      const { agentId, runId } = decodeExecutionId(executionId);
      const run = await cursorFetch<CursorRun>(apiKey, `/v1/agents/${agentId}/runs/${runId}`);
      if (run.status === "CREATING" || run.status === "RUNNING") {
        throw new Error(`Cursor run ${runId} has not finished yet (status: ${run.status}).`);
      }
      return runToResult(run, provider.price_per_task);
    },

    async cancelTask(executionId: string): Promise<void> {
      const apiKey = process.env.CURSOR_API_KEY;
      if (!apiKey) throw new Error("Cursor is not configured - missing CURSOR_API_KEY.");
      const { agentId, runId } = decodeExecutionId(executionId);
      await cursorFetch(apiKey, `/v1/agents/${agentId}/runs/${runId}/cancel`, { method: "POST" });
    },

    async execute(task: ProviderTask): Promise<ProviderResult> {
      const apiKey = process.env.CURSOR_API_KEY;
      if (!apiKey) {
        return {
          status: "failed",
          data: {},
          evidence: [],
          confidence: 0,
          cost: 0,
          duration_seconds: 0,
          error: "Cursor is not configured - missing CURSOR_API_KEY.",
        };
      }

      let executionId: string;
      try {
        ({ executionId } = await provider.startTask(task));
      } catch (err) {
        return {
          status: "failed",
          data: {},
          evidence: [],
          confidence: 0,
          cost: 0,
          duration_seconds: 0,
          error: err instanceof Error ? err.message : "Could not start the Cursor agent run.",
        };
      }

      const { agentId, runId } = decodeExecutionId(executionId);
      // The outer execution engine (lib/execution/stepEngine.ts) already
      // wraps this whole call in its own provider timeout - this loop just
      // polls at a sane interval rather than hammering the API, and stops
      // once Cursor itself reports a terminal state.
      while (true) {
        const run = await cursorFetch<CursorRun>(apiKey, `/v1/agents/${agentId}/runs/${runId}`);
        if (run.status !== "CREATING" && run.status !== "RUNNING") {
          return runToResult(run, provider.price_per_task);
        }
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      }
    },

    async healthCheck(): Promise<boolean> {
      if (!config.cursorConfigured) return false;
      const apiKey = process.env.CURSOR_API_KEY;
      if (!apiKey) return false;
      try {
        await cursorFetch(apiKey, "/v1/me");
        return true;
      } catch {
        return false;
      }
    },
  };

  return provider;
}
