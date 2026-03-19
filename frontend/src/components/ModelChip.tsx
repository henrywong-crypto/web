import React, { useCallback, useEffect, useRef, useState } from "react";
import { ChevronUp } from "lucide-react";
import { useSse } from "../contexts/SseContext";

const MODEL_OPTIONS = [
  { value: "haiku", label: "Haiku" },
  { value: "sonnet", label: "Sonnet" },
  { value: "opus", label: "Opus" },
  { value: "sonnet[1m]", label: "Sonnet [1m]" },
  { value: "opus[1m]", label: "Opus [1m]" },
];

function displayLabel(model: string | null): string {
  if (!model) return "Model";
  const opt = MODEL_OPTIONS.find((o) => o.value === model);
  return opt ? opt.label : model;
}

export default function ModelChip() {
  const { csrfToken } = useSse();
  const [model, setModel] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [saveResult, setSaveResult] = useState<"success" | "error" | null>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/settings")
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled) setModel(data.model ?? null);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // Close popover on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const handleChange = useCallback(async (value: string) => {
    setModel(value);
    setSaveResult(null);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": csrfToken,
        },
        body: JSON.stringify({ model: value }),
      });
      setSaveResult(res.ok ? "success" : "error");
    } catch {
      setSaveResult("error");
    }
  }, [csrfToken]);

  return (
    <div className="relative" ref={popoverRef}>
      <button
        title="Change model"
        onClick={() => { setOpen((v) => !v); setSaveResult(null); }}
        className="flex items-center gap-0.5 rounded-lg px-1.5 py-1 text-[10px] font-semibold text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        <span className="max-w-[36px] truncate">{displayLabel(model)}</span>
        <ChevronUp className="h-2.5 w-2.5 flex-shrink-0 opacity-60" />
      </button>

      {open && (
        <div className="absolute bottom-full left-1/2 z-50 mb-2 -translate-x-1/2 rounded-xl border border-border bg-card p-2 shadow-xl">
          <div className="flex flex-col gap-1" style={{ minWidth: "120px" }}>
            {MODEL_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => handleChange(opt.value)}
                className={`rounded-lg px-3 py-1.5 text-left text-xs font-medium transition-colors ${
                  model === opt.value
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          {saveResult === "success" && (
            <p className="mt-1.5 text-center text-[10px] text-emerald-500">Updated</p>
          )}
          {saveResult === "error" && (
            <p className="mt-1.5 text-center text-[10px] text-red-400">Failed</p>
          )}
        </div>
      )}
    </div>
  );
}
