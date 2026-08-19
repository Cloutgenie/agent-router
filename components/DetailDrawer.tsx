"use client";

import { BuyerRecord, Claim, ReviewState } from "@/types";

const SCORE_ROWS: { key: keyof BuyerRecord["opportunityScore"]; label: string }[] = [
  { key: "funding", label: "Funding" },
  { key: "hiring", label: "Hiring" },
  { key: "aiSignal", label: "AI signal" },
  { key: "companyFit", label: "Company fit" },
  { key: "contactability", label: "Contactability" },
  { key: "evidenceQuality", label: "Evidence quality" },
  { key: "freshness", label: "Freshness" },
];

const REVIEW_LABELS: Record<ReviewState, string> = {
  unreviewed: "Unreviewed",
  accepted: "Accepted",
  rejected: "Rejected",
  "needs-review": "Needs review",
};

function ClaimRow({ claim }: { claim: Claim }) {
  return (
    <div className="rounded-lg border border-border bg-surface-raised p-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-dim">
          {claim.type.replace(/_/g, " ")}
        </span>
        <span
          className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
            claim.contradiction
              ? "bg-warn-soft text-warn"
              : claim.verified
                ? "bg-good-soft text-good"
                : "bg-bad-soft text-bad"
          }`}
        >
          {claim.contradiction ? "needs review" : claim.verified ? "verified" : "unverified"}
        </span>
      </div>
      {claim.statement && <p className="mt-1 text-[12px] text-foreground">{claim.statement}</p>}
      <div className="mt-1 flex items-center gap-3 text-[11px] text-muted-dim">
        <span>{Math.round(claim.confidence * 100)}% confidence</span>
        <span className="capitalize">{claim.freshness}</span>
        <span>{claim.evidenceIds.length} source{claim.evidenceIds.length === 1 ? "" : "s"}</span>
      </div>
      {claim.contradiction && <p className="mt-1 text-[11px] text-warn">{claim.contradiction}</p>}
    </div>
  );
}

export function DetailDrawer({
  record,
  onClose,
  onReview,
  onFollowUp,
}: {
  record: BuyerRecord;
  onClose: () => void;
  onReview: (id: string, state: ReviewState) => void;
  onFollowUp: (action: "find-decision-makers" | "deeper-research") => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 bg-black/60" />
      <div className="relative flex h-full w-full max-w-lg flex-col overflow-y-auto border-l border-border-strong bg-surface p-5 shadow-2xl scrollbar-thin animate-fade-in-up">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-foreground">{record.company}</h2>
            <p className="text-xs text-muted-dim">
              {record.industry} · {record.website}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-border px-2.5 py-1 text-xs text-muted hover:bg-surface-raised hover:text-foreground"
          >
            Close
          </button>
        </div>

        <div className="mb-4 flex items-center gap-2">
          <span className="rounded-full bg-accent-soft px-3 py-1 font-mono text-lg font-bold text-accent-strong">
            {record.opportunityScore.total}
          </span>
          <span className="text-xs text-muted">opportunity score</span>
          <span className="ml-auto rounded-full border border-border px-2 py-0.5 text-[11px] text-muted">
            {REVIEW_LABELS[record.reviewState]}
          </span>
        </div>

        <Section title="Why now">
          <p className="text-[13px] leading-relaxed text-foreground">{record.whyNow}</p>
        </Section>

        <Section title="Why this company ranked here">
          <ul className="space-y-1 text-[13px] text-muted">
            {record.decisionFactors.map((factor, i) => (
              <li key={i} className="flex gap-2">
                <span className="text-good">+</span>
                <span>{factor}</span>
              </li>
            ))}
          </ul>
        </Section>

        <Section title="Opportunity score breakdown">
          <div className="space-y-1.5">
            {SCORE_ROWS.map((row) => (
              <div key={row.key} className="flex items-center justify-between text-[12px]">
                <span className="text-muted">{row.label}</span>
                <span className="font-mono text-foreground">{record.opportunityScore[row.key]}</span>
              </div>
            ))}
          </div>
        </Section>

        <Section title={`Claims - ${record.verification.verifiedClaimCount}/${record.verification.totalClaimCount} verified`}>
          <div className="space-y-2">
            {record.verification.claims.map((claim) => (
              <ClaimRow key={claim.id} claim={claim} />
            ))}
          </div>
          {record.verification.issues.length > 0 && (
            <ul className="mt-2 space-y-1 text-[11px] text-bad">
              {record.verification.issues.map((issue, i) => (
                <li key={i}>- {issue}</li>
              ))}
            </ul>
          )}
        </Section>

        <Section title={`Evidence - ${record.evidence.length} source${record.evidence.length === 1 ? "" : "s"}`}>
          <div className="space-y-2">
            {record.evidence.map((ev) => (
              <div key={ev.id} className="rounded-lg border border-border bg-surface-raised p-2.5 text-[12px]">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-foreground">{ev.title}</span>
                  <span className="rounded-full bg-surface px-1.5 py-0.5 text-[10px] uppercase text-muted-dim">
                    {ev.sourceQuality}
                  </span>
                </div>
                {ev.excerpt && <p className="mt-1 text-muted">{ev.excerpt}</p>}
                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-muted-dim">
                  <span>{ev.source}</span>
                  <span>{Math.round(ev.confidence * 100)}% confidence</span>
                  {ev.publishedAt && <span>published {new Date(ev.publishedAt).toLocaleDateString()}</span>}
                </div>
              </div>
            ))}
          </div>
        </Section>

        <Section title="Decision maker">
          <p className="text-[13px] text-foreground">{record.decisionMakerRole}</p>
          {record.contact ? (
            <div className="mt-1 space-y-0.5 text-[12px] text-muted">
              {record.contact.fullName && <p>{record.contact.fullName}</p>}
              {record.contact.email ? (
                <p>
                  {record.contact.email}{" "}
                  <span className="text-muted-dim">({Math.round((record.contact.emailConfidence ?? 0) * 100)}% confidence)</span>
                </p>
              ) : (
                <p className="text-muted-dim">Email not found - not fabricated.</p>
              )}
              {record.contact.linkedinUrl && (
                <a href={record.contact.linkedinUrl} target="_blank" rel="noreferrer" className="text-accent-strong hover:underline">
                  LinkedIn profile
                </a>
              )}
              <p className="text-muted-dim capitalize">{record.contact.verificationStatus}</p>
            </div>
          ) : (
            <p className="mt-1 text-[12px] text-muted-dim">Run &quot;Find decision makers&quot; to enrich full contact details.</p>
          )}
        </Section>

        <Section title="Providers used">
          <div className="flex flex-wrap gap-1.5">
            {record.providersUsed.map((p) => (
              <span key={p} className="rounded-full border border-border bg-surface-raised px-2 py-0.5 text-[11px] text-muted">
                {p}
              </span>
            ))}
          </div>
        </Section>

        <div className="mt-2 flex flex-wrap gap-2 border-t border-border pt-4">
          <button
            type="button"
            onClick={() => onReview(record.id, "accepted")}
            className="rounded-lg border border-good/30 bg-good-soft px-3 py-1.5 text-xs font-medium text-good hover:brightness-110"
          >
            Accept
          </button>
          <button
            type="button"
            onClick={() => onReview(record.id, "rejected")}
            className="rounded-lg border border-bad/30 bg-bad-soft px-3 py-1.5 text-xs font-medium text-bad hover:brightness-110"
          >
            Reject
          </button>
          <button
            type="button"
            onClick={() => onReview(record.id, "needs-review")}
            className="rounded-lg border border-warn/30 bg-warn-soft px-3 py-1.5 text-xs font-medium text-warn hover:brightness-110"
          >
            Needs review
          </button>
          <button
            type="button"
            onClick={() => onFollowUp("find-decision-makers")}
            className="ml-auto rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-white hover:bg-accent-strong"
          >
            Find decision makers
          </button>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-dim">{title}</h3>
      {children}
    </div>
  );
}
