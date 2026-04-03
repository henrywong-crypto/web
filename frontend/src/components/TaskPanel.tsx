import React from "react";
import { CheckCircle2, Circle, Loader2 } from "lucide-react";
import type { AgentTask } from "../types";

interface TaskPanelProps {
  tasks: AgentTask[];
  onClose: () => void;
}

const STATUS_CONFIG = {
  pending: {
    icon: Circle,
    color: "text-muted-foreground",
    bg: "bg-muted/50",
    label: "Pending",
  },
  in_progress: {
    icon: Loader2,
    color: "text-primary",
    bg: "bg-primary/10",
    label: "In Progress",
    animate: true,
  },
  completed: {
    icon: CheckCircle2,
    color: "text-emerald-500",
    bg: "bg-emerald-500/10",
    label: "Done",
  },
} as const;

export default function TaskPanel({ tasks, onClose }: TaskPanelProps) {
  const inProgress = tasks.filter((t) => t.status === "in_progress");
  const pending = tasks.filter((t) => t.status === "pending");
  const completed = tasks.filter((t) => t.status === "completed");

  return (
    <div className="flex h-full w-72 flex-col border-l border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h3 className="text-sm font-semibold text-foreground">Tasks</h3>
        <button
          onClick={onClose}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          Close
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-3">
        {tasks.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No tasks yet. The agent will create tasks as it works.
          </p>
        ) : (
          <div className="space-y-3">
            {inProgress.length > 0 && (
              <TaskGroup label="In Progress" tasks={inProgress} />
            )}
            {pending.length > 0 && (
              <TaskGroup label="Pending" tasks={pending} />
            )}
            {completed.length > 0 && (
              <TaskGroup label="Completed" tasks={completed} />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function TaskGroup({
  label,
  tasks,
}: {
  label: string;
  tasks: AgentTask[];
}) {
  return (
    <div>
      <div className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground/60">
        {label} ({tasks.length})
      </div>
      <div className="space-y-1">
        {tasks.map((task) => {
          const config = STATUS_CONFIG[task.status];
          const Icon = config.icon;
          return (
            <div
              key={task.id}
              className={`rounded-lg px-2.5 py-2 ${config.bg}`}
            >
              <div className="flex items-start gap-2">
                <Icon
                  className={`mt-0.5 h-3.5 w-3.5 flex-shrink-0 ${config.color} ${"animate" in config && config.animate ? "animate-spin" : ""}`}
                />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium leading-tight text-foreground">
                    {task.activeForm && task.status === "in_progress"
                      ? task.activeForm
                      : task.subject}
                  </div>
                  {task.blockedBy && task.blockedBy.length > 0 && (
                    <div className="mt-0.5 text-xs text-amber-500">
                      Blocked by: {task.blockedBy.join(", ")}
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
