// Core domain types for Agent Router.
// GOAL -> CAPABILITY ANALYSIS -> AGENT MARKET -> ROUTING -> EXECUTION -> EVALUATION -> OUTCOME

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
  | "market-research";

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
];

export type AgentProtocol = "mock" | "rest" | "mcp" | "a2a" | "webhook";

export interface Agent {
  id: string;
  name: string;
  description: string;
  capabilities: Capability[];
  price_per_task: number;
  average_latency_seconds: number;
  /** 0-1, how strong the agent's output tends to be */
  quality_score: number;
  /** 0-1, how consistently the agent behaves as expected */
  reliability_score: number;
  /** 0-1, historical task completion rate */
  success_rate: number;
  protocol: AgentProtocol;
  endpoint: string;
  active: boolean;
}

export type QualityPreference = "standard" | "high" | "best";

export type TaskStatus =
  | "intake"
  | "analyzing"
  | "routing"
  | "executing"
  | "evaluating"
  | "completed"
  | "failed";

export interface TaskConstraints {
  budget?: number;
  deadline_minutes?: number;
  quality_preference?: QualityPreference;
  max_agents?: number;
  allow_parallel?: boolean;
}

export interface TraceEvent {
  label: string;
  detail?: string;
  timestamp: string;
}

export interface RoutingCandidate {
  agent: Agent;
  matched_capabilities: Capability[];
  missing_capabilities: Capability[];
  capability_fit: number;
  quality_score: number;
  reliability_score: number;
  success_rate: number;
  cost_efficiency: number;
  latency_score: number;
  total_score: number;
  within_budget: boolean;
  selected: boolean;
}

export interface TeamAssignment {
  agent: Agent;
  role: string;
  assigned_capabilities: Capability[];
}

export interface RoutingPlan {
  required_capabilities: Capability[];
  candidates: RoutingCandidate[];
  selected_agents: Agent[];
  team: TeamAssignment[];
  total_expected_cost: number;
  estimated_latency_seconds: number;
  overall_routing_score: number;
  within_budget: boolean;
  within_deadline: boolean;
  rationale: string[];
}

export type ExecutionStatus = "pending" | "running" | "completed" | "failed";

export interface AgentExecution {
  agent_id: string;
  agent_name: string;
  role: string;
  status: ExecutionStatus;
  duration_seconds: number;
  cost: number;
  confidence: number;
  result: Record<string, unknown>;
}

export interface AgentPerformance {
  agent_id: string;
  agent_name: string;
  contribution: number;
  quality_contribution: number;
  cost: number;
  duration_seconds: number;
}

export interface Evaluation {
  quality: number;
  completeness: number;
  confidence: number;
  estimated_accuracy: number;
  total_cost: number;
  total_latency: number;
  overall_score: number;
  agent_performance: AgentPerformance[];
}

export interface FinalResult {
  summary: string;
  highlights: string[];
  outputs: Record<string, unknown>;
}

export interface Task {
  id: string;
  raw_task: string;
  created_at: string;
  completed_at?: string;
  budget?: number;
  deadline_minutes?: number;
  quality_preference: QualityPreference;
  max_agents: number;
  allow_parallel: boolean;
  status: TaskStatus;
  inferred_capabilities: Capability[];
  routing_plan?: RoutingPlan;
  executions: AgentExecution[];
  evaluation?: Evaluation;
  final_result?: FinalResult;
  execution_trace: TraceEvent[];
}

/** Slim record persisted in local task history. */
export interface TaskHistoryEntry {
  id: string;
  raw_task: string;
  created_at: string;
  completed_at?: string;
  status: TaskStatus;
  inferred_capabilities: Capability[];
  agents_selected: string[];
  total_cost: number;
  quality_score: number;
  total_latency: number;
}

// ---- Provider adapter interfaces (future-ready) ----
// The router never talks to agents directly - it always goes through an
// AgentProvider. Swapping MockAgentProvider for a REST/MCP/A2A-backed
// implementation of this same interface is the whole integration story.

export interface AgentTaskRequest {
  task_id: string;
  raw_task: string;
  capability: Capability;
  assigned_capabilities: Capability[];
  budget_remaining?: number;
}

export interface AgentTaskResult {
  status: "completed" | "failed";
  duration_seconds: number;
  cost: number;
  confidence: number;
  result: Record<string, unknown>;
  error?: string;
}

export interface AgentProvider {
  execute(agent: Agent, request: AgentTaskRequest): Promise<AgentTaskResult>;
  healthCheck(agent: Agent): Promise<boolean>;
}

// ---- Capability classifier interface (future-ready) ----
// V0 ships a deterministic keyword classifier. A later LLM-backed
// implementation just needs to satisfy this same interface.

export interface CapabilityClassifier {
  classify(rawTask: string): Capability[];
}
