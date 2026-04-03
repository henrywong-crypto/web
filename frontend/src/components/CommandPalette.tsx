import React, { useCallback, useEffect, useRef, useState } from "react";

interface SlashCommand {
  name: string;
  label: string;
  description: string;
  prompt: string;
}

const COMMANDS: SlashCommand[] = [
  {
    name: "commit",
    label: "/commit",
    description: "Create a git commit",
    prompt:
      "Create a git commit for the current changes. First run `git status` and `git diff --staged` to understand what's changed, then write an appropriate commit message and commit. If nothing is staged, stage the relevant files first.",
  },
  {
    name: "review",
    label: "/review",
    description: "Review code changes",
    prompt:
      "Review the current code changes. Run `git diff` to see what's been modified, then provide a thorough code review covering correctness, style, potential bugs, and suggestions for improvement.",
  },
  {
    name: "diff",
    label: "/diff",
    description: "Show git diff",
    prompt: "Show the current git diff. Run `git diff` and `git status` and present the results.",
  },
  {
    name: "compact",
    label: "/compact",
    description: "Compress context",
    prompt:
      "Please summarize our conversation so far into a concise summary, preserving key decisions, file changes, and important context. Then we can continue with a fresh context window.",
  },
  {
    name: "memory",
    label: "/memory",
    description: "Manage persistent memory",
    prompt:
      "Show me what's in the persistent memory (read ~/.claude/CLAUDE.md if it exists). Then ask me if I'd like to add, update, or remove any memories.",
  },
  {
    name: "plan",
    label: "/plan",
    description: "Enter plan mode",
    prompt:
      "Before making any changes, let's plan first. Explore the relevant code, understand the current architecture, and propose a detailed implementation plan for me to review before you start coding.",
  },
];

interface CommandPaletteProps {
  filter: string;
  onSelect: (command: string) => void;
  onClose: () => void;
}

export default function CommandPalette({
  filter,
  onSelect,
  onClose,
}: CommandPaletteProps) {
  const filtered = COMMANDS.filter((c) =>
    c.name.startsWith(filter.toLowerCase()),
  );
  const [selectedIndex, setSelectedIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setSelectedIndex(0);
  }, [filter]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        if (filtered[selectedIndex]) {
          onSelect(filtered[selectedIndex].prompt);
        }
      } else if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    },
    [filtered, selectedIndex, onSelect, onClose],
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, [handleKeyDown]);

  if (filtered.length === 0) return null;

  return (
    <div
      ref={listRef}
      className="absolute bottom-full left-0 right-0 z-50 mb-1 overflow-hidden rounded-xl border border-border bg-card shadow-xl shadow-black/15"
    >
      <div className="px-2.5 pb-1 pt-2">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground/60">
          Commands
        </span>
      </div>
      <div className="max-h-52 overflow-y-auto px-1 pb-1">
        {filtered.map((cmd, i) => (
          <button
            key={cmd.name}
            type="button"
            onMouseDown={(e) => {
              e.preventDefault();
              onSelect(cmd.prompt);
            }}
            onMouseEnter={() => setSelectedIndex(i)}
            className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors duration-75 ${
              i === selectedIndex
                ? "bg-primary/10 text-foreground"
                : "text-muted-foreground hover:bg-accent/50"
            }`}
          >
            <span className="font-mono text-sm font-medium text-primary">
              {cmd.label}
            </span>
            <span className="text-sm text-muted-foreground/70">
              {cmd.description}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
