import { Capability } from "@/types";

export function CapabilityBadges({ capabilities, size = "md" }: { capabilities: Capability[]; size?: "sm" | "md" }) {
  if (capabilities.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1.5">
      {capabilities.map((capability) => (
        <span
          key={capability}
          className={`inline-flex items-center rounded-full border border-accent/30 bg-accent-soft font-medium text-accent-strong ${
            size === "sm" ? "px-2 py-0.5 text-[11px]" : "px-2.5 py-1 text-xs"
          }`}
        >
          {capability.replace(/-/g, " ")}
        </span>
      ))}
    </div>
  );
}
