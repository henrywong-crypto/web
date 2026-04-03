import React from "react";

interface TokenIndicatorProps {
  estimatedTokens: number;
  contextWindow: number;
  onCompact: () => void;
}

export default function TokenIndicator({
  estimatedTokens,
  contextWindow,
  onCompact,
}: TokenIndicatorProps) {
  if (estimatedTokens < 1000) return null;

  const ratio = estimatedTokens / contextWindow;
  const percent = Math.min(ratio * 100, 100);
  const showCompact = ratio > 0.8;

  const barColor =
    ratio > 0.8
      ? "bg-red-500"
      : ratio > 0.5
        ? "bg-amber-500"
        : "bg-emerald-500";

  const formatTokens = (n: number): string => {
    if (n >= 1000) return `${(n / 1000).toFixed(0)}K`;
    return String(n);
  };

  return (
    <div className="flex items-center gap-2 px-4 py-1.5">
      <div className="h-1 flex-1 overflow-hidden rounded-full bg-muted/50">
        <div
          className={`h-full rounded-full transition-all duration-500 ${barColor}`}
          style={{ width: `${percent}%` }}
        />
      </div>
      <span className="text-xs tabular-nums text-muted-foreground/60">
        ~{formatTokens(estimatedTokens)}/{formatTokens(contextWindow)}
      </span>
      {showCompact && (
        <button
          type="button"
          onClick={onCompact}
          className="rounded-md bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-500 transition-colors hover:bg-amber-500/20"
        >
          Compact
        </button>
      )}
    </div>
  );
}
