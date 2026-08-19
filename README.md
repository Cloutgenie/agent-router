# Agent Router

**OpenRouter, for agents.** You don't choose an AI agent - you describe the outcome you want,
and the router figures out which agent (or team of agents) should execute it.

```
goal → capability analysis → agent market → routing → execution → evaluation → outcome
```

This is a working V0 prototype: fully mocked execution (no real API keys required), but with
real, transparent routing logic and clean seams for plugging in live agent providers later.

## Quickstart

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000), type a goal (or click one of the example
tasks), and hit **Route Task**. Watch capabilities get inferred, agents get scored, a
team get selected, execution run live, and a final evaluated result appear. Visit **History**
to see every past run.

No `.env` is required for the mocked prototype - see `.env.example` for where real provider
credentials will eventually go.

## The core idea

The product is the router, not the agents. The UI never asks the user to pick an agent -
it only asks what outcome they want, plus optional constraints (budget, deadline, quality,
max agents, parallelism). Everything else - which agents run, how many, in what order - is
decided by the routing engine and shown to the user *after the fact*, with full transparency
into why.

## Architecture

```
/app
  page.tsx                 Main task input + live routing/execution/evaluation UI
  history/page.tsx          Task history (server-rendered from local JSON store)
  api/tasks/route.ts        POST - streams the full pipeline as NDJSON events
  api/history/route.ts      GET  - list of past tasks
  api/history/[id]/route.ts GET  - single past task detail

/components                 Presentational UI: TaskForm, ExampleTasks, CapabilityBadges,
                             StatusStepper, CandidateTable, RoutingPlanCard,
                             ExecutionTimeline (ExecutionGrid + TraceLog), FinalResultCard,
                             HistoryTable

/lib
  capabilities/classifier.ts  Deterministic keyword capability classifier
  agents/registry.ts          Agent market accessors (active/eligible lookups)
  agents/provider.ts          AgentProvider interface + MockAgentProvider
  router/scoring.ts           Transparent weighted candidate scoring
  router/planner.ts           Greedy multi-agent capability-coverage planner
  execution/engine.ts         Streams AgentExecution results (sequential or parallel)
  evaluation/evaluator.ts     Completeness / confidence / quality scoring
  history/store.ts            Local JSON-file persistence (no external DB)
  pipeline.ts                 Orchestrates every stage, yields events for streaming

/data
  agents.ts     Seed agent market (11 agents, one inactive)
  history.json  Local task history (created/updated at runtime)

/types/index.ts  Every core interface: Agent, Task, RoutingCandidate, RoutingPlan,
                 AgentExecution, Evaluation, AgentProvider, CapabilityClassifier
```

### 1. Task intake

`app/page.tsx` collects the raw goal plus optional `budget`, `deadline_minutes`,
`quality_preference`, `max_agents`, and `allow_parallel`, then POSTs to `/api/tasks`.

### 2. Capability extraction

`lib/capabilities/classifier.ts` is a deterministic keyword classifier implementing the
`CapabilityClassifier` interface (`types/index.ts`). It's intentionally simple and fully
inspectable - every inferred capability traces back to specific trigger words. Swap in an
LLM-backed classifier later without touching anything downstream: same interface, same
return shape (`Capability[]`).

### 3. Agent market

`data/agents.ts` seeds 11 mock agents with deliberately overlapping capabilities (multiple
agents can usually cover any single capability, at different price/quality/speed points),
so routing decisions are actually meaningful. One agent is `active: false` to demonstrate
market filtering (deprecated agents don't get scored).

### 4. Routing engine

`lib/router/scoring.ts` scores every eligible agent with a fully transparent weighted
formula - nothing is hidden:

```
score =
  capability_fit   * 0.40
  + quality_score    * 0.20
  + reliability_score * 0.15
  + success_rate      * 0.10
  + cost_efficiency   * 0.10
  + latency_score     * 0.05
```

All inputs are normalized to 0-1 (cost and latency via min-max normalization across the
eligible pool, inverted so cheaper/faster scores higher). Candidates outside the stated
budget get a 50% score penalty rather than being silently dropped, so the UI can still show
*why* an over-budget agent lost. The full breakdown renders in the candidate comparison
table - every score bar on screen is one of these exact numbers.

### 5. Multi-agent planning

`lib/router/planner.ts` first checks whether a single agent covers every required
capability - if so, it wins outright (fewer moving parts beats a team). Otherwise it runs a
greedy set-cover: repeatedly pick the agent that covers the most *still-uncovered*
capabilities, tie-breaking on score and preferring agents that keep the running total inside
budget. This naturally satisfies the stated priority order: max coverage → highest quality →
inside budget → fewest agents. Every pick is logged into a human-readable `rationale[]` that
renders directly in the UI.

### 6. Mock execution engine

`lib/execution/engine.ts` runs the routed team against `lib/agents/provider.ts`'s
`MockAgentProvider`, which implements the shared `AgentProvider` interface. It simulates a
bounded artificial delay (scaled from `average_latency_seconds`) and returns a
capability-shaped structured result (e.g. `companies_found`, `contacts_enriched`,
`funding_rounds_identified`) plus a simulated success/failure roll based on the agent's
`success_rate`. Sequential or parallel execution is driven by `allow_parallel`; in parallel
mode, results stream back in completion order, not submission order.

### 7. Evaluation engine

`lib/evaluation/evaluator.ts` computes `completeness` (fraction of required capabilities
actually covered by a *completed* execution), `confidence` (mean of each execution's
confidence), `quality` (mean of the agent quality scores behind completed executions),
`estimated_accuracy` (a blend of the above), plus `total_cost` and `total_latency`
(sum vs. max, depending on parallelism).

### 8. Execution trace

Every stage pushes a `TraceEvent` (`Task received` → `Detected N capabilities` →
`Evaluated N agents` → `Selected X-agent team` → one `<Agent> completed/failed` per agent →
`Results evaluated` → `Final result produced`). `app/api/tasks/route.ts` streams these as
newline-delimited JSON as they happen; `app/page.tsx` reads the response body with a
`ReadableStream` reader and updates the UI live, so the whole run - capabilities, candidate
scoring, routing plan, per-agent execution, evaluation - visibly unfolds instead of arriving
as one final blob.

## Data model

See `types/index.ts` for the full set: `Agent`, `Capability`, `Task`, `RoutingCandidate`,
`RoutingPlan`, `AgentExecution`, `Evaluation`, plus the forward-looking `AgentProvider` and
`CapabilityClassifier` interfaces.

## History

`lib/history/store.ts` persists every completed task to `data/history.json` (simple local
file-based JSON, no external database - true to the V0 brief). `/history` server-renders the
list: task, agents selected, cost, quality score, and completion time. This log is the seed
of the long-term moat described in the brief: real historical agent performance data to
route smarter over time.

## Going from mock to real agents

The entire mock/real boundary is one interface, defined in `types/index.ts`:

```ts
export interface AgentProvider {
  execute(agent: Agent, request: AgentTaskRequest): Promise<AgentTaskResult>;
  healthCheck(agent: Agent): Promise<boolean>;
}
```

`lib/agents/provider.ts`'s `MockAgentProvider` is today's only implementation. To wire in a
real agent:

1. Implement `AgentProvider` for the target protocol (REST, MCP, A2A, an OpenAI/Anthropic
   agent, LangGraph, CrewAI, a plain webhook - anything that can eventually resolve an
   `AgentTaskRequest` into an `AgentTaskResult`).
2. Point the relevant `Agent.endpoint` / `Agent.protocol` fields in `data/agents.ts` (or a
   future database-backed registry) at the real service, and add its credentials to `.env`
   (see `.env.example`).
3. Pass your provider into `executeTeam(...)` in `lib/execution/engine.ts` instead of the
   default `mockAgentProvider` - per agent if you want a mixed mock/real market during
   rollout, or globally once everything is live.

Nothing in the routing engine, planner, evaluator, or UI needs to change - they only ever
see `Agent` metadata and `AgentTaskResult` shapes, never how an agent actually ran.

The capability classifier has the same seam: implement `CapabilityClassifier` with an
LLM-backed version and swap it in `lib/pipeline.ts` in place of
`capabilityClassifier` from `lib/capabilities/classifier.ts`.

## Tech stack

Next.js (App Router) + TypeScript + Tailwind CSS. Local JSON-file persistence, no database,
no required external API keys.
