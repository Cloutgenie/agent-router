import { BuyerRecord } from "@/types";

const CSV_HEADERS = [
  "company",
  "website",
  "industry",
  "opportunity_score",
  "why_now",
  "funding_signal",
  "hiring_signal",
  "ai_signal",
  "security_signal",
  "decision_maker",
  "title",
  "email",
  "linkedin",
  "confidence",
  "verified",
  "evidence_sources",
  "evidence_urls",
] as const;

function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

function evidenceUrls(record: BuyerRecord): string {
  return record.evidence
    .map((e) => e.url)
    .filter((u): u is string => Boolean(u))
    .join(" | ");
}

/** CRM-ready export fields (V4 #25) - usable as-is for a generic CSV import into HubSpot/Salesforce/etc. */
export function toCrmRow(record: BuyerRecord): Record<(typeof CSV_HEADERS)[number], string> {
  return {
    company: record.company,
    website: record.website,
    industry: record.industry,
    opportunity_score: String(record.opportunityScore.total),
    why_now: record.whyNow,
    funding_signal: record.fundingSignal,
    hiring_signal: record.hiringSignal,
    ai_signal: record.aiSignal,
    security_signal: record.securitySignal,
    decision_maker: record.contact?.fullName ?? "",
    title: record.decisionMakerRole,
    email: record.contact?.email ?? "",
    linkedin: record.contact?.linkedinUrl ?? "",
    confidence: String(record.confidence),
    verified: String(record.verification.verified),
    evidence_sources: String(record.verification.sourceCount),
    evidence_urls: evidenceUrls(record),
  };
}

export function buildCsv(records: BuyerRecord[]): string {
  const rows = records.map(toCrmRow);
  const lines = [CSV_HEADERS.join(",")];
  for (const row of rows) {
    lines.push(CSV_HEADERS.map((h) => csvEscape(row[h])).join(","));
  }
  return lines.join("\n");
}

export function buildJson(records: BuyerRecord[]): string {
  return JSON.stringify(records, null, 2);
}

export function downloadFile(filename: string, content: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
