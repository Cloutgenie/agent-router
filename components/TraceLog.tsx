import { TraceEvent } from "@/types";

export function TraceLog({ trace }: { trace: TraceEvent[] }) {
  if (trace.length === 0) return null;

  return (
    <div className="card p-4">
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-dim">Execution trace</div>
      <ol className="max-h-72 space-y-1.5 overflow-y-auto scrollbar-thin">
        {trace.map((event, i) => (
          <li key={i} className="animate-fade-in-up flex items-baseline gap-2 text-[13px]">
            <span className="font-mono text-[10px] text-muted-dim">{new Date(event.timestamp).toLocaleTimeString()}</span>
            <span className="text-foreground">{event.label}</span>
            {event.detail && <span className="truncate text-muted-dim">- {event.detail}</span>}
          </li>
        ))}
      </ol>
    </div>
  );
}
