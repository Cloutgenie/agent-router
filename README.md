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

A **routing preference** (`balanced` / `best-quality` / `lowest-cost` / `fastest` /
`highest-reliability`) multiplies the quality/reliability/cost/latency weight groups before
scoring using this same formula. Candidates outside budget get a 50% penalty rather than being
hidden. A small **exploration rate** (`EXPLORATION_RATE`, default 0.1) occasionally picks the
runner-up instead of the top scorer when it's still in budget, so the system keeps gathering
real performance data on providers it would otherwise never try - a simple epsilon-greedy
bandit, not full RL.

#### Execution market (`lib/router/marketUtility.ts`, `lib/market/quoteStore.ts`)

Every eligible provider's score above is also expressed as a formal **ExecutionOffer** -
`estimatedCost`, `estimatedLatencyMs`, `estimatedQuality`, `estimatedVerificationRate`,
`reliability`, and a sample-size-based `confidence` (0 at zero history, 1 at 20+ jobs). The
full offer list for every step - not just the winner - is persisted as `ExecutionQuote` records
(`data/execution-quotes.json`), so a future market dashboard can show real competition ("3
quoted, 1 selected") instead of only the outcome.

Offers are built from **CapabilityPerformance**: a sample-size-corrected read of a provider's
actual track record for one specific capability, computed from the existing performance store
(`lib/history/performanceStore.ts`) rather than a provider's single static `quality_score`.
Proportions (success rate, verification rate, human acceptance rate) use a **Wilson score
lower bound** - a provider with 2/2 perfect tasks does not outrank one with 950/1000, since a
lucky small streak gets pulled hard toward a neutral 0.5 prior while a large consistent sample
does not. Continuous metrics (latency, cost, quality) use linear shrinkage toward the
provider's static registry values instead - same instinct, different math for values that
aren't pass/fail rates. With zero history, both reduce cleanly to the provider's original
static score (honest cold-start behavior, not a fabricated high-confidence number).

A new **`market-optimal`** routing preference uses this data directly instead of the weighted
formula above, via a transparent (no ML) utility function:

```
utility =
  0.25 * avgQuality
  + 0.25 * verificationRate
  + 0.20 * successRate          (reliability)
  + 0.10 * humanAcceptanceRate
  - 0.10 * normalizedCost
  - 0.10 * normalizedLatency
```

This is "which executor has actually earned this work," not "which executor has the best
sales-sheet numbers" - a flashy `quality_score` with zero verified outcomes loses to a
lower-`quality_score` provider with a real, verified track record. `highest-reliability` is a
lighter-weight addition: the same weighted formula as `balanced`, just multiplied toward
`reliability_score`.

Tasks can also set hard **`minimum_quality`** / **`minimum_verification`** / **`maximum_cost`**
/ **`maximum_latency_seconds`** constraints - a candidate that violates one is excluded from
routing entirely, never merely scored down, so a cheap-but-disqualified provider can never win
by having a great `cost_efficiency` term. `minimum_verification` is skipped for a provider with
no verification history yet for this capability, so a brand-new capability isn't permanently
locked out by a floor nothing has had the chance to earn. These four constraints are API-only
today (`POST /api/tasks`) - no TaskForm UI field yet, unlike the two new routing-preference
options, which are.

#### Reputation decay and trust tiers (`lib/router/marketUtility.ts`)

`CapabilityPerformance.successRate`/`verificationRate` are **recency-weighted**, not a flat
lifetime average: `lib/history/performanceStore.ts` now keeps a bounded, timestamped log of the
last 200 attempts and 200 verification outcomes per provider/capability (alongside, not instead
of, the original lifetime counters - "don't erase long-term history"). Each logged outcome is
weighted by age using the same buckets as the spec's own example (≤30 days: full weight, 31-90:
0.6, 91-180: 0.3, 180+: 0.1), then run through the same Wilson lower bound as everything else -
a sparse, old tail of events produces a small effective sample size, pulling the recency-weighted
read toward neutral exactly like too few observations would. The final rate blends this
recency-weighted read (65%) with the plain lifetime Wilson bound (35%), so a long, quiet track
record still counts for something and a handful of recent events can't singlehandedly override
it. A provider with no recency log yet (e.g. history recorded before this field existed) falls
back cleanly to the pure lifetime rate rather than being dragged toward "unknown."

Every candidate also gets a **`trust_tier`** (`new` / `probation` / `trusted` / `degraded` /
`suspended`, `ProviderCandidateScore.trust_tier`, visible in "How this task was routed"):
`degraded`/`suspended` are read straight from the existing kill-switch/auto-safety override
state (`lib/providers/overrideStore.ts`, `lib/policy/autoSafety.ts` - unchanged, not
re-implemented), while `new` (0 jobs) / `probation` (fewer than 5, mirroring
`autoSafety.ts`'s own `MIN_SAMPLE_SIZE`) / `trusted` are newly derived from job count. This is
**transparency, not a hard routing exclusion**: without an executor-registration/onboarding flow
(a separate future batch), there's no real "unvetted external supply" for probation to protect
against yet - every provider here is a known, seeded, built-in one, and hard-gating on trust tier
would only ever block a task's own explicitly pre-approved write action the first time any
provider tried it, with no real safety benefit. (An earlier version of this batch did add that
hard exclusion and it broke exactly that case in testing - removed once the underlying reasoning
didn't hold up.) Revisit once there's an actual onboarding flow and "new" can mean something
other than "hasn't happened to run this exact capability yet."

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
(simulates re-checking an official careers page - see "Browser execution" below),
`MockMCPExecutor` (simulates a generic MCP tool call), and `MockPersistentAgentExecutor`
(simulates a persistent worker's full lifecycle - see "Persistent agent executors" below). They
draw from `data/demo-companies.ts` - 25 clearly fictional companies spanning strong-to-weak
signal strength, so the Evaluator has real records to reject, not just ones to rubber-stamp.

**Real adapters** (`lib/providers/adapters/`):

- `TavilyProvider` (`tavilyProvider.ts`), `ApolloProvider` (`apolloProvider.ts`), and
  `LLMAnalysisProvider` / `GeminiProvider` / `OpenAIProvider` (`llmAnalysisProvider.ts` /
  `geminiProvider.ts` / `openaiProvider.ts`) are real, working integrations - the full spec
  provider stack (Tavily/Apollo/OpenAI/Gemini). Tavily calls Tavily's search API for company
  discovery and funding/hiring/AI-signal evidence gathering, deriving company identity from
  result domains/titles rather than inventing anything. Apollo searches for a likely security
  decision-maker by title (`mixed_people/api_search` - note this is the *current* endpoint;
  Apollo's docs still list an older `mixed_people/search` path the API itself now rejects with a
  422 pointing here), and only reveals full contact details via a second, credit-consuming call
  (`people/match`) when a step's `deepEnrichment` flag is set - `email` stays `undefined`
  whenever Apollo doesn't return one, never inferred from a name+domain pattern. The three LLM
  adapters call Anthropic's Messages API, Google's Gemini API, and OpenAI's Chat Completions API
  respectively, sharing one evidence-only schema/prompt/repair contract
  (`lib/providers/llm/evidenceOnlyAnalysis.ts`): strict JSON matching a fixed schema (OpenAI
  additionally uses `response_format: json_object` to ask for it directly), one repair-prompt
  retry on invalid JSON, and reasoning only over evidence upstream steps already retrieved -
  never gathering evidence itself. With multiple configured, the router genuinely chooses among
  live LLM executors, not a single hardcoded model.
- `BrowserExecutor` (`browserExecutor.ts`) and `MCPProvider` (`mcpProvider.ts`) are also real,
  working integrations - see "Browser execution" and "MCP support" below.
- `ClayProvider`, `A2AProvider`, `RestProvider` are structured exactly like a real integration
  but throw a clear `ProviderNotImplementedError` from `execute()` until someone fills in the
  TODO - see "Going from mock to real" below.
- `PersistentAgentExecutor` (`persistentAgentExecutor.ts`) is the same kind of honest shell, for
  a different reason - see "Persistent agent executors" below.

Every real adapter reports `configured` based on which env vars from `.env.example` are
actually present.

#### Browser execution (`lib/providers/adapters/browserExecutor.ts`)

Read-only by construction: it only ever issues GET requests / page navigations against a
company's own official pages (`/careers`, `/jobs`), never submits a form, logs in, or performs
any write action. Two page-fetch strategies, chosen automatically per call:

- **Static fetch** (default, `ENABLE_BROWSER_EXECUTION=true` alone): a lightweight fetch + text
  extraction - most careers pages are server-rendered, so this alone already covers the common
  case with zero extra cost or latency.
- **Real Browserbase session** (when `BROWSERBASE_API_KEY` / `BROWSERBASE_PROJECT_ID` are also
  set): creates a real remote Chrome session via Browserbase's REST API and drives it over CDP
  with `puppeteer-core`, reading `document.body.innerText` after JS has run - covers SPA/
  JS-rendered careers pages the static path can't, verified live against `ycombinator.com` (an
  SSR-but-representative real target) during development. The session is always released
  (`REQUEST_RELEASE`) once done, since Browserbase concurrency is capped per project. Session
  *creation* is also rate-limited per project - a real run hit Browserbase's burst limit (`429`,
  5 session-creations/minute on the project used for development) partway through a multi-company
  batch; `execute()` catches each company's fetch independently so one company's rate-limited (or
  otherwise failed) session degrades to "no evidence for that company" rather than discarding
  evidence already gathered for every other one in the same call.

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

#### Persistent agent executors (`lib/providers/adapters/persistentAgentExecutor.ts`)

For longer-lived computer/browser/terminal work - a persistent browser session, a computer-use
worker, a terminal agent, a future third-party worker - the spec this was built against calls
for `startTask` / `getStatus` / `resumeTask` / `cancelTask` alongside the usual `execute()`
(`PersistentAgentExecutor` in `types/index.ts`), and four new capabilities:
`long-running-task`, `authenticated-browser`, `terminal-execution`, `agent-delegation`.

**No concrete vendor has a settled, publicly documented programmatic contract to build a real
integration against here** - unlike Tavily/Gemini/MCP, which are real integrations elsewhere in
this file. So the real adapter is deliberately an honest, unconnected shell: it implements the
full interface and reports real configuration state (`configured` only becomes true once an
operator sets both `ENABLE_PERSISTENT_AGENTS=true` *and* `PERSISTENT_AGENT_API_URL`), but every
method throws a clear `ProviderNotImplementedError` if ever actually reached - which, because
the router never selects an unconfigured adapter, it never is by default. Architecture
correctness over pretending a provider is connected.

`MockPersistentAgentExecutor` is not that thin - it actually exercises the full lifecycle in
Demo Mode: `startTask` returns immediately with a real in-progress record, `getStatus` reflects
genuine `pending → running → completed`/`failed`/`cancelled` state transitions if polled
mid-flight, and `execute()` (the synchronous bridge the current router/execution engine calls)
awaits that same in-flight run to completion rather than starting a second, duplicate one -
covered directly in `tests/persistentAgentExecutor.test.ts`, including a regression test for
exactly that double-run bug. Because `authenticated-browser` / `terminal-execution` /
`agent-delegation` step outside the read-only browser's safety boundary, they're classified
`HIGH_RISK_WRITE` in the execution policy above and blocked by the same approval gate as any
other non-read-only capability - a goal that would trigger one of them is refused by default
until explicitly pre-approved, exactly like `email-send` or `crm-write`.

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

**Execution policy & approval (spec #27-28, `lib/policy/executionPolicy.ts`).** Before a step
is ever routed to a provider - before scoring, before eligibility, before anything - its
capability's risk class is checked. Read-only capabilities (all research/enrichment/
interpretation work, plus every `*-read` capability) proceed as normal. Anything above that
(`crm-write` / `calendar-write` / `file-write` = low-risk write, `email-send` =
external-communication) is blocked by default: the step's status becomes `awaiting_approval`,
it's never scored or executed, and its dependents treat it as terminal (same as a failed step)
rather than hanging forever. The only way past the gate is `TaskConstraints.approved_actions` -
an explicit, per-task allowlist of capability names (the "Pre-approve actions" field in
Execute's advanced options) - there is no default-allow path. `/executors` shows the full
risk-class table for every capability. `MockMCPExecutor` can actually execute an approved
write-capable step in Demo Mode, clearly labeled `[DEMO SIMULATION]`, so the whole
block → approve → route → execute flow is demonstrable with zero credentials.

**Kill switches & runtime caps (spec #33, #35 - `lib/providers/overrideStore.ts`,
`lib/providers/concurrencyTracker.ts`).** Every provider can be enabled/disabled, degraded, and
given a max cost/task, timeout, retry limit, max concurrent runs, and max runs/task - all
editable live from `/executors` (expand a row → Kill switches), with no redeploy. Changes take
effect on the very next routing decision in the same process, not just future ones: overrides
live in an in-memory cache that every write updates synchronously, backed by
`data/provider-overrides.json` for durability across restarts. A disabled provider is excluded
from eligibility in every mode; a degraded one stays eligible but scores far lower and reports
`degraded` health; a cost ceiling excludes a provider outright rather than letting it run over
budget; a timeout races the provider's own call and counts a slow response as a failure; a
retry limit controls how many times the *same* provider is retried before the engine moves to
the next fallback candidate; concurrency and per-task run caps are enforced with a real
process-wide counter and a per-task counter respectively - both are covered by integration
tests that run two tasks concurrently against a capped provider and assert only one call was
ever in flight at once (`tests/stepEngineLimits.test.ts`).

**Automatic safety disable (spec #34 - `lib/policy/autoSafety.ts`).** There's no background
job in this app, so this reacts to the same signal that would justify it, the moment it lands:
right after `lib/history/performanceStore.ts` persists a provider attempt or a verification
outcome. A provider crossing a 50% failure rate (over at least 5 attempts) gets auto-degraded;
85% gets it auto-disabled. A provider whose claims fail independent verification at least 50%
of the time (over at least 5 checks) gets auto-degraded too - this is a real, currently-firing
example in this repo's own dev history: `MockContactProvider`'s light-enrichment mode never
carries enough evidence to pass verification, so accumulated local task history genuinely
auto-degrades it. A provider whose average cost sustains well above its configured ceiling
also gets auto-degraded. Automation only ever escalates risk and never fights a human: it will
not touch a provider a human already set an override on, and it will not undo its own prior
decision - only an operator clearing it from `/executors` does that. Malformed-response rate
and a dedicated false-contact detector aren't wired as distinct tracked signals yet - see
"intentionally simplified" below.

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

### 11. Market dashboards (`lib/market/marketAnalytics.ts`)

Three read-only pages over data the app already persists - no new write path, no new store,
just pure aggregation functions the pages call directly (server components, same pattern as
`/experiments`):

- **`/market`** - the executive summary: active executors, capabilities, execution volume,
  verified outcome rate, unmet demand, average cost, plus **Execution Alpha** and **Routing
  Advantage** side by side (deliberately kept as two separate metrics, per spec - Execution
  Alpha is the winner vs. the median of every executor actually quoted for the same step
  (`ExecutionQuote` records, so it's cheap - no extra pipeline run); Routing Advantage is the
  existing single-provider-vs-routed full comparison (`lib/history/routingAdvantage.ts`, now
  the one shared implementation - it used to be independently duplicated, with a small rounding
  drift, between the experiments API route and page). Below that, a **Market Gaps** table flags
  capabilities with thin supply (≤1-2 active executors) or a high failure rate - deliberately
  does *not* factor in demand growth like the spec's own worked example does, since a growth %
  computed from this prototype's actual (small) task volume would be noise dressed up as a
  trend.
- **`/supply`** - every registered executor, mock and real, whether or not it has ever won a
  job: eligibility count, wins, win rate, average price, trust tier, and a `revenue opportunity`
  figure (`jobsCompleted × avgPrice` - a framing device, not a real revenue number).
- **`/demand`** - the same underlying per-capability stats from the demand side: task/step
  volume, success rate, unmet demand, active executor count, average cost/latency - built to
  answer "which capabilities have real demand but weak supply."

Execution Alpha's quality/cost/latency/reliability lift come straight from `ExecutionQuote`
fields; **verification-rate lift and failure-rate reduction are not computed** - `ExecutionQuote`
deliberately doesn't carry a verification estimate (matching the market-core batch's decision to
keep its shape minimal/spec-faithful), and failure-rate lift would need a different data source
entirely. Left out rather than approximated with something that would look precise but wasn't.

### 12. Billing (`lib/billing/`) - core architecture only, no Stripe yet

The economic abstraction: customers pay Task Dropoff for outcomes, not Tavily/Apollo/OpenAI/
Gemini/Browserbase individually. This batch is the internal architecture that abstraction needs
- pricing, entitlements, ledger, spending limits - with **no Stripe integration at all yet**
(no Checkout, no webhooks, no real payment processing anywhere in this codebase). That's a
separate, later batch, and it needs real Stripe test-mode keys from whoever picks it up next.

**Single-tenant scaffold.** This app has no user/auth system, so there is exactly one
`BillingAccount` (`lib/billing/account.ts`, `data/billing-account.json`), under one fixed
`userId` constant rather than a real signed-in user. Every function here takes/returns a full
`BillingAccount` instead of assuming global state, so a real multi-user system could replace the
constant without touching the pricing/entitlement/ledger code that calls into it. A fresh account
defaults to the **Pro** plan (`BILLING_DEFAULT_PLAN` in `.env`), not Free - there's no Checkout
yet to actually buy a plan, so this is a local default that keeps this app's existing
live-testing workflow working, not a real subscription.

**Only live-mode task execution is ever billed** - Demo Mode remains completely free, no billing
account touched at all (verified live: a demo-mode task with a deliberately tiny $0.10 budget ran
normally with `economics: undefined`, while the identical task in live mode was correctly
blocked before any provider ran).

- **Plans** (`lib/billing/plans.ts`) - Starter/Pro/Business/Enterprise as one data-driven
  `PLAN_DEFINITIONS` table (price, included execution balance, per-feature entitlements,
  concurrency cap) rather than hard-coded throughout components. Enterprise is `contactSalesOnly`
  - never automated, per spec.
- **Entitlements** (`lib/billing/entitlements.ts`) - `getEntitlements(plan).can("browser_execution")`
  is the one place feature gating should be checked, not a scattered `if (plan === "pro")`. Not
  yet wired into the router/provider eligibility itself - that's the natural next step once a UI
  needs to actually show/hide gated features.
- **Pricing engine** (`lib/billing/pricing.ts`) - `calculateExecutionPrice()`: provider cost +
  verification cost + a configurable markup (35% default) or minimum fee (25¢ default), whichever
  is higher, in integer cents throughout (`dollarsToCents`/`centsToDollars` convert at the
  boundary - this codebase's existing cost fields are dollar floats, billing math never is).
  `verificationCostCents` stays 0 - this codebase doesn't meter verification separately from
  ordinary provider cost yet (a verification step is just another routed step with its own
  provider cost), a real field that's honestly zero rather than a fabricated split.
- **Ledger** (`lib/billing/ledger.ts`, `data/execution-ledger.json`) - the source of truth for
  historical billing, never derived from current task rows. Positive `amountCents` credits,
  negative charges, so summing a user's entries is their balance directly. Idempotent by
  `taskId`+`type`: finalizing the same task twice, or a duplicate delivery once webhooks exist,
  writes the entry once.
- **Included credit provisioning** (`lib/billing/usage.ts::ensurePeriodCreditProvisioned`) - a
  plan's included execution balance is granted once per billing period, keyed by
  `period-credit:<periodStart>` through the same idempotency mechanism - safe to call on every
  task run. A future Stripe batch would trigger this from `invoice.paid` using the real invoice
  id instead of `currentPeriodStart` - same mechanism, different trigger.
- **Usage recording** (`lib/billing/usage.ts::recordExecutionUsage`) - called once per completed
  live-mode task, in `lib/pipeline.ts`. Determines `TaskBillingStatus` first
  (`not_billable`/`partially_billable`/`billable`/`refunded` - a task that produced no usable
  result is never charged full price), writes one ledger entry, and returns a `TaskEconomics`
  summary (`Task.economics`) with included-credit-applied vs. overage broken out. The
  comparison-mode single-provider baseline run is deliberately **not** billed - it's
  benchmarking/shadow work, not the deliverable, so its real provider cost is platform-absorbed
  (matching the spec's own shadow-execution billing policy).
- **Spending gate** (`lib/billing/spendingCheck.ts`, wired into `lib/pipeline.ts` right after
  the plan is built, before any provider runs) - checks the task's own hard budget
  (`TaskConstraints.budget`) against a price-range estimate, then the account's
  `maxPerTaskCents`/`maxPerDayCents`/`maxPerMonthCents` (all optional - unset means unlimited).
  A violated limit refuses the whole task outright with a plain-language reason (verified live)
  - same "never silently downgrade past a limit" principle as the existing risk-class approval
  gate, just applied to money instead of write actions.

Not built in this batch: any Stripe integration, the `/settings/billing` UI, the
`/api/billing/*`/`/api/webhooks/stripe` routes, entitlements actually gating router eligibility,
and admin billing tooling - all explicitly separate, later batches.

## Data model

See `types/index.ts` for the complete set - `Agent`/`AgentProvider`, `ProviderTask`,
`ProviderResult`, `Evidence`, `Claim`, `VerificationResult`, `ExecutionStep`,
`ExecutionPlan`, `OpportunityScore`, `BuyerRecord`, `Task`, `StrategyComparison`,
`RoutingExperiment`, `ProviderPerformanceMetrics`, `ProviderHealth`, `Company` (canonical,
deduplicated), `MCPToolDescriptor`/`MCPToolResult`, `ExecutionPolicy`/`ExecutionApproval`
(risk class + approval status per capability), `ProviderOverride` (kill switches - enabled,
degraded, cost/timeout/retry/concurrency caps, and who/why set it),
`PersistentAgentExecutor`/`PersistentExecution` (start/status/resume/cancel lifecycle for
longer-lived workers), `CapabilityPerformance`/`ExecutionOffer`/`ExecutionQuote`/`TrustTier`
(execution market), `BillingAccount`/`SpendingLimits`/`ExecutionLedgerEntry`/`ExecutionPrice`/
`TaskEconomics`/`PlanEntitlements` (billing).

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
GET    /api/executors/:id                One provider + its current kill-switch override
PATCH  /api/executors/:id                Set kill switches (enable/disable/degrade/caps) - takes effect immediately
DELETE /api/executors/:id                Reset a provider to its seeded defaults
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

- `CapabilityPerformance.fallbackRate` is always `0` - the performance store doesn't yet
  distinguish a first-choice attempt from a fallback attempt, so there's no real signal to
  compute this from. `taskContext` is always `undefined` - context-dimension segmentation
  (industry, geography, ...) isn't built yet, only the field reserved for it.
- `ExecutionQuote` records are persisted for every step but nothing reads them back yet - no
  `GET /api/tasks/:id/quotes` endpoint or dashboard UI. `getQuotesForTask()` exists and is
  tested; wiring it up is future work.
- The market dashboards (`/market`, `/supply`, `/demand`) have no executor registration, no
  external executor API, and no per-capability drill-down page (`/market/:capability` from the
  spec) - each capability's detail lives as a row in `/market`'s or `/demand`'s table instead of
  its own route. No shadow routing dashboard either.
- `trust_tier` is transparency only, not a routing exclusion (see "Reputation decay and trust
  tiers" above) - no per-tier task-volume cap or budget ceiling is enforced either, since the
  spec's stated reasons for both (protecting against unvetted external supply) don't apply
  without executor registration existing yet.
- Human acceptance/rejection feedback has no recency log - only success and verification
  outcomes decay; `humanAcceptanceRate` stays a plain lifetime Wilson bound.
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
- `Clay`, `A2A`, and generic-REST are still unimplemented shells - see "Going from mock to real"
  above.
- `ApolloProvider` only searches for a *security* decision-maker (a fixed title list) - it
  doesn't yet take a capability-specific title/role hint, so a non-security buyer-discovery
  variant would need that list generalized.
- `BrowserExecutor` only checks `/careers`, `/jobs`, and `/careers/open-roles` paths, and only
  for the hiring signal - funding/AI-signal browser escalation would follow the exact same
  `needsBrowserEscalation` pattern but isn't wired up yet. Its real Browserbase path also has no
  retry/backoff around the per-project session-creation rate limit - a rate-limited company is
  simply skipped for that run, not retried a moment later.
- `MCPProvider`'s tool selection is a keyword match between capability and tool name/description,
  not a negotiated capability handshake - a server whose tools are named unhelpfully may not get
  matched to the right capability. It's been verified against a mocked JSON-RPC server
  (`tests/mcpProvider.test.ts`), not a real MCP server, since none is configured in this
  environment.
- Approval (`lib/policy/executionPolicy.ts`) is pre-approval only, decided when the task is
  submitted (`TaskConstraints.approved_actions`) - there's no interactive mid-run "approve this
  now and resume the same task" flow yet, since the execution engine runs a task to completion
  in one streamed pass rather than pausing and persisting partial state. A blocked step shows up
  clearly (`awaiting_approval`, with its reason, in the plan graph and the trace) but the only
  way to unblock it today is to resubmit the task with that capability pre-approved.
- `/benchmarks` measures single-provider-baseline-vs-routed (the same `StrategyComparison`
  used everywhere else), applied across 20 scenarios that vary the goal and requested depth
  against the shared demo company pool - not per-scenario bespoke evidence fixtures, and not
  yet the spec's separate named Tavily+OpenAI / Tavily+Gemini paths (that needs the router to
  accept a fixed *set* of allowed providers per step, not just one).
- No real vendor is wired behind `PersistentAgentExecutor` - see "Persistent agent executors"
  above for why that's deliberate rather than an oversight. Even once one is, today's
  synchronous `execute()` bridge (start → poll → return) means a real integration would need to
  finish within one request; genuine cross-request resume (start now, come back tomorrow and
  resume) needs the same pause/persist-partial-state work flagged for interactive approval
  above - the architecture (`startTask`/`getStatus`/`resumeTask`/`cancelTask`) is ready for that,
  the execution engine isn't wired to use it that way yet.

## Tech stack

Next.js (App Router) + TypeScript + Tailwind CSS + Vitest. Local JSON-file persistence, no
database. Zero required external API keys.
