// Core domain types for Task Dropoff.
//
// GOAL -> TASK PLANNER -> CAPABILITY GRAPH -> ROUTER -> PROVIDERS -> RAW EVIDENCE
//      -> EVALUATOR -> RESULT COMPOSER -> FINAL DELIVERABLE
//
// Layer boundaries are intentional and should not blur:
//   Router    - decides which provider performs each capability (lib/router)
//   Provider  - actually performs the work (lib/providers)
//   Evaluator - checks whether a result is supported, complete, useful (lib/evaluation)
//   Composer  - turns provider outputs into the final deliverable (lib/composer)

export type Capability =
  | "company-research"
  | "web-research"
  | "funding-research"
  | "hiring-signals"
  | "lead-generation"
  | "contact-enrichment"
  | "cybersecurity-research"
  | "financial-research"
  | "data-validation"
  | "summarization"
  | "competitor-analysis"
  | "market-research"
  | "ai-adoption-signal"
  | "official-source-verification"
  | "crm-read"
  | "crm-write"
  | "email-read"
  | "email-send"
  | "calendar-read"
  | "calendar-write"
  | "file-read"
  | "file-write"
  | "long-running-task"
  | "authenticated-browser"
  | "terminal-execution"
  | "agent-delegation";

export const ALL_CAPABILITIES: Capability[] = [
  "company-research",
  "web-research",
  "funding-research",
  "hiring-signals",
  "lead-generation",
  "contact-enrichment",
  "cybersecurity-research",
  "financial-research",
  "data-validation",
  "summarization",
  "competitor-analysis",
  "market-research",
  "ai-adoption-signal",
  "official-source-verification",
  "crm-read",
  "crm-write",
  "email-read",
  "email-send",
  "calendar-read",
  "calendar-write",
  "file-read",
  "file-write",
  "long-running-task",
  "authenticated-browser",
  "terminal-execution",
  "agent-delegation",
];

export interface CapabilityClassifier {
  classify(rawTask: string): Capability[];
}

// ---------------------------------------------------------------------------
// Execution mode - Demo Mode (mocks only, always works) vs Live Mode (real
// providers where configured, graceful fallback to mocks otherwise).
// ---------------------------------------------------------------------------

export type ExecutionMode = "demo" | "live";

export type ProviderProtocol = "mock" | "rest" | "mcp" | "a2a" | "webhook" | "persistent_agent";

// ---------------------------------------------------------------------------
// Provider layer - the only thing that actually performs work. Everything
// downstream (router, evaluator, composer) only ever sees this interface.
// ---------------------------------------------------------------------------

export interface ProviderTask {
  taskId: string;
  traceId: string;
  stepId: string;
  capability: Capability;
  goal: string;
  /** Outputs of upstream steps this step depends on, merged by key. */
  context: Record<string, unknown>;
  resultCount: number;
  budgetRemaining?: number;
}

/** Canonical company record (V4 #27) - multiple provider outputs map to one of these. */
export interface Company {
  id: string;
  name: string;
  normalizedName: string;
  domain?: string;
  website?: string;
  aliases: string[];
}

export type EvidenceType =
  | "website"
  | "funding"
  | "job_posting"
  | "news"
  | "company_data"
  | "provider_output";

/** Trust tier of a source - feeds directly into claim confidence (V4 #28). */
export type SourceQuality = "high" | "medium" | "low";

export const SOURCE_QUALITY_WEIGHT: Record<SourceQuality, number> = {
  high: 1,
  medium: 0.75,
  low: 0.5,
};

export interface Evidence {
  id: string;
  type: EvidenceType;
  title: string;
  source: string;
  sourceQuality: SourceQuality;
  url?: string;
  excerpt?: string;
  retrievedAt: string;
  /** When the underlying fact actually happened/was published, if known - distinct from retrievedAt. */
  publishedAt?: string;
  confidence: number;
  /** The search/lookup query that surfaced this evidence, if applicable. */
  query?: string;
}

export interface ProviderResult {
  status: "completed" | "failed";
  /** Structured, capability-specific payload. Shape documented per provider. */
  data: Record<string, unknown>;
  evidence: Evidence[];
  confidence: number;
  cost: number;
  duration_seconds: number;
  error?: string;
}

/**
 * Every provider - mock or real - implements this exact interface. The
 * router and execution engine never know or care whether `execute` calls a
 * REST API, an MCP server, an A2A agent, or a local mock.
 */
export interface AgentProvider {
  id: string;
  name: string;
  description: string;
  capabilities: Capability[];
  protocol: ProviderProtocol;
  quality_score: number;
  reliability_score: number;
  success_rate: number;
  price_per_task: number;
  average_latency_seconds: number;
  /** False for real adapters until their env credentials are present. */
  configured: boolean;

  execute(input: ProviderTask): Promise<ProviderResult>;
  healthCheck(): Promise<boolean>;
  estimateCost?(input: ProviderTask): Promise<number>;
}

/** Serializable projection of AgentProvider for the API/UI (no methods). */
export interface ProviderSummary {
  id: string;
  name: string;
  description: string;
  capabilities: Capability[];
  protocol: ProviderProtocol;
  quality_score: number;
  reliability_score: number;
  success_rate: number;
  price_per_task: number;
  average_latency_seconds: number;
  configured: boolean;
}

// ---------------------------------------------------------------------------
// MCP support (spec #25-26) - generic Model Context Protocol tool calling.
// Scopes gate write-capable tools behind explicit configuration; the router
// never sees (and therefore can never select) a capability whose scope
// hasn't been granted - see MCP_GRANTED_SCOPES in lib/config.ts.
// ---------------------------------------------------------------------------

export type MCPPermissionScope =
  | "crm.read"
  | "crm.write"
  | "email.read"
  | "email.send"
  | "calendar.read"
  | "calendar.write"
  | "files.read"
  | "files.write";

export interface MCPToolDescriptor {
  serverId: string;
  toolName: string;
  description?: string;
  inputSchema?: unknown;
}

export interface MCPToolResult {
  toolName: string;
  isError: boolean;
  text: string;
}

export interface MCPExecutor extends AgentProvider {
  listTools(): Promise<MCPToolDescriptor[]>;
  callTool(toolName: string, input: Record<string, unknown>): Promise<MCPToolResult>;
}

// ---------------------------------------------------------------------------
// Persistent agent executors - long-running computer/browser/terminal
// workers (spec #9): a persistent browser session, a computer-use worker, a
// terminal agent, a future third-party worker. No concrete vendor has a
// settled programmatic contract wired here - see
// lib/providers/adapters/persistentAgentExecutor.ts for why the real
// adapter is an honest, unconnected shell (never fabricate an integration),
// and lib/providers/mock/persistentAgentExecutor.ts for the Demo Mode
// stand-in that exercises the full lifecycle below.
// ---------------------------------------------------------------------------

export type PersistentExecutionStatus = "pending" | "running" | "completed" | "failed" | "cancelled";

export interface PersistentExecution {
  executionId: string;
  status: PersistentExecutionStatus;
  startedAt: string;
}

export interface PersistentAgentExecutor extends AgentProvider {
  startTask(input: ProviderTask): Promise<PersistentExecution>;
  getStatus(executionId: string): Promise<PersistentExecution>;
  resumeTask?(executionId: string): Promise<ProviderResult>;
  cancelTask?(executionId: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// Execution policy + approval (spec #27-28). Every capability carries a risk
// class; anything above READ_ONLY requires explicit approval before the
// execution engine will even route it to a provider - see
// lib/policy/executionPolicy.ts and lib/execution/stepEngine.ts.
// ---------------------------------------------------------------------------

export type RiskClass = "READ_ONLY" | "LOW_RISK_WRITE" | "EXTERNAL_COMMUNICATION" | "HIGH_RISK_WRITE" | "FINANCIAL";

export interface ExecutionPolicy {
  capability: Capability;
  riskClass: RiskClass;
}

export type ApprovalStatus = "not_required" | "pending" | "approved" | "rejected";

export interface ExecutionApproval {
  required: boolean;
  status: ApprovalStatus;
  reason?: string;
}

// ---------------------------------------------------------------------------
// Router layer - per-step provider scoring and selection.
// ---------------------------------------------------------------------------

export interface ProviderCandidateScore {
  provider_id: string;
  provider_name: string;
  capability_fit: number;
  quality_score: number;
  reliability_score: number;
  success_rate: number;
  cost_efficiency: number;
  latency_score: number;
  historical_bonus: number;
  total_score: number;
  within_budget: boolean;
  configured: boolean;
  selected: boolean;
  /** True if this candidate won via exploration rather than top score. */
  explored: boolean;
}

// ---------------------------------------------------------------------------
// Execution market (V7 #1-9) - a formal vocabulary around routing: what each
// eligible executor offers for a step (ExecutionOffer), what gets persisted
// as the record of that offer (ExecutionQuote), and each executor's
// capability-specific track record (CapabilityPerformance). Layered on top
// of - not a replacement for - the existing ProviderCandidateScore /
// ProviderPerformanceMetrics routing machinery; every V6 field keeps
// working exactly as before. See lib/router/marketUtility.ts.
// ---------------------------------------------------------------------------

/** Sample-size-corrected view of one executor's track record for one capability. */
export interface CapabilityPerformance {
  executorId: string;
  capability: Capability;
  /** Reserved for future context-dimension segmentation (industry, geography, ...) - always undefined today. */
  taskContext?: string;
  jobsCompleted: number;
  successRate: number;
  verificationRate: number;
  humanAcceptanceRate: number;
  avgQuality: number;
  avgLatencyMs: number;
  avgCost: number;
  failureRate: number;
  /** Not tracked yet - the performance store doesn't distinguish first-choice vs. fallback attempts. Always 0. */
  fallbackRate: number;
  confidenceAdjustedScore: number;
}

/** What one executor offers for one step, before a winner is picked. */
export interface ExecutionOffer {
  executorId: string;
  capability: Capability;
  estimatedCost: number;
  estimatedLatencyMs: number;
  estimatedQuality: number;
  estimatedVerificationRate: number;
  reliability: number;
  /** 0-1, sample-size-based - see CapabilityPerformance.jobsCompleted. */
  confidence: number;
  available: boolean;
}

/** A persisted record of one ExecutionOffer - the full quote list for a step, not just the winner. */
export interface ExecutionQuote {
  id: string;
  taskId: string;
  stepId: string;
  executorId: string;
  capability: Capability;
  priceEstimate: number;
  latencyEstimateMs: number;
  qualityEstimate: number;
  reliabilityEstimate: number;
  createdAt: string;
}

export type StepStatus = "pending" | "running" | "completed" | "failed" | "awaiting_approval";

export interface ExecutionStep {
  id: string;
  capability: Capability;
  description: string;
  /** IDs of steps that must complete before this one can start. */
  dependencies: string[];
  candidates: ProviderCandidateScore[];
  /** Computed once the step is ready to run - never routed to a provider while status is "pending". */
  approval?: ExecutionApproval;
  selectedProviderId?: string;
  fallbackProviderIds: string[];
  usedFallback: boolean;
  status: StepStatus;
  result?: ProviderResult;
  /** Extra flags merged into this step's ProviderTask.context (e.g. `{ deepEnrichment: true }`). */
  extraContext?: Record<string, unknown>;
}

export interface ExecutionPlan {
  goal: string;
  steps: ExecutionStep[];
}

// ---------------------------------------------------------------------------
// Evaluator layer - independent, claim-level verification of provider
// output. Never trusts a provider's own confidence claim at face value.
// ---------------------------------------------------------------------------

export type ClaimType =
  | "funding"
  | "hiring"
  | "ai_adoption"
  | "security_signal"
  | "company_fit"
  | "contact";

/** Recent signals score higher - applied to funding/hiring/AI/leadership claims (V4 #10). */
export type FreshnessTier = "strongest" | "strong" | "moderate" | "weak";

export function freshnessTierFor(ageDays: number): FreshnessTier {
  if (ageDays <= 30) return "strongest";
  if (ageDays <= 90) return "strong";
  if (ageDays <= 180) return "moderate";
  return "weak";
}

export const FRESHNESS_SCORE: Record<FreshnessTier, number> = {
  strongest: 1,
  strong: 0.75,
  moderate: 0.45,
  weak: 0.2,
};

export interface Claim {
  id: string;
  type: ClaimType;
  statement: string;
  evidenceIds: string[];
  verified: boolean;
  confidence: number;
  freshness: FreshnessTier;
  /** Set when two evidence items disagree - claim is downgraded, never silently dropped. */
  contradiction?: string;
}

export interface VerificationResult {
  verified: boolean;
  confidence: number;
  issues: string[];
  evidenceCoverage: number;
  claims: Claim[];
  sourceCount: number;
  verifiedClaimCount: number;
  totalClaimCount: number;
}

// ---------------------------------------------------------------------------
// Opportunity scoring - configurable 0-100 ranking for buyer-discovery.
// ---------------------------------------------------------------------------

export interface OpportunityScoreWeights {
  funding: number;
  hiring: number;
  aiSignal: number;
  companyFit: number;
  contactability: number;
  evidenceQuality: number;
  freshness: number;
}

export const DEFAULT_OPPORTUNITY_WEIGHTS: OpportunityScoreWeights = {
  funding: 20,
  hiring: 20,
  aiSignal: 20,
  companyFit: 15,
  contactability: 10,
  evidenceQuality: 10,
  freshness: 5,
};

export interface OpportunityScore {
  total: number;
  funding: number;
  hiring: number;
  aiSignal: number;
  companyFit: number;
  contactability: number;
  evidenceQuality: number;
  freshness: number;
}

// ---------------------------------------------------------------------------
// Result Composer layer - the flagship "Find Buyers" structured deliverable.
// ---------------------------------------------------------------------------

export type ReviewState = "unreviewed" | "accepted" | "rejected" | "needs-review";

export interface DecisionMakerContact {
  fullName?: string;
  role: string;
  company: string;
  linkedinUrl?: string;
  email?: string;
  emailConfidence?: number;
  source: string;
  verificationStatus: "verified" | "unverified" | "not-found";
}

export interface BuyerRecord {
  id: string;
  company: string;
  normalizedName: string;
  domain?: string;
  website: string;
  industry: string;
  fundingStage: string;
  fundingSignal: string;
  hiringSignal: string;
  aiSignal: string;
  securitySignal: string;
  whyNow: string;
  decisionMakerRole: string;
  contact?: DecisionMakerContact;
  /** Concise "Included because: + ..." bullets - no hidden chain-of-thought. */
  decisionFactors: string[];
  evidence: Evidence[];
  verification: VerificationResult;
  opportunityScore: OpportunityScore;
  confidence: number;
  providersUsed: string[];
  reviewState: ReviewState;
  /** True when this record was merged from more than one duplicate discovery hit. */
  mergedDuplicates: number;
}

/** Generic (non buyer-discovery) deliverable shape, carried over from V2. */
export interface FinalResult {
  summary: string;
  highlights: string[];
  outputs: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Task
// ---------------------------------------------------------------------------

export type QualityPreference = "standard" | "high" | "best";

export type TaskStatus =
  | "planning"
  | "routing"
  | "executing"
  | "verifying"
  | "completed"
  | "failed";

export type WorkflowType = "buyer-discovery" | "generic";

export type FollowUpAction =
  | "find-decision-makers"
  | "enrich-contacts"
  | "verify-emails"
  | "deeper-research";

/**
 * Alters router scoring weights (V4 #15). "balanced" is the default.
 * "highest-reliability" (V7 #7) reuses the same weighted-formula path with a
 * reliability-heavy multiplier. "market-optimal" (V7 #7-8) is scored by a
 * genuinely different, transparent utility function over each executor's
 * capability-specific track record instead - see lib/router/marketUtility.ts.
 */
export type RoutingPreference =
  | "balanced"
  | "best-quality"
  | "lowest-cost"
  | "fastest"
  | "highest-reliability"
  | "market-optimal";

export interface TaskConstraints {
  budget?: number;
  deadline_minutes?: number;
  quality_preference?: QualityPreference;
  allow_parallel?: boolean;
  /** How many ranked results to return - quality over fake quantity. */
  result_count?: number;
  routing_preference?: RoutingPreference;
  /** Run both a single-provider and a routed strategy and compare them (V4 #12). */
  compare_strategies?: boolean;
  /** Capabilities explicitly pre-approved for this task - anything above READ_ONLY risk is otherwise blocked by default (spec #28). */
  approved_actions?: Capability[];
  /**
   * Hard floors/ceilings (V7 #9) - a candidate that violates one is excluded
   * from routing entirely, never merely scored down. minimum_verification is
   * skipped (not enforced) for an executor with no verification history yet
   * for this capability - cold start gets the benefit of the doubt rather
   * than being permanently locked out by a floor nothing has earned yet.
   */
  minimum_quality?: number;
  minimum_verification?: number;
  maximum_cost?: number;
  maximum_latency_seconds?: number;
}

export interface CostBreakdown {
  inputCost: number;
  outputCost: number;
  providerFee: number;
  estimatedTotal: number;
  actualTotal: number;
  isEstimated: boolean;
}

export interface BudgetOutcome {
  budget: number;
  estimated: number;
  actual: number;
  adjustments: string[];
}

export interface TraceEvent {
  label: string;
  detail?: string;
  timestamp: string;
}

export interface EvaluationSummary {
  average_confidence: number;
  total_cost: number;
  total_latency: number;
  providers_used: number;
  qualified_count: number;
  excluded_count: number;
  evidence_coverage: number;
  verified_claim_rate: number;
}

export interface Task {
  id: string;
  traceId: string;
  parentTaskId?: string;
  rootTaskId: string;
  followUpTaskIds: string[];
  followUpAction?: FollowUpAction;
  workflow: WorkflowType;
  mode: ExecutionMode;
  raw_task: string;
  created_at: string;
  completed_at?: string;
  budget?: number;
  deadline_minutes?: number;
  quality_preference: QualityPreference;
  routing_preference: RoutingPreference;
  result_count: number;
  allow_parallel: boolean;
  status: TaskStatus;
  inferred_capabilities: Capability[];
  plan: ExecutionPlan;
  buyer_results: BuyerRecord[];
  excluded_results: BuyerRecord[];
  final_result?: FinalResult;
  evaluation_summary: EvaluationSummary;
  execution_trace: TraceEvent[];
  budget_outcome?: BudgetOutcome;
  comparison?: StrategyComparison;
}

// ---------------------------------------------------------------------------
// Comparison mode - proves routing beats a single provider (V4 #12, #35).
// ---------------------------------------------------------------------------

export interface StrategyRunSummary {
  strategy: "single" | "routed";
  providerNames: string[];
  quality: number;
  evidenceCoverage: number;
  verifiedClaimRate: number;
  totalCost: number;
  totalLatency: number;
  resultCount: number;
  failedCount: number;
}

export interface StrategyComparison {
  single: StrategyRunSummary;
  routed: StrategyRunSummary;
  winner: "single" | "routed" | "tie";
  qualityDelta: number;
  evidenceCoverageDelta: number;
  verifiedClaimRateDelta: number;
  failedRateDelta: number;
}

export interface RoutingExperiment {
  id: string;
  taskId: string;
  raw_task: string;
  createdAt: string;
  comparison: StrategyComparison;
}

/** Slim record persisted in local task history / lineage views. */
export interface TaskHistoryEntry {
  id: string;
  parentTaskId?: string;
  rootTaskId: string;
  workflow: WorkflowType;
  mode: ExecutionMode;
  raw_task: string;
  created_at: string;
  completed_at?: string;
  status: TaskStatus;
  inferred_capabilities: Capability[];
  providers_used: string[];
  result_count: number;
  average_confidence: number;
  total_cost: number;
  total_latency: number;
}

// ---------------------------------------------------------------------------
// Provider performance history (local, feeds back into routing).
// ---------------------------------------------------------------------------

export interface ProviderPerformanceRecord {
  provider_id: string;
  capability: Capability;
  tasks_attempted: number;
  success_count: number;
  confidence_sum: number;
  latency_sum: number;
  cost_sum: number;
  verification_pass_count: number;
  verification_total: number;
  /** Human feedback (V4 #22-23): accept/reject on results this provider contributed to. */
  accepted_count: number;
  rejected_count: number;
}

export interface ProviderPerformanceMetrics {
  provider_id: string;
  capability: Capability;
  tasks_attempted: number;
  success_rate: number;
  average_confidence: number;
  average_latency: number;
  average_cost: number;
  verification_pass_rate: number;
  acceptance_rate: number;
  feedback_count: number;
  /**
   * Raw counts (V7 market core) alongside the ratios above - needed for
   * sample-size-corrected (Wilson lower bound) scoring, which a pre-divided
   * rate can't reconstruct. The *_rate fields above are unchanged and still
   * what existing code should read for a simple ratio.
   */
  success_count: number;
  verification_pass_count: number;
  verification_total: number;
  accepted_count: number;
  rejected_count: number;
}

// ---------------------------------------------------------------------------
// Provider health (V4 #3) - checked before routing any live work.
// ---------------------------------------------------------------------------

export type ProviderHealthState = "healthy" | "degraded" | "unavailable" | "disabled" | "missing_credentials";

export interface ProviderHealth {
  provider_id: string;
  provider_name: string;
  state: ProviderHealthState;
  checked_at: string;
  detail?: string;
}

// ---------------------------------------------------------------------------
// Provider overrides / kill switches (spec #33-35). Operator-set, take
// effect immediately with no redeploy - lib/providers/overrideStore.ts.
// Either set manually from /executors, or written automatically by
// lib/policy/autoSafety.ts when a provider's own performance history
// crosses a failure/verification threshold.
// ---------------------------------------------------------------------------

export interface ProviderOverride {
  /** Kill switch - false removes the provider from eligibility entirely, in every mode. */
  enabled: boolean;
  /** Still eligible, but scored with a heavy penalty and reported as "degraded" health. */
  degraded: boolean;
  /** Provider becomes ineligible for any step whose price exceeds this. */
  maxCostPerTask?: number;
  /** A call that takes longer than this is treated as a failed attempt. */
  timeoutMs?: number;
  /** How many times the SAME provider is retried before the engine falls back to the next candidate. */
  maxRetries?: number;
  /** Global concurrency cap across the whole running process, not just one task. */
  maxConcurrentRuns?: number;
  /** Cap on how many steps within a single task may route to this provider. */
  maxRunsPerTask?: number;
  updatedAt: string;
  updatedBy: "manual" | "auto";
  reason?: string;
}

// ---------------------------------------------------------------------------
// Execution logs (V4 #19-20) - structured, never contains secrets.
// ---------------------------------------------------------------------------

export type ExecutionLogLevel = "info" | "warn" | "error";

export interface ExecutionLogEntry {
  traceId: string;
  taskId: string;
  timestamp: string;
  level: ExecutionLogLevel;
  stage:
    | "task_accepted"
    | "planner_output"
    | "provider_selection"
    | "provider_request"
    | "provider_response"
    | "verification"
    | "fallback"
    | "result_composition"
    | "error";
  message: string;
  data?: Record<string, unknown>;
}
