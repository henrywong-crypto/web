import React from "react";
import {
  Brain,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  ListTodo,
  Loader2,
  Plus,
  RefreshCw,
  Wrench,
} from "lucide-react";
import type { ToolResult } from "../types";
import SubAgentCard from "./SubAgentCard";
import ToolDiffViewer from "./ToolDiffViewer";

interface ToolRendererProps {
  toolName: string;
  toolInput: Record<string, unknown>;
  toolResult?: ToolResult;
  autoExpandTools?: boolean;
}

export default function ToolRenderer({
  toolName,
  toolInput,
  toolResult,
  autoExpandTools,
}: ToolRendererProps) {
  // Render sub-agent card for Agent tool
  if (toolName === "Agent") {
    return (
      <SubAgentCard toolInput={toolInput} toolResult={toolResult} />
    );
  }

  // Render compact cards for task tools
  if (isTaskTool(toolName)) {
    return <TaskToolCard toolName={toolName} toolInput={toolInput} toolResult={toolResult} />;
  }

  // Render TodoWrite as a task list card
  if (toolName === "TodoWrite") {
    return <TodoWriteCard toolInput={toolInput} />;
  }

  // Render memory notification for Write/Edit to memory files
  if (isMemoryFile(toolName, toolInput)) {
    return <MemoryUpdateCard toolInput={toolInput} />;
  }

  return (
    <div className="my-0.5 overflow-hidden rounded-xl border border-border/60 bg-card shadow-md shadow-black/5 ring-1 ring-border/10">
      <ToolHeader
        toolName={toolName}
        toolInput={toolInput}
        toolResult={toolResult}
        autoExpandTools={autoExpandTools}
      />
    </div>
  );
}

type DiffBadge = "Edit" | "New" | "Patch";

function isEditTool(toolName: string): boolean {
  return (
    toolName === "Edit" || toolName === "Write" || toolName === "ApplyPatch"
  );
}

function getDiffProps(
  toolName: string,
  input: Record<string, unknown>,
): {
  oldContent: string;
  newContent: string;
  filePath: string;
  badge: DiffBadge;
} | null {
  if (toolName === "Edit") {
    return {
      filePath: String(input.file_path ?? ""),
      oldContent: String(input.old_string ?? ""),
      newContent: String(input.new_string ?? ""),
      badge: "Edit",
    };
  }
  if (toolName === "Write") {
    return {
      filePath: String(input.file_path ?? ""),
      oldContent: "",
      newContent: String(input.content ?? ""),
      badge: "New",
    };
  }
  if (toolName === "ApplyPatch") {
    return {
      filePath: String(input.file_path ?? input.path ?? ""),
      oldContent: String(input.old ?? input.original ?? ""),
      newContent: String(input.new ?? input.patched ?? ""),
      badge: "Patch",
    };
  }
  return null;
}

// ── Task tool helpers ──────────────────────────────────────────────────────

function isTaskTool(toolName: string): boolean {
  return (
    toolName === "TaskCreate" ||
    toolName === "TaskUpdate" ||
    toolName === "TaskList" ||
    toolName === "TaskGet"
  );
}

const TASK_STATUS_ICON: Record<string, { icon: typeof Circle; color: string; animate?: boolean }> = {
  pending: { icon: Circle, color: "text-muted-foreground" },
  in_progress: { icon: Loader2, color: "text-primary", animate: true },
  completed: { icon: CheckCircle2, color: "text-emerald-500" },
};

function TaskStatusIcon({ status }: { status: string }) {
  const config = TASK_STATUS_ICON[status] ?? TASK_STATUS_ICON.pending;
  const Icon = config.icon;
  return (
    <Icon
      className={`h-3.5 w-3.5 flex-shrink-0 ${config.color} ${config.animate ? "animate-spin" : ""}`}
    />
  );
}

function TaskToolCard({
  toolName,
  toolInput,
  toolResult,
}: {
  toolName: string;
  toolInput: Record<string, unknown>;
  toolResult?: ToolResult;
}) {
  const parsed = React.useMemo(() => {
    if (!toolResult?.content) return null;
    try {
      return JSON.parse(toolResult.content);
    } catch {
      return null;
    }
  }, [toolResult]);

  if (toolResult?.isError) {
    return (
      <div className="my-0.5 rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
        <span className="font-medium">{toolName}</span>
        <span className="ml-2 text-xs">{toolResult.content.slice(0, 120)}</span>
      </div>
    );
  }

  if (toolName === "TaskCreate") {
    const task = parsed?.task;
    const subject = task?.subject ?? String(toolInput.subject ?? "");
    const id = task?.id ?? "";
    return (
      <div className="my-0.5 flex items-center gap-2 rounded-xl border border-border/60 bg-card px-3 py-2 shadow-sm">
        <Plus className="h-3.5 w-3.5 flex-shrink-0 text-emerald-500" />
        <span className="text-sm">
          <span className="font-medium text-muted-foreground">Task</span>
          {id && <span className="ml-1 font-mono text-xs text-foreground/50">#{id}</span>}
          <span className="ml-1.5 text-foreground/80">{subject}</span>
        </span>
      </div>
    );
  }

  if (toolName === "TaskUpdate") {
    const taskId = parsed?.taskId ?? String(toolInput.taskId ?? "");
    const newStatus = parsed?.statusChange?.to ?? String(toolInput.status ?? "");
    const subject = parsed?.subject ?? String(toolInput.subject ?? "");
    return (
      <div className="my-0.5 flex items-center gap-2 rounded-xl border border-border/60 bg-card px-3 py-2 shadow-sm">
        <RefreshCw className="h-3.5 w-3.5 flex-shrink-0 text-primary" />
        <span className="text-sm">
          <span className="font-medium text-muted-foreground">Task</span>
          {taskId && <span className="ml-1 font-mono text-xs text-foreground/50">#{taskId}</span>}
          {newStatus && (
            <span className={`ml-1.5 rounded-md px-1.5 py-0.5 text-xs font-medium ${
              newStatus === "completed" ? "bg-emerald-500/10 text-emerald-500" :
              newStatus === "in_progress" ? "bg-primary/10 text-primary" :
              "bg-muted/60 text-muted-foreground"
            }`}>
              {newStatus.replace("_", " ")}
            </span>
          )}
          {subject && <span className="ml-1.5 text-foreground/80">{subject}</span>}
        </span>
      </div>
    );
  }

  // TaskList / TaskGet
  const tasks: { id: string; subject: string; status: string; blockedBy?: string[] }[] =
    parsed?.tasks ?? (parsed?.task ? [parsed.task] : []);

  if (tasks.length === 0) {
    return (
      <div className="my-0.5 flex items-center gap-2 rounded-xl border border-border/60 bg-card px-3 py-2 shadow-sm">
        <ListTodo className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
        <span className="text-sm text-muted-foreground">No tasks</span>
      </div>
    );
  }

  return (
    <div className="my-0.5 overflow-hidden rounded-xl border border-border/60 bg-card shadow-sm">
      <div className="flex items-center gap-2 px-3 py-2">
        <ListTodo className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
        <span className="text-sm font-medium text-muted-foreground">
          Tasks ({tasks.length})
        </span>
      </div>
      <div className="border-t border-border/40 px-3 py-1.5">
        {tasks.slice(0, 10).map((t) => (
          <div key={t.id} className="flex items-center gap-2 py-1">
            <TaskStatusIcon status={t.status} />
            <span className="font-mono text-xs text-foreground/50">#{t.id}</span>
            <span className="truncate text-sm text-foreground/80">{t.subject}</span>
            {t.blockedBy && t.blockedBy.length > 0 && (
              <span className="ml-auto text-xs text-amber-500">
                blocked by {t.blockedBy.map((b) => `#${b}`).join(", ")}
              </span>
            )}
          </div>
        ))}
        {tasks.length > 10 && (
          <div className="py-1 text-xs text-muted-foreground/50">
            +{tasks.length - 10} more
          </div>
        )}
      </div>
    </div>
  );
}

// ── Memory file helpers ────────────────────────────────────────────────────

function isMemoryFile(toolName: string, toolInput: Record<string, unknown>): boolean {
  if (toolName !== "Write" && toolName !== "Edit") return false;
  const filePath = String(toolInput.file_path ?? "");
  return filePath.includes("/memory/") || filePath.endsWith("MEMORY.md");
}

function MemoryUpdateCard({ toolInput }: { toolInput: Record<string, unknown> }) {
  const filePath = String(toolInput.file_path ?? "");
  // Show a short relative-ish path
  const displayPath = filePath.replace(/^.*\/(\.claude\/)/, "$1").replace(/^.*\/memory\//, "memory/");
  return (
    <div className="my-0.5 flex items-center gap-2 rounded-xl border border-primary/20 bg-primary/5 px-3 py-2 shadow-sm">
      <Brain className="h-3.5 w-3.5 flex-shrink-0 text-primary" />
      <span className="text-sm text-foreground/80">
        Memory updated in{" "}
        <span className="font-mono text-xs text-primary">{displayPath}</span>
      </span>
    </div>
  );
}

// ── TodoWrite card ─────────────────────────────────────────────────────────

function TodoWriteCard({ toolInput }: { toolInput: Record<string, unknown> }) {
  const todos = Array.isArray(toolInput.todos) ? toolInput.todos : [];

  if (todos.length === 0) {
    return (
      <div className="my-0.5 flex items-center gap-2 rounded-xl border border-border/60 bg-card px-3 py-2 shadow-sm">
        <ListTodo className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
        <span className="text-sm text-muted-foreground">Todos cleared</span>
      </div>
    );
  }

  return (
    <div className="my-0.5 overflow-hidden rounded-xl border border-border/60 bg-card shadow-sm">
      <div className="flex items-center gap-2 px-3 py-2">
        <ListTodo className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
        <span className="text-sm font-medium text-muted-foreground">
          Todos ({todos.length})
        </span>
      </div>
      <div className="border-t border-border/40 px-3 py-1.5">
        {todos.slice(0, 10).map((todo, i) => {
          const t = todo as Record<string, unknown>;
          const status = String(t.status ?? "pending");
          const content = String(t.content ?? "");
          const config = TASK_STATUS_ICON[status] ?? TASK_STATUS_ICON.pending;
          const Icon = config.icon;
          return (
            <div key={i} className="flex items-center gap-2 py-0.5">
              <Icon
                className={`h-3 w-3 flex-shrink-0 ${config.color} ${config.animate ? "animate-spin" : ""}`}
              />
              <span className="min-w-0 truncate text-xs text-foreground/80">
                {content}
              </span>
            </div>
          );
        })}
        {todos.length > 10 && (
          <div className="py-0.5 text-[10px] text-muted-foreground/50">
            +{todos.length - 10} more
          </div>
        )}
      </div>
    </div>
  );
}

// ── Standard tool header ───────────────────────────────────────────────────

function ToolHeader({
  toolName,
  toolInput,
  toolResult,
  autoExpandTools,
}: {
  toolName: string;
  toolInput: Record<string, unknown>;
  toolResult?: ToolResult;
  autoExpandTools?: boolean;
}) {
  const diffProps = isEditTool(toolName)
    ? getDiffProps(toolName, toolInput)
    : null;
  const [open, setOpen] = React.useState(autoExpandTools || diffProps !== null);
  const summary = buildSummary(toolName, toolInput);

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2.5 text-left transition-colors duration-100 hover:bg-accent/50 active:bg-accent/70"
      >
        <Wrench className="h-3 w-3 flex-shrink-0 text-muted-foreground/60" />
        <span className="flex-1 truncate text-sm">
          <span className="font-medium text-muted-foreground">{toolName}</span>
          {summary && (
            <span className="ml-2 font-mono text-xs text-foreground/50">
              {summary}
            </span>
          )}
        </span>
        {open ? (
          <ChevronDown className="h-3 w-3 flex-shrink-0 text-muted-foreground/40" />
        ) : (
          <ChevronRight className="h-3 w-3 flex-shrink-0 text-muted-foreground/40" />
        )}
      </button>

      {open && diffProps && (
        <ToolDiffViewer
          oldContent={diffProps.oldContent}
          newContent={diffProps.newContent}
          filePath={diffProps.filePath}
          badge={diffProps.badge}
        />
      )}
      {open && !diffProps && (
        <div className="border-t border-border/60 px-3 py-2.5">
          <ToolInputBody toolName={toolName} toolInput={toolInput} />
        </div>
      )}
      {open && toolResult && !isEditTool(toolName) && (
        <ToolResultView result={toolResult} />
      )}
      {open && toolResult?.isError && isEditTool(toolName) && (
        <ToolResultView result={toolResult} />
      )}
    </div>
  );
}

function ToolInputBody({
  toolName,
  toolInput,
}: {
  toolName: string;
  toolInput: Record<string, unknown>;
}) {
  if (toolName === "Bash" || toolName === "shell")
    return <BashInputBody toolInput={toolInput} />;
  if (toolName === "Grep") return <GrepInputBody toolInput={toolInput} />;
  if (toolName === "Glob") return <GlobInputBody toolInput={toolInput} />;
  if (toolName === "WebFetch")
    return <WebFetchInputBody toolInput={toolInput} />;
  if (toolName === "WebSearch")
    return <WebSearchInputBody toolInput={toolInput} />;
  if (toolName === "TodoWrite" || toolName === "TodoRead")
    return <TodoInputBody toolInput={toolInput} />;
  return (
    <pre className="overflow-x-auto text-sm text-muted-foreground">
      {JSON.stringify(toolInput, null, 2)}
    </pre>
  );
}

function BashInputBody({ toolInput }: { toolInput: Record<string, unknown> }) {
  const cmd = toolInput.command ?? toolInput.cmd;
  const desc = toolInput.description;
  return (
    <div>
      {typeof cmd === "string" && (
        <pre className="overflow-x-auto whitespace-pre-wrap break-all font-mono text-sm text-foreground/80">
          {cmd}
        </pre>
      )}
      {typeof desc === "string" && (
        <p className="mt-1 text-xs text-muted-foreground">{desc}</p>
      )}
    </div>
  );
}

function GrepInputBody({ toolInput }: { toolInput: Record<string, unknown> }) {
  const pattern = toolInput.pattern;
  const path = toolInput.path ?? toolInput.glob;
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      {typeof pattern === "string" && (
        <code className="rounded-md bg-muted/60 px-1.5 py-0.5 font-mono text-foreground/80">
          /{pattern}/
        </code>
      )}
      {typeof path === "string" && (
        <span className="font-mono text-muted-foreground">{path}</span>
      )}
    </div>
  );
}

function GlobInputBody({ toolInput }: { toolInput: Record<string, unknown> }) {
  const pattern = toolInput.pattern;
  const path = toolInput.path;
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      {typeof pattern === "string" && (
        <code className="rounded-md bg-muted/60 px-1.5 py-0.5 font-mono text-foreground/80">
          {pattern}
        </code>
      )}
      {typeof path === "string" && (
        <span className="font-mono text-muted-foreground">{path}</span>
      )}
    </div>
  );
}

function WebFetchInputBody({
  toolInput,
}: {
  toolInput: Record<string, unknown>;
}) {
  const url = toolInput.url;
  return typeof url === "string" ? (
    <span className="break-all text-sm text-muted-foreground">{url}</span>
  ) : null;
}

function WebSearchInputBody({
  toolInput,
}: {
  toolInput: Record<string, unknown>;
}) {
  const query = toolInput.query;
  return typeof query === "string" ? (
    <span className="text-sm text-muted-foreground">{query}</span>
  ) : null;
}

function TodoInputBody({ toolInput }: { toolInput: Record<string, unknown> }) {
  const todos = toolInput.todos;
  if (Array.isArray(todos)) {
    return (
      <ul className="space-y-0.5 text-sm text-muted-foreground">
        {todos.slice(0, 5).map((todo, i) => (
          <li key={i} className="truncate">
            {typeof todo === "object" && todo !== null
              ? String(
                  (todo as Record<string, unknown>).content ??
                    JSON.stringify(todo),
                )
              : String(todo)}
          </li>
        ))}
        {todos.length > 5 && (
          <li className="text-muted-foreground/50">+{todos.length - 5} more</li>
        )}
      </ul>
    );
  }
  return (
    <pre className="overflow-x-auto text-sm text-muted-foreground">
      {JSON.stringify(toolInput, null, 2)}
    </pre>
  );
}

function ToolResultView({ result }: { result: ToolResult }) {
  const [open, setOpen] = React.useState(false);
  const isLong = result.content.length > 200;

  return (
    <div
      className={`border-t border-border/60 px-3 py-2.5 ${result.isError ? "bg-destructive/5" : "bg-muted/15"}`}
    >
      {result.isError && (
        <div className="mb-1 text-xs font-semibold uppercase tracking-widest text-destructive">
          Error
        </div>
      )}
      {isLong ? (
        <div>
          <div className="relative overflow-hidden">
            <pre
              className={`whitespace-pre-wrap break-words font-mono text-sm ${
                result.isError ? "text-destructive" : "text-muted-foreground"
              } ${!open ? "max-h-24" : ""}`}
              style={{ overflow: open ? "auto" : "hidden" }}
            >
              {result.content}
            </pre>
            {!open && (
              <div className="absolute bottom-0 left-0 right-0 h-8 bg-gradient-to-t from-card to-transparent" />
            )}
          </div>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="mt-1 text-xs text-primary hover:underline"
          >
            {open ? "Show less" : "Show more"}
          </button>
        </div>
      ) : (
        <pre
          className={`whitespace-pre-wrap break-words font-mono text-sm ${
            result.isError ? "text-destructive" : "text-muted-foreground"
          }`}
        >
          {result.content}
        </pre>
      )}
    </div>
  );
}

function buildSummary(
  toolName: string,
  input: Record<string, unknown>,
): string {
  if (toolName === "Bash" || toolName === "shell") {
    const cmd = input.command ?? input.cmd;
    if (typeof cmd === "string") return cmd.slice(0, 80);
  }
  if (["Read", "Write", "Edit", "Glob"].includes(toolName)) {
    const path = input.file_path ?? input.path ?? input.pattern;
    if (typeof path === "string") return path.slice(0, 80);
  }
  if (toolName === "Grep") {
    const pattern = input.pattern;
    if (typeof pattern === "string") return `/${pattern}/`;
  }
  if (toolName === "WebFetch") {
    const url = input.url;
    if (typeof url === "string") return url.slice(0, 80);
  }
  if (toolName === "WebSearch") {
    const query = input.query;
    if (typeof query === "string") return query.slice(0, 80);
  }
  if (toolName === "Agent") {
    const desc = input.description;
    if (typeof desc === "string") return desc.slice(0, 80);
  }
  if (toolName === "TaskCreate") {
    const subject = input.subject;
    if (typeof subject === "string") return subject.slice(0, 80);
  }
  if (toolName === "TaskUpdate") {
    const id = input.taskId;
    const status = input.status;
    if (typeof id === "string" && typeof status === "string")
      return `#${id} → ${status}`;
  }
  return "";
}
