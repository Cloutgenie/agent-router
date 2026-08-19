export type BenchmarkDifficulty = "easy" | "medium" | "sparse-evidence" | "conflicting-evidence";

export interface BenchmarkScenario {
  id: string;
  name: string;
  difficulty: BenchmarkDifficulty;
  goal: string;
  /** What makes this scenario worth running - not simulated by name, just documents intent (spec #49). */
  note: string;
}

/**
 * Gold benchmark dataset (spec #49) - at least 20 scenarios spanning easy,
 * medium, sparse-evidence, and conflicting-evidence cases. Every scenario
 * runs through the same Demo Mode mock provider pool (`data/demo-companies.ts`)
 * that already has deliberately uneven signal strength, so sparse/conflicting
 * scenarios genuinely surface weaker evidence and lower verification rates -
 * this dataset varies the goal and requested depth, not a bespoke fixture per
 * scenario. See `lib/benchmarks/runBenchmark.ts` for what "run" means here:
 * the existing single-provider-baseline vs. routed-execution comparison
 * (`StrategyComparison`), applied uniformly across all 20.
 */
export const BENCHMARK_SCENARIOS: BenchmarkScenario[] = [
  // --- Easy: clean, well-covered signals ---
  {
    id: "easy-1",
    name: "Cybersecurity startups, recent funding + hiring",
    difficulty: "easy",
    goal: "Find 5 cybersecurity startups that recently raised funding and are actively hiring security engineers.",
    note: "The flagship buyer-discovery goal - strong funding, hiring, and AI signals across most demo companies.",
  },
  {
    id: "easy-2",
    name: "AI-adopting security vendors",
    difficulty: "easy",
    goal: "Find 5 security companies that have shipped an AI-based product recently.",
    note: "AI adoption signal is explicit and well-evidenced for the top demo companies.",
  },
  {
    id: "easy-3",
    name: "Well-funded Series A security startups",
    difficulty: "easy",
    goal: "Find 5 Series A cybersecurity companies that closed a round in the last 90 days.",
    note: "Funding freshness falls in the 'strongest' tier for most matches.",
  },
  {
    id: "easy-4",
    name: "Security teams actively hiring a Head of Security",
    difficulty: "easy",
    goal: "Find 5 companies publicly hiring a Head of Security or CISO right now.",
    note: "Hiring signal is unambiguous - a named open role, not inferred headcount growth.",
  },
  {
    id: "easy-5",
    name: "Decision-maker coverage check",
    difficulty: "easy",
    goal: "Find 5 cybersecurity companies and identify their likely security decision maker.",
    note: "Exercises contact-enrichment coverage on companies with strong existing evidence.",
  },

  // --- Medium: mixed signal strength, some exclusions expected ---
  {
    id: "medium-1",
    name: "Mixed-strength buyer list",
    difficulty: "medium",
    goal: "Find 8 cybersecurity startups that recently raised funding and appear likely to need AI security services.",
    note: "Wider result count pulls in weaker-signal companies the Evaluator should downgrade, not just top hits.",
  },
  {
    id: "medium-2",
    name: "Competitor landscape for a B2B SaaS product",
    difficulty: "medium",
    goal: "Research 10 competitors for a B2B SaaS security product.",
    note: "Exercises the generic (non buyer-discovery) workflow, not just the flagship one.",
  },
  {
    id: "medium-3",
    name: "Security hiring signals at moderate confidence",
    difficulty: "medium",
    goal: "Identify 6 companies showing moderate but growing security hiring activity.",
    note: "Hiring signal present but weaker - should land mid-table on opportunity score.",
  },
  {
    id: "medium-4",
    name: "AI security fit across a broader pool",
    difficulty: "medium",
    goal: "Find 10 companies that may need AI security services based on their current AI adoption.",
    note: "Larger pool surfaces both strong fits and companies the Evaluator should exclude for weak AI signal.",
  },
  {
    id: "medium-5",
    name: "Market research with light company detail",
    difficulty: "medium",
    goal: "Research the market size and trends for AI-driven cybersecurity tooling.",
    note: "Market-research capability without a company list - tests the non-byCompany code path.",
  },

  // --- Sparse-evidence: few or weak sources ---
  {
    id: "sparse-1",
    name: "Small result count, minimal corroboration",
    difficulty: "sparse-evidence",
    goal: "Find 2 cybersecurity startups that recently raised funding.",
    note: "Small requested count means fewer independent sources per claim - tests low evidence-coverage handling.",
  },
  {
    id: "sparse-2",
    name: "No contact found for most companies",
    difficulty: "sparse-evidence",
    goal: "Find 5 early-stage security startups and their security decision maker, even if hard to find.",
    note: "Exercises `email = null` / `verificationStatus: not-found` - never fabricate a missing contact.",
  },
  {
    id: "sparse-3",
    name: "Single weak AI signal",
    difficulty: "sparse-evidence",
    goal: "Find 3 companies with any AI product signal, even a faint one.",
    note: "Low per-claim confidence should pull opportunity score down, not get rounded up.",
  },
  {
    id: "sparse-4",
    name: "Unfunded or pre-seed companies",
    difficulty: "sparse-evidence",
    goal: "Find 4 pre-seed security startups that haven't announced funding yet.",
    note: "Funding claim should come back unverified/low-confidence rather than invented.",
  },
  {
    id: "sparse-5",
    name: "Minimal hiring footprint",
    difficulty: "sparse-evidence",
    goal: "Find 3 small security teams with only one or two open roles.",
    note: "Thin hiring evidence - freshness and source count both constrained.",
  },

  // --- Conflicting-evidence: contradictions expected ---
  {
    id: "conflict-1",
    name: "Funding round disagreement",
    difficulty: "conflicting-evidence",
    goal: "Find 5 cybersecurity startups and verify their most recent funding round carefully.",
    note: "Funding provider sometimes returns a second source with a different date - should trigger contradiction detection, not silent averaging.",
  },
  {
    id: "conflict-2",
    name: "Stale vs. current hiring signal",
    difficulty: "conflicting-evidence",
    goal: "Find 5 companies hiring security roles and double-check the postings are still open.",
    note: "Job-posting freshness varies across sources - some scenarios should show a 'needs review' hiring claim.",
  },
  {
    id: "conflict-3",
    name: "Executive title mismatch",
    difficulty: "conflicting-evidence",
    goal: "Find 5 companies and confirm the correct title for their security decision maker.",
    note: "Contact enrichment vs. hiring-post role can disagree on the exact title - never resolved by picking one silently.",
  },
  {
    id: "conflict-4",
    name: "Series A vs. Series B disagreement",
    difficulty: "conflicting-evidence",
    goal: "Find 5 companies and confirm whether their most recent round was Series A or Series B.",
    note: "Classic funding-stage contradiction the spec calls out explicitly.",
  },
  {
    id: "conflict-5",
    name: "Duplicate company across discovery queries",
    difficulty: "conflicting-evidence",
    goal: "Find 8 cybersecurity companies with strong AI and security signals combined.",
    note: "Wider discovery increases the odds of the same company surfacing twice - exercises canonicalization/dedup, not just verification.",
  },
];
