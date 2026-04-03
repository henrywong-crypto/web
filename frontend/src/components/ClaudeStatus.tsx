import React, { useEffect, useState } from "react";
import type { StreamPhaseInfo } from "../types";

function formatElapsedTime(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 1) return `${seconds}s`;
  return `${minutes}m ${seconds}s`;
}

function phaseLabel(info: StreamPhaseInfo): string {
  switch (info.phase) {
    case "processing":
      return "Processing";
    case "thinking":
      return "Thinking";
    case "responding":
      return "Responding";
    case "tool_use":
      return info.toolName ? `Using ${info.toolName}` : "Using tool";
    default:
      return "Processing";
  }
}

interface ClaudeStatusProps {
  isLoading: boolean;
  streamPhase: StreamPhaseInfo;
  onAbort?: () => void;
}

export default function ClaudeStatus({
  isLoading,
  streamPhase,
  onAbort,
}: ClaudeStatusProps) {
  // Tick counter just to force re-render every second
  const [, setTick] = useState(0);

  useEffect(() => {
    if (!isLoading) return;
    const timer = window.setInterval(() => setTick((t) => t + 1), 1000);
    return () => window.clearInterval(timer);
  }, [isLoading]);

  if (!isLoading) return null;

  // Compute elapsed from the per-conversation startedAt timestamp
  const startedAt = streamPhase.startedAt ?? Date.now();
  const elapsedTime = Math.floor((Date.now() - startedAt) / 1000);
  const statusText = phaseLabel(streamPhase);
  const elapsedLabel = elapsedTime > 0 ? formatElapsedTime(elapsedTime) : "";

  return (
    <div className="px-4 py-2">
      <div
        className="flex items-center gap-2.5"
        role="status"
        aria-live="polite"
      >
        <span className="flex items-center gap-[3px]" aria-hidden="true">
          <span className="thinking-dot h-1.5 w-1.5 rounded-full bg-primary/70" />
          <span className="thinking-dot h-1.5 w-1.5 rounded-full bg-primary/70" />
          <span className="thinking-dot h-1.5 w-1.5 rounded-full bg-primary/70" />
        </span>
        <span className="text-sm font-medium text-muted-foreground">
          {statusText}
          {elapsedLabel && (
            <span className="ml-1.5 tabular-nums font-normal text-muted-foreground/35">
              · {elapsedLabel}
            </span>
          )}
        </span>
      </div>
    </div>
  );
}
