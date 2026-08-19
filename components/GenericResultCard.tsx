import { FinalResult } from "@/types";

export function GenericResultCard({ result }: { result: FinalResult }) {
  return (
    <div className="card-raised p-5">
      <div className="mb-3 flex items-center gap-2">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-good-soft text-good">✓</span>
        <h3 className="text-sm font-semibold text-foreground">Outcome</h3>
      </div>
      <p className="text-[15px] leading-relaxed text-foreground">{result.summary}</p>
      {result.highlights.length > 0 && (
        <ul className="mt-3 space-y-1 text-[13px] text-muted">
          {result.highlights.map((h, i) => (
            <li key={i} className="flex gap-2">
              <span className="text-accent">•</span>
              <span>{h}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
