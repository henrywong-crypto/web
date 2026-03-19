import React from "react";
import { PanelRightClose, Zap } from "lucide-react";

interface ShortcutPanelProps {
  onClose: () => void;
  onSettingsOpen: () => void;
  onSendCommand: (command: string) => void;
}

const SLASH_COMMANDS = ["/clear", "/compact", "/cost", "/status"] as const;

export default function ShortcutPanel({
  onClose,
  onSettingsOpen,
  onSendCommand,
}: ShortcutPanelProps) {
  return (
    <div className="flex min-h-0 flex-1 flex-col bg-card">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <div className="flex items-center gap-1.5">
          <Zap className="h-3.5 w-3.5 text-primary" />
          <span className="text-base font-semibold text-foreground">Shortcuts</span>
        </div>
        <button
          title="Hide shortcuts"
          onClick={onClose}
          className="flex items-center justify-center rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
        >
          <PanelRightClose className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Actions */}
      <div className="flex flex-col gap-1.5 p-3">
        <button
          type="button"
          onClick={onSettingsOpen}
          className="flex items-center justify-center rounded-lg border border-border bg-background px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
        >
          Change Model
        </button>
        <button
          type="button"
          onClick={() => onSendCommand("/terminal claude --resume")}
          className="flex items-center justify-center rounded-lg border border-border bg-background px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
        >
          Resume
        </button>
        <button
          type="button"
          onClick={() => onSendCommand("Hi! What can you help me with today?")}
          className="flex items-center justify-center rounded-lg border border-border bg-background px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
        >
          Say Hi
        </button>
      </div>

      {/* Slash commands */}
      <div className="border-t border-border px-3 py-2">
        <div className="grid grid-cols-2 gap-1.5">
          {SLASH_COMMANDS.map((cmd) => (
            <button
              key={cmd}
              type="button"
              onClick={() => onSendCommand(cmd)}
              className="rounded-lg border border-border bg-background px-2 py-1.5 font-mono text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              {cmd}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
