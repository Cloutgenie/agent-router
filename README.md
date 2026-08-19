# Task Dropoff

**Tell us the outcome. We route the work.**

You don't choose an AI agent. You describe an outcome, and the system plans the work, routes
each piece of it to the right provider, verifies the evidence it gets back, and returns a
ranked, evidence-backed deliverable - not a chat transcript.

```
goal → task planner → capability graph → router → providers → raw evidence
     → evaluator → result composer → ranked outcome
```

This is a working prototype (V4): Demo Mode is fully mocked and always works with zero
credentials; Live Mode routes to real providers as they're configured, with automatic,
graceful fallback to mocks for anything not yet connected.

## Quickstart

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Try the default example - *"Find 20
cybersecurity startups that recently raised funding and appear likely to need AI security
help"* - or type your own goal. Watch the plan get built, each step get routed to its own
provider (in parallel where possible), evidence get collected and verified claim-by-claim,
and a ranked buyer list come out the other end. Expand a row for the full evidence trail;
select rows to export or kick off a follow-up task like "Find decision makers."

No `.env` is required. See `.env.example` for what Live Mode reads once you're ready to wire
in real providers.

```bash
npm run lint        # eslint
npm run typecheck   # tsc --noEmit
npm test            # vitest
npm run build       # production build
```

## The core idea

The product is the router, not any single agent. The UI never asks the user to pick a
provider - it only asks what outcome they want, plus optional constraints (budget, deadline,
quality/routing preference, result count). Which providers run, in what order, with what
fallback chain, is decided by the routing engine and shown *after the fact*, with full
transparency into why - down to the per-candidate score breakdown for every step.

## Architecture

```
                              User Goal
                                 |
                    ┌────────────────────────┐
                    │      Task Planner       │  lib/planner/taskPlanner.ts
                    │ workflow + step graph    │  Detects buyer-discovery vs
                    └────────────┬─────────────┘  generic; builds ExecutionPlan
                                 |
                    ┌────────────────────────┐
                    │    Capability Graph     │  lib/capabilities/classifier.ts
                    └────────────┬─────────────┘  Deterministic keyword extraction
                                 |
                    ┌────────────────────────┐
                    │         Router          │  lib/router/providerRouter.ts
                    │  per-step, per-provider │  Transparent weighted scoring +
                    └────────────┬─────────────┘  exploration + routing preference
                                 |
              ┌──────────────────┴──────────────────┐
              │        Live + Mock Providers          │  lib/providers/*
              │  each implements the same interface   │  Never blurred with the
              └──────────────────┬──────────────────┘  Router or Evaluator
                                 |
                    ┌────────────────────────┐
                    │      Raw Evidence       │  Evidence[] with source, quality,
                    └────────────┬─────────────┘  freshness, retrieval + publish time
                                 |
                    ┌────────────────────────┐
                    │        Evaluator        │  lib/evaluation/verifier.ts
                    │  claim-level, no trust   │  Independent claims, contradiction
                    └────────────┬─────────────┘  detection, freshness scoring
                                 |
                    ┌────────────────────────┐
                    │     Result Composer     │  lib/composer/*
                    │  BuyerRecord assembly    │  Opportunity scoring, why-now,
                    └────────────┬─────────────┘  decision factors
                                 |
                            Ranked Outcome
```

**These layers are never blurred.** The Router only ever decides *which provider* runs a
step. A Provider only ever *performs the work* and reports raw evidence - it never judges
whether its own output is trustworthy. The Evaluator only ever *checks* evidence someone else
already retrieved - it never gathers evidence itself. The Composer only ever *assembles* the
final deliverable from what the Evaluator already scored - it never re-decides truth.

### 1. Task Planner (`lib/planner/taskPlanner.ts`)

First decides the **workflow**: `detectWorkflow()` classifies a goal as `buyer-discovery`
(the flagship "Find Buyers" experience) when it infers company research plus at least two of
{funding, hiring, cybersecurity, AI-adoption, financial} signals, or when the goal uses
explicit buyer/prospect language. Everything else gets the simpler `generic` deliverable
(V2/V3's flat summary shape) - still routed and executed the same way, just composed
differently.

Then builds the **execution plan**. Buyer discovery always runs the same 6-step template
(`discover` → `funding` / `ai-signal` / `hiring` / `contact` in parallel → `validate`) - the
shape a human analyst would actually follow. Generic tasks get one independent step per
inferred capability.

### 2. Router (`lib/router/providerRouter.ts`)

Scores every eligible provider for **one capability at a time** - not once for the whole
task. The formula is fully exposed in the UI under "How this task was routed" on every step:

```
score =
  capability_fit     * 0.30   (specialists score slightly above generalists)
  + quality_score      * 0.20
  + reliability_score   * 0.15
  + success_rate        * 0.10
  + cost_efficiency      * 0.10
  + latency_score        * 0.10
  + historical_bonus     (±0.05, from real routing history once it exists)
```

A **routing preference** (`balanced` / `best-quality` / `lowest-cost` / `fastest`) multiplies
the quality/cost/latency weight groups before scoring. Candidates outside budget get a 50%
penalty rather than being hidden. A small **exploration rate** (`EXPLORATION_RATE`, default
0.1) occasionally picks the runner-up instead of the top scorer when it's still in budget, so
the system keeps gathering real performance data on providers it would otherwise never try -
a simple epsilon-greedy bandit, not full RL.

### 3. Providers (`lib/providers/`)

Every provider - mock or real - implements the same `AgentProvider` interface
(`types/index.ts`):

```ts
interface AgentProvider {
  id: string; name: string; capabilities: Capability[];
  protocol: "mock" | "rest" | "mcp" | "a2a" | "webhook";
  quality_score: number; reliability_score: number; success_rate: number;
  price_per_task: number; average_latency_seconds: number;
  configured: boolean; // false for real adapters until credentials are present

  execute(input: ProviderTask): Promise<ProviderResult>;
  healthCheck(): Promise<boolean>;
  estimateCost?(input: ProviderTask): Promise<number>;
}
```

**Mocks** (`lib/providers/mock/`, always `configured: true`): `MockResearchProvider`
(discovery, web/market/competitor research, AI-signal fallback), `MockFundingProvider`,
`MockHiringProvider`, `MockContactProvider` (light role lookup, or full name/email/LinkedIn
enrichment when a follow-up sets `context.deepEnrichment`), `MockVerificationProvider`
(cross-checks upstream claims before the Evaluator's own independent pass), `MockBrowserExecutor`
(simulates re-checking an official careers page - see "Browser execution" below), and
`MockMCPExecutor` (simulates a generic MCP tool call). They draw from `data/demo-companies.ts` -
25 clearly fictional companies spanning strong-to-weak signal strength, so the Evaluator has
real records to reject, not just ones to rubber-stamp.

**Real adapters** (`lib/providers/adapters/`):

- `TavilyProvider` (`tavilyProvider.ts`) and `LLMAnalysisProvider` / `GeminiProvider`
  (`llmAnalysisProvider.ts` / `geminiProvider.ts`) are real, working integrations. Tavily calls
  Tavily's search API for company discovery and funding/hiring/AI-signal evidence gathering,
  deriving company identity from result domains/titles rather than inventing anything. The two
  LLM adapters call Anthropic's Messages API and Google's Gemini API respectively, sharing one
  evidence-only schema/prompt/repair contract (`lib/providers/llm/evidenceOnlyAnalysis.ts`):
  strict JSON matching a fixed schema, one repair-prompt retry on invalid JSON, and reasoning
  only over evidence upstream steps already retrieved - never gathering evidence itself. With
  both configured, the router genuinely chooses between two live LLM executors, not a single
  hardcoded model.
- `BrowserExecutor` (`browserExecutor.ts`) and `MCPProvider` (`mcpProvider.ts`) are also real,
  working integrations - see "Browser execution" and "MCP support" below.
- `ApolloProvider`, `ClayProvider`, `A2AProvider`, `RestProvider` are structured exactly like a
  real integration but throw a clear `ProviderNotImplementedError` from `execute()` until
  someone fills in the TODO - see "Going from mock to real" below.

Every real adapter reports `configured` based on which env vars from `.env.example` are
actually present.

#### Browser execution (`lib/providers/adapters/browserExecutor.ts`)

Read-only by construction: it only ever issues GET requests against a company's own official
pages (`/careers`, `/jobs`), never submits a form, logs in, or performs any write action. It's a
lightweight static-HTML page reader (fetch + text extraction), not full headless-browser JS
rendering - most careers pages are server-rendered, which covers the "verify an official
source" use case this executor exists for. `BROWSERBASE_API_KEY` / `BROWSERBASE_PROJECT_ID` are
reserved for a future swap to real Browserbase/Stagehand sessions and aren't read yet; only
`ENABLE_BROWSER_EXECUTION=true` gates this adapter today.

**Escalation, not blanket checking.** A dedicated `browser-verify` plan step
(`lib/providers/browserEscalation.ts::needsBrowserEscalation`, shared by the mock and real
adapter so Demo and Live Mode agree) only actually checks a company's careers page when the
upstream hiring signal's average confidence is below 0.75 - an already-confident signal is left
alone. When it does check: a confirmed posting adds a fresh, high-quality corroborating evidence
item (raising confidence, sometimes past the verification threshold on its own); a posting that's
no longer there adds a low-confidence one instead, which pulls the claim's weighted confidence
down and can produce a genuine "needs review" contradiction against the original signal - both
outcomes from the spec's worked examples happen for real in this build, not just as scripted UI
states. `lib/composer/buyerComposer.ts` merges this evidence into the hiring/security claims
before verification runs, and surfaces a plain-language decision factor either way.

#### MCP support (`lib/providers/adapters/mcpProvider.ts`, `lib/providers/mcp/client.ts`)

A real MCP client over the "Streamable HTTP" JSON-RPC 2.0 transport - `initialize` →
`notifications/initialized` → `tools/list` → `tools/call` - not a placeholder, forwarding the
`Mcp-Session-Id` a server returns on every subsequent call. It deliberately never advertises
`company-research`: an arbitrary MCP server's tool output won't match the `{ companies,
byCompany }` shape the flagship discovery step requires, so it can't silently produce zero
results if routed there. Tool selection is a simple keyword match between the capability and each
discovered tool's name/description.

**Permission scopes.** `crm-read` / `email-read` / `calendar-read` / `file-read` are available as
soon as `MCP_SERVER_URL` is configured. `crm-write` / `email-send` / `calendar-write` /
`file-write` additionally require their exact scope (`crm.write`, `email.send`, ...) to be
listed in `MCP_GRANTED_SCOPES` - the router never even sees an ungranted write capability as
eligible, so it can't select a tool call nobody approved (tested in `tests/mcpProvider.test.ts`,
including a full mocked-server round trip for a granted write call).

**Mode.** `lib/config.ts` reads `ENABLE_LIVE_PROVIDERS`. In Demo Mode the router only ever
sees mocks. In Live Mode, configured real adapters join the pool *alongside* the mocks, which
stay as the fallback safety net - an unconfigured or misbehaving real adapter degrades to a
mock rather than failing the task (see `getEligibleProviders` in `lib/providers/registry.ts`,
and the fallback chain in the execution engine below). `GET /api/executors/health` runs every
provider's `healthCheck()` and reports `healthy` / `degraded` / `unavailable` /
`missing_credentials`; the `/executors` page shows it live.

### 4. Execution engine (`lib/execution/stepEngine.ts`)

Walks the step dependency graph. Every step whose dependencies are satisfied runs; steps in
the same "wave" run concurrently (unless `allow_parallel` is off) and stream their events
back as they actually complete, not batched at the end of the wave. If the selected provider
fails, the engine retries the next-ranked candidate from the router's own fallback ordering
(up to 2 fallbacks) before marking the step failed - one bad provider doesn't sink the task.

### 5. Evaluator (`lib/evaluation/verifier.ts`)

Never trusts a provider's self-reported confidence. For every record, builds one **claim**
per signal type (`funding`, `hiring`, `security_signal`, `ai_adoption`, `company_fit`,
`contact`) and independently re-scores it:

- **Minimum evidence threshold**: a claim needs one high-quality source, or two independent
  medium-or-better sources - configurable in `lib/evaluation/verifier.ts`.
- **Contradiction detection**: if two sources disagree on date by more than 30 days, the
  claim is marked `needs review` with both dates shown, and is *not* counted as verified -
  disagreement is surfaced, never hidden.
- **Freshness**: 0-30 days = strongest, 31-90 = strong, 91-180 = moderate, 180+ = weak
  (`freshnessTierFor` in `types/index.ts`), folded into claim confidence and into opportunity
  scoring.
- **Source quality weighting**: company websites, press releases, funding databases, and
  verified job pages are `high`; reputable news and established databases are `medium`;
  everything else defaults to `low` (`SOURCE_QUALITY_WEIGHT`).

### 6. Result Composer (`lib/composer/`)

`buyerComposer.ts` assembles the final `BuyerRecord[]` from the plan's completed steps: why
now, decision factors ("Included because: +..."), evidence, and an `OpportunityScore`
(`lib/scoring/opportunity.ts`, configurable 0-100 weighted breakdown: funding 20 / hiring 20 /
AI signal 20 / company fit 15 / contactability 10 / evidence quality 10 / freshness 5).
Records that fail verification with confidence below 0.4 are excluded and shown separately,
never silently dropped. `genericComposer.ts` produces the simpler flat deliverable for
non-buyer-discovery tasks. `followUp.ts` re-verifies and re-scores only what a follow-up
action actually touched, merging fresh findings into copies of the parent's records rather
than discarding prior evidence.

### 7. Task continuation (recursive execution)

Selecting rows and clicking **Find decision makers** / **Enrich contacts** / **Verify
emails** / **Run deeper research** creates a real linked task (`POST
/api/tasks/:id/follow-up`) with `parentTaskId` and a shared `rootTaskId`, running through the
exact same Planner → Router → Providers → Evaluator → Composer pipeline, scoped to the
selected companies (no re-discovery). The `/tasks/[id]` page shows the full lineage chain.

### 8. Comparison mode & Routing Advantage

Turning on **Compare routing strategy** runs a second, single-provider baseline alongside the
normal routed execution - literally whichever mock provider covers the most of the plan's
capabilities, so it also demonstrates what a single generalist provider *can't* cover.
`StrategyComparison` records quality, evidence coverage, verified-claim rate, cost, latency,
and failure rate for both, plus deltas and a winner. Every comparison-mode run is persisted as
a `RoutingExperiment` (no separate store - just tasks with `comparison` set) and shown on
`/experiments`, which aggregates them into one number: **Routing Advantage** - the average
improvement of routed execution over a single provider, across every experiment run so far.

### 9. History, performance, and feedback

`lib/history/store.ts` persists every task (JSON file, upserted by id - `data/history.json`).
`lib/history/performanceStore.ts` tracks per-provider-per-capability success rate, average
confidence/latency/cost, and verification pass rate (`data/provider-performance.json`), and
the router blends it back into future scoring (`historical_bonus`) once a provider has at
least 3 recorded attempts - the system becomes gradually data-driven rather than relying only
on seeded scores. Accepting/rejecting a result (`POST /api/tasks/:id/feedback`) also nudges
that provider's score via the same mechanism, and the `/executors` dashboard shows
success/verification/cost/latency per capability per provider.

### 10. Traces, Live Test, and Benchmarks

- `/traces/:traceId` (`lib/history/store.ts::getHistoryTaskByTraceId`) is the technical
  companion to the buyer-facing `/tasks/[id]` view: plan, routing decisions, cost, fallbacks,
  errors, and the full trace log for one trace ID, with a link back to the deliverable.
- `/live-test` runs the exact pipeline behind `/` with a fixed, non-negotiable configuration
  (5 results, $10 budget, comparison mode on) so runs are directly comparable across sessions,
  plus a live readout of which real providers are actually configured.
- `/benchmarks` runs 20 gold scenarios (`data/benchmark-scenarios.ts` - 5 easy, 5 medium, 5
  sparse-evidence, 5 conflicting-evidence) through the same single-provider-baseline-vs-routed
  comparison used everywhere else, in parallel, and persists the run
  (`lib/history/benchmarkStore.ts` → `data/benchmark-runs.json`). It answers the product's core
  question - does routing actually beat a single provider - across a spread of scenario types,
  not just the flagship demo goal.

## Data model

See `types/index.ts` for the complete set - `Agent`/`AgentProvider`, `ProviderTask`,
`ProviderResult`, `Evidence`, `Claim`, `VerificationResult`, `ExecutionStep`,
`ExecutionPlan`, `OpportunityScore`, `BuyerRecord`, `Task`, `StrategyComparison`,
`RoutingExperiment`, `ProviderPerformanceMetrics`, `ProviderHealth`, `Company` (canonical,
deduplicated).

## API

```
POST   /api/tasks                        Streams the full pipeline as NDJSON events
GET    /api/tasks/:id                    Full stored task
GET    /api/tasks/:id/results            Just the deliverable (buyer/excluded/final result)
GET    /api/tasks/:id/routing            Routing transparency: plan, budget outcome, comparison
POST   /api/tasks/:id/follow-up          Creates a linked follow-up task (streams NDJSON)
POST   /api/tasks/:id/feedback           Accept/reject/needs-review on one result
GET    /api/executors                    Provider list + mode + live-connected count
GET    /api/executors/health             Health check every provider right now
GET    /api/executors/:id/performance    Per-capability performance history
GET    /api/history                      Task history list
GET    /api/experiments                  Routing experiments + aggregate Routing Advantage
GET    /api/benchmarks                   Gold scenario list + persisted benchmark runs
POST   /api/benchmarks/run               Runs all 20 gold scenarios, persists and returns the run
```

The UI consumes these endpoints rather than reaching into server modules from client
components (server components under `app/*/page.tsx` call the `lib/` functions directly,
since they run server-side anyway).

## Going from mock to real: replacing `MockFundingProvider`

The mock/real boundary is exactly the `AgentProvider` interface. To wire in a real funding
data provider:

1. **Configuration.** Add its credential to `.env.example` and read it in `lib/config.ts`
   (`RuntimeConfig` already has slots for exactly this pattern - see `apolloConfigured` etc.).
2. **Adapter.** Create `lib/providers/adapters/fundingApiProvider.ts` following
   `apolloProvider.ts` - or, for a real HTTP call, follow `llmAnalysisProvider.ts`'s shape
   instead of `placeholder.ts`'s. Implement `execute(task: ProviderTask)`:
   - Build the request from `task.capability`, `task.goal`, and `task.context` (e.g.
     `context.companies` for the list to look up).
   - Call the real API.
3. **Normalization.** Map the response into `ProviderResult.data.byCompany[companyName]` -
   match the shape `MockFundingProvider` already produces (`{ fundingStage, fundingSignal,
   evidence }`) so `buyerComposer.ts` needs no changes. Build real `Evidence[]` - keep
   `source`, `url`, `sourceQuality`, `publishedAt`, and the `query` used; never drop
   provenance.
4. **Execution.** Return `{ status: "completed", ... }` on success. On a real failure, return
   `{ status: "failed", error }` - don't throw for expected failures; only throw for
   programmer errors, since the execution engine's fallback chain treats a thrown error and a
   `status: "failed"` result the same way (falls back), but a `status:"failed"` result is
   cheaper and clearer to read in the trace.
5. **Error handling & retries.** Wrap the HTTP call; add your own retry/backoff inside
   `execute()` if the API is flaky (the engine's fallback chain is a *provider-level* retry,
   not a network-level one).
6. **Metrics.** Nothing to do here - `recordProviderAttempt()` in the execution engine already
   tracks every attempt automatically once your provider is in the registry.
7. **Evaluation.** Also nothing to do - the Evaluator only ever looks at `Evidence[]` and
   `sourceQuality`, so a real provider gets verified exactly like a mock one, as long as it
   reports `sourceQuality` honestly.
8. **Register it.** Add `createFundingApiProvider(config)` to `getAllProviders()` in
   `lib/providers/registry.ts`.

That's it - the router, execution engine, evaluator, composer, and UI never change.

## Seed data & Demo Mode integrity

`data/demo-companies.ts` holds 25 fictional companies (never real ones) with deliberately
uneven signal strength, so Demo Mode has real weak/borderline records for the Evaluator to
flag or exclude - not just wins. The mode badge in the header always shows **Demo Mode** or
**Live Providers: N connected**, and every result carries provider/evidence metadata that
makes it traceable back to a mock source.

## What's intentionally simplified in this prototype

- `verify-emails` currently runs the same enrichment step as `enrich-contacts` rather than a
  distinct email-verification-only pass.
- Budget enforcement narrows provider choice at routing time and reports estimated vs. actual
  cost; it does not yet reduce the requested result count mid-run.
- Execution logs are the existing `TraceEvent` stream plus each step's `traceId` /
  `ProviderTask` shape - there's no separate structured log viewer UI yet.
- `Company` canonicalization/deduplication (`lib/dedup.ts`) is wired into discovery and unit
  tested, but is a no-op today since the demo company pool has no duplicates - it matters once
  a live provider can return the same company twice.
- `TavilyProvider`'s live discovery derives a company name from the search result's title/
  domain (never a fabricated name) since Tavily returns web pages, not structured company
  entities - it's a best-effort normalization, not perfect entity extraction.
- `OpenAI` is not wired yet (Anthropic and Gemini are the two live LLM adapters today); Apollo,
  Clay, A2A, and generic-REST are still unimplemented shells - see "Going from mock to real"
  above.
- `BrowserExecutor` is a static-HTML fetch + text extraction, not full headless-browser JS
  rendering (no real Browserbase/Stagehand session yet - `BROWSERBASE_API_KEY` /
  `BROWSERBASE_PROJECT_ID` are reserved but unread). It only checks `/careers` and `/jobs`
  paths, and only for the hiring signal - funding/AI-signal browser escalation would follow the
  exact same `needsBrowserEscalation` pattern but isn't wired up yet.
- `MCPProvider`'s tool selection is a keyword match between capability and tool name/description,
  not a negotiated capability handshake - a server whose tools are named unhelpfully may not get
  matched to the right capability. It's been verified against a mocked JSON-RPC server
  (`tests/mcpProvider.test.ts`), not a real MCP server, since none is configured in this
  environment.
- `/benchmarks` measures single-provider-baseline-vs-routed (the same `StrategyComparison`
  used everywhere else), applied across 20 scenarios that vary the goal and requested depth
  against the shared demo company pool - not per-scenario bespoke evidence fixtures, and not
  yet the spec's separate named Tavily+OpenAI / Tavily+Gemini paths (that needs the router to
  accept a fixed *set* of allowed providers per step, not just one).

## Tech stack

Next.js (App Router) + TypeScript + Tailwind CSS + Vitest. Local JSON-file persistence, no
database. Zero required external API keys.
