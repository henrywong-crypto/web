import React, { useCallback, useEffect, useState } from "react";
import { Check, Key, Cpu, X } from "lucide-react";
import { useSse } from "../contexts/SseContext";
import type { UiPreferences } from "../hooks/useUiPreferences";

interface SettingsData {
  uses_bedrock: boolean;
  has_api_key: boolean;
  base_url: string | null;
  model: string | null;
}

interface SettingsPanelProps {
  onClose: () => void;
  preferences: UiPreferences;
  onTogglePreference: <K extends keyof UiPreferences>(key: K, value: UiPreferences[K]) => void;
}

export default function SettingsPanel({ onClose, preferences, onTogglePreference }: SettingsPanelProps) {
  const { csrfToken } = useSse();
  const [settings, setSettings] = useState<SettingsData | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveResult, setSaveResult] = useState<"success" | "error" | null>(
    null,
  );
  const [modelSaveResult, setModelSaveResult] = useState<"success" | "error" | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadSettings = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch("/api/settings", { signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as SettingsData;
      setSettings(data);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setLoadError(String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const abortController = new AbortController();
    loadSettings(abortController.signal);
    return () => abortController.abort();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSave = useCallback(async () => {
    if (!apiKey.trim()) return;
    setSaving(true);
    setSaveResult(null);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": csrfToken,
        },
        body: JSON.stringify({ api_key: apiKey.trim() }),
      });
      if (!res.ok) throw new Error((await res.text()) || `HTTP ${res.status}`);
      setSaveResult("success");
      setApiKey("");
      await loadSettings();
    } catch {
      setSaveResult("error");
    } finally {
      setSaving(false);
    }
  }, [apiKey, csrfToken, loadSettings]);

  const handleModelChange = useCallback(async (model: string) => {
    if (!settings) return;
    setSettings({ ...settings, model });
    setModelSaveResult(null);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": csrfToken,
        },
        body: JSON.stringify({ model }),
      });
      if (!res.ok) throw new Error((await res.text()) || `HTTP ${res.status}`);
      setModelSaveResult("success");
    } catch {
      setModelSaveResult("error");
    }
  }, [settings, csrfToken]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        className="mx-4 w-full max-w-md rounded-2xl border border-border bg-card shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-base font-semibold text-foreground">Settings</h2>
          <button
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-4">
          {loading ? (
            <div className="py-6 text-center text-sm text-muted-foreground">
              Loading…
            </div>
          ) : loadError ? (
            <div className="rounded-lg border border-red-500/30 bg-red-950/20 px-3 py-2 text-sm text-red-300">
              {loadError}
            </div>
          ) : settings ? (
            <div className="space-y-4">
              <ModelSelector
                currentModel={settings.model}
                onModelChange={handleModelChange}
                saveResult={modelSaveResult}
              />
              {settings.uses_bedrock ? (
                <div className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
                  Using AWS Bedrock credentials (IAM-managed)
                </div>
              ) : (
                <ApiKeySection
                  hasApiKey={settings.has_api_key}
                  apiKey={apiKey}
                  onApiKeyChange={setApiKey}
                  onSave={handleSave}
                  saving={saving}
                  saveResult={saveResult}
                />
              )}
              {!settings.uses_bedrock && settings.base_url && (
                <div className="text-sm text-muted-foreground">
                  Base URL:{" "}
                  <span className="font-mono text-foreground">
                    {settings.base_url}
                  </span>
                </div>
              )}
            </div>
          ) : null}
        </div>

        {/* Quick Settings section */}
        <div className="border-t border-border p-4">
          <h3 className="mb-3 text-sm font-semibold text-foreground">Quick Settings</h3>
          <div className="space-y-1">
            {QUICK_TOGGLES.map((t) => (
              <label key={t.key} className="flex items-center justify-between rounded-lg px-2 py-2.5">
                <div>
                  <div className="text-sm font-medium text-foreground">{t.label}</div>
                  <div className="text-xs text-muted-foreground">{t.description}</div>
                </div>
                <button
                  role="switch"
                  aria-checked={preferences[t.key]}
                  onClick={() => onTogglePreference(t.key, !preferences[t.key])}
                  className={`relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full transition-colors ${
                    preferences[t.key] ? "bg-primary" : "bg-muted"
                  }`}
                >
                  <span
                    className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform ${
                      preferences[t.key] ? "translate-x-4" : "translate-x-0.5"
                    }`}
                  />
                </button>
              </label>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

const QUICK_TOGGLES: { key: keyof UiPreferences; label: string; description: string }[] = [
  { key: "autoExpandTools", label: "Auto-expand tools", description: "Expand tool cards by default" },
  { key: "showThinking", label: "Show thinking", description: "Show thinking blocks" },
  { key: "autoScrollToBottom", label: "Auto-scroll", description: "Scroll to bottom on new messages" },
];

function ApiKeySection({
  hasApiKey,
  apiKey,
  onApiKeyChange,
  onSave,
  saving,
  saveResult,
}: {
  hasApiKey: boolean;
  apiKey: string;
  onApiKeyChange: (key: string) => void;
  onSave: () => void;
  saving: boolean;
  saveResult: "success" | "error" | null;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Key className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium text-foreground">API Key</span>
        {hasApiKey && (
          <span className="flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-500">
            <Check className="h-3 w-3" />
            Set
          </span>
        )}
      </div>
      <div className="flex gap-2">
        <input
          type="password"
          value={apiKey}
          onChange={(e) => onApiKeyChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") onSave();
          }}
          placeholder={hasApiKey ? "Enter new key to update…" : "sk-ant-…"}
          className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder-muted-foreground/60 focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/20"
        />
        <button
          onClick={onSave}
          disabled={!apiKey.trim() || saving}
          className="rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:bg-muted disabled:text-muted-foreground"
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
      {saveResult === "success" && (
        <p className="text-sm text-emerald-500">API key saved successfully.</p>
      )}
      {saveResult === "error" && (
        <p className="text-sm text-red-400">
          Failed to save. Please try again.
        </p>
      )}
    </div>
  );
}

const MODEL_OPTIONS: { value: string; label: string }[] = [
  { value: "haiku", label: "Haiku" },
  { value: "sonnet", label: "Sonnet" },
  { value: "opus", label: "Opus" },
  { value: "sonnet[1m]", label: "Sonnet [1m]" },
  { value: "opus[1m]", label: "Opus [1m]" },
];

function ModelSelector({
  currentModel,
  onModelChange,
  saveResult,
}: {
  currentModel: string | null;
  onModelChange: (model: string) => void;
  saveResult: "success" | "error" | null;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Cpu className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium text-foreground">Model</span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {MODEL_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            onClick={() => onModelChange(opt.value)}
            className={
              currentModel === opt.value
                ? "rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground"
                : "rounded-lg border border-border px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            }
          >
            {opt.label}
          </button>
        ))}
      </div>
      {saveResult === "success" && (
        <p className="text-sm text-emerald-500">Model updated.</p>
      )}
      {saveResult === "error" && (
        <p className="text-sm text-red-400">Failed to update model.</p>
      )}
    </div>
  );
}
