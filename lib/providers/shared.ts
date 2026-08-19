import { Evidence, EvidenceType, SourceQuality } from "@/types";

/** Default trust tier per evidence type (V4 #28) - overridable per call. */
const DEFAULT_SOURCE_QUALITY: Record<EvidenceType, SourceQuality> = {
  website: "high",
  funding: "high",
  job_posting: "high",
  news: "medium",
  company_data: "medium",
  provider_output: "medium",
};

export function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function jitter(base: number, spread: number): number {
  return base + (Math.random() * 2 - 1) * spread;
}

export function pick<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

export function pickN<T>(items: T[], n: number): T[] {
  const shuffled = [...items].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, Math.min(n, shuffled.length));
}

let evidenceCounter = 0;
export function makeEvidence(input: {
  type: EvidenceType;
  title: string;
  source: string;
  url?: string;
  excerpt?: string;
  confidence: number;
  /** Backdate the evidence a bit so "freshness" scoring has variance to work with. */
  ageDays?: number;
  sourceQuality?: SourceQuality;
  query?: string;
}): Evidence {
  evidenceCounter += 1;
  const publishedAt = new Date(
    Date.now() - (input.ageDays ?? 0) * 24 * 60 * 60 * 1000
  ).toISOString();
  // Retrieval happens "now" - only the underlying fact is backdated.
  const retrievedAt = new Date().toISOString();

  return {
    id: `ev-${Date.now().toString(36)}-${evidenceCounter}`,
    type: input.type,
    title: input.title,
    source: input.source,
    sourceQuality: input.sourceQuality ?? DEFAULT_SOURCE_QUALITY[input.type],
    url: input.url,
    excerpt: input.excerpt,
    retrievedAt,
    publishedAt,
    confidence: Math.round(input.confidence * 100) / 100,
    query: input.query,
  };
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
