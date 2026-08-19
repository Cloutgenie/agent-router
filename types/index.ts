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
  | "file-write";

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
];

export interface CapabilityClassifier {
  classify(rawTask: string): Capability[];
}

// ---------------------------------------------------------------------------
// Execution mode - Demo Mode (mocks only, always works) vs Live Mode (real
// providers where configured, graceful fallback to mocks otherwise).
// ---------------------------------------------------------------------------

export type ExecutionMode = "demo" | "live";

export type ProviderProtocol = "mock" | "rest" | "mcp" | "a2a" | "webhook";

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

export type StepStatus = "pending" | "running" | "completed" | "failed";

export interface ExecutionStep {
  id: string;
  capability: Capability;
  description: string;
  /** IDs of steps that must complete before this one can start. */
  dependencies: string[];
  candidates: ProviderCandidateScore[];
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

/** Alters router scoring weights (V4 #15). "balanced" is the default. */
export type RoutingPreference = "balanced" | "best-quality" | "lowest-cost" | "fastest";

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
}

// ---------------------------------------------------------------------------
// Provider health (V4 #3) - checked before routing any live work.
// ---------------------------------------------------------------------------

export type ProviderHealthState = "healthy" | "degraded" | "unavailable" | "missing_credentials";

export interface ProviderHealth {
  provider_id: string;
  provider_name: string;
  state: ProviderHealthState;
  checked_at: string;
  detail?: string;
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
