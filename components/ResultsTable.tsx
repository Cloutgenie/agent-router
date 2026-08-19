"use client";

import { useEffect, useMemo, useState } from "react";
import { BuyerRecord } from "@/types";
import { BUILT_IN_VIEWS, deleteSavedView, loadSavedViews, saveSavedView, SavedView } from "@/lib/savedViews";

type SortKey = "score" | "confidence" | "company";

export function ResultsTable({
  records,
  selectedIds,
  onToggleSelect,
  onToggleSelectAll,
  onOpenDetail,
}: {
  records: BuyerRecord[];
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  onToggleSelectAll: (ids: string[]) => void;
  onOpenDetail: (record: BuyerRecord) => void;
}) {
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("score");
  const [minScore, setMinScore] = useState(0);
  const [minConfidence, setMinConfidence] = useState(0);
  const [verifiedOnly, setVerifiedOnly] = useState(false);
  const [customViews, setCustomViews] = useState<SavedView[]>([]);
  const [activeView, setActiveView] = useState<string | null>(null);

  useEffect(() => {
    // Reads a client-only store (localStorage) that necessarily differs from
    // the server-rendered snapshot - this one-time sync-on-mount is the
    // correct pattern here, not a derivable-from-props case the lint rule
    // is meant to catch.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCustomViews(loadSavedViews());
  }, []);

  function applyView(view: SavedView) {
    setMinScore(view.minScore);
    setMinConfidence(view.minConfidence);
    setVerifiedOnly(view.verifiedOnly);
    setActiveView(view.name);
  }

  function saveCurrentView() {
    const name = window.prompt("Name this view");
    if (!name) return;
    setCustomViews(saveSavedView({ name, minScore, minConfidence, verifiedOnly }));
    setActiveView(name);
  }

  function removeView(name: string) {
    setCustomViews(deleteSavedView(name));
    if (activeView === name) setActiveView(null);
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return records
      .filter((r) => r.opportunityScore.total >= minScore)
      .filter((r) => r.confidence >= minConfidence)
      .filter((r) => !verifiedOnly || r.verification.verified)
      .filter(
        (r) =>
          !q ||
          r.company.toLowerCase().includes(q) ||
          r.industry.toLowerCase().includes(q) ||
          r.decisionMakerRole.toLowerCase().includes(q)
      )
      .sort((a, b) => {
        if (sortKey === "company") return a.company.localeCompare(b.company);
        if (sortKey === "confidence") return b.confidence - a.confidence;
        return b.opportunityScore.total - a.opportunityScore.total;
      });
  }, [records, search, sortKey, minScore, minConfidence, verifiedOnly]);

  const allVisibleSelected = filtered.length > 0 && filtered.every((r) => selectedIds.has(r.id));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[11px] font-medium uppercase tracking-wide text-muted-dim">Saved views</span>
        {[...BUILT_IN_VIEWS, ...customViews].map((view) => (
          <button
            key={view.name}
            type="button"
            onClick={() => applyView(view)}
            className={`rounded-full border px-2.5 py-1 text-[11px] transition ${
              activeView === view.name
                ? "border-accent bg-accent-soft text-accent-strong"
                : "border-border text-muted hover:text-foreground"
            }`}
          >
            {view.name}
          </button>
        ))}
        <button
          type="button"
          onClick={saveCurrentView}
          className="rounded-full border border-dashed border-border px-2.5 py-1 text-[11px] text-muted-dim hover:text-foreground"
        >
          + Save current
        </button>
        {activeView && customViews.some((v) => v.name === activeView) && (
          <button
            type="button"
            onClick={() => removeView(activeView)}
            className="text-[11px] text-bad hover:underline"
          >
            Delete
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search company, industry, role..."
          className="min-w-[200px] flex-1 rounded-lg border border-border bg-surface-raised px-3 py-1.5 text-sm text-foreground placeholder:text-muted-dim focus:border-accent focus:outline-none"
        />
        <select
          value={sortKey}
          onChange={(e) => setSortKey(e.target.value as SortKey)}
          className="rounded-lg border border-border bg-surface-raised px-2.5 py-1.5 text-xs text-foreground"
        >
          <option value="score">Sort: opportunity score</option>
          <option value="confidence">Sort: confidence</option>
          <option value="company">Sort: company name</option>
        </select>
        <label className="flex items-center gap-1.5 text-xs text-muted">
          Min score
          <input
            type="number"
            min={0}
            max={100}
            value={minScore}
            onChange={(e) => setMinScore(Number(e.target.value))}
            className="w-16 rounded-lg border border-border bg-surface-raised px-2 py-1 text-xs text-foreground"
          />
        </label>
        <label className="flex items-center gap-1.5 text-xs text-muted">
          Min confidence
          <input
            type="number"
            min={0}
            max={1}
            step={0.1}
            value={minConfidence}
            onChange={(e) => setMinConfidence(Number(e.target.value))}
            className="w-16 rounded-lg border border-border bg-surface-raised px-2 py-1 text-xs text-foreground"
          />
        </label>
        <label className="flex items-center gap-1.5 text-xs text-muted">
          <input type="checkbox" checked={verifiedOnly} onChange={(e) => setVerifiedOnly(e.target.checked)} className="accent-accent" />
          Verified only
        </label>
      </div>

      <div className="overflow-x-auto scrollbar-thin">
        <table className="w-full min-w-[900px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-dim">
              <th className="w-8 py-2 pr-2">
                <input
                  type="checkbox"
                  checked={allVisibleSelected}
                  onChange={() => onToggleSelectAll(filtered.map((r) => r.id))}
                  className="accent-accent"
                />
              </th>
              <th className="py-2 pr-3 font-medium">Score</th>
              <th className="py-2 pr-3 font-medium">Company</th>
              <th className="py-2 pr-3 font-medium">Why now</th>
              <th className="py-2 pr-3 font-medium">Funding</th>
              <th className="py-2 pr-3 font-medium">AI signal</th>
              <th className="py-2 pr-3 font-medium">Security signal</th>
              <th className="py-2 pr-3 font-medium">Decision maker</th>
              <th className="py-2 pr-3 font-medium">Confidence</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((record) => (
              <tr
                key={record.id}
                className="cursor-pointer border-b border-border/60 align-top transition hover:bg-surface-raised"
                onClick={() => onOpenDetail(record)}
              >
                <td className="py-2.5 pr-2" onClick={(e) => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    checked={selectedIds.has(record.id)}
                    onChange={() => onToggleSelect(record.id)}
                    className="accent-accent"
                  />
                </td>
                <td className="py-2.5 pr-3">
                  <span className="font-mono text-sm font-semibold text-accent-strong">{record.opportunityScore.total}</span>
                </td>
                <td className="py-2.5 pr-3">
                  <div className="font-medium text-foreground">{record.company}</div>
                  <div className="text-[11px] text-muted-dim">{record.industry}</div>
                  {record.verification.verified ? (
                    <span className="mt-0.5 inline-block rounded-full bg-good-soft px-1.5 py-0.5 text-[10px] text-good">verified</span>
                  ) : (
                    <span className="mt-0.5 inline-block rounded-full bg-warn-soft px-1.5 py-0.5 text-[10px] text-warn">needs review</span>
                  )}
                </td>
                <td className="max-w-[220px] py-2.5 pr-3 text-[12px] text-muted">{record.whyNow}</td>
                <td className="max-w-[160px] py-2.5 pr-3 text-[12px] text-muted">{record.fundingSignal}</td>
                <td className="max-w-[160px] py-2.5 pr-3 text-[12px] text-muted">{record.aiSignal}</td>
                <td className="max-w-[160px] py-2.5 pr-3 text-[12px] text-muted">{record.securitySignal}</td>
                <td className="py-2.5 pr-3 text-[12px] text-foreground">{record.decisionMakerRole}</td>
                <td className="py-2.5 pr-3 font-mono text-[12px] text-foreground">{Math.round(record.confidence * 100)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <p className="py-6 text-center text-sm text-muted-dim">No results match the current filters.</p>
        )}
      </div>
    </div>
  );
}
