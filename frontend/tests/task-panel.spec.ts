/**
 * Task panel & tool renderers:
 * - Clicking Tasks icon opens the task panel
 * - Panel shows tasks populated via TaskCreate tool results
 * - Clicking Close dismisses the panel
 * - Empty state shown when no tasks exist
 * - TaskCreate renders as compact card in chat (not raw JSON)
 * - TaskCreate auto-opens the task panel
 * - TaskUpdate renders with status badge
 * - TaskList renders as compact task list
 * - Memory file Write renders as "Memory updated" notification
 */
import { test, expect } from "@playwright/test";
import { setupApp, sendMessage, sse } from "./helpers/setup";

test.describe("task panel", () => {
  test("clicking Tasks icon opens and closes the panel", async ({ page }) => {
    await setupApp(page, { sessions: [] });

    // Panel should not be visible initially
    await expect(page.getByText("No tasks yet")).not.toBeVisible();

    // Click the Tasks icon to open
    await page.getByTitle("Tasks").click();
    await expect(page.getByText("No tasks yet")).toBeVisible();

    // Click Close to dismiss
    await page.getByRole("button", { name: "Close" }).click();
    await expect(page.getByText("No tasks yet")).not.toBeVisible();
  });

  test("tasks created via SSE tool results appear in the panel", async ({
    page,
  }) => {
    const ctrl = await setupApp(page, { sessions: [] });

    await sendMessage(page, "Plan the work");
    ctrl.sendSseEvents(
      sse.withTool(
        "tool-task-create",
        "TaskCreate",
        { subject: "Fix login bug", description: "Resolve auth issue" },
        JSON.stringify({
          task: { id: "1", subject: "Fix login bug", status: "pending" },
        }),
        "Created a task.",
        "sess-task",
      ),
    );

    await expect(page.getByText("Created a task.")).toBeVisible();

    // Task panel auto-opens on TaskCreate — the task should be visible
    await expect(page.getByText("Fix login bug").first()).toBeVisible();
  });

  test("task status updates are reflected in the panel", async ({ page }) => {
    const ctrl = await setupApp(page, { sessions: [] });

    await sendMessage(page, "Start work");
    ctrl.sendSseEvents(
      sse.withTool(
        "tool-tc",
        "TaskCreate",
        { subject: "Write tests", description: "Add test coverage" },
        JSON.stringify({
          task: { id: "1", subject: "Write tests", status: "pending" },
        }),
        "Task created.",
        "sess-tc",
      ),
    );
    await expect(page.getByText("Task created.")).toBeVisible();

    await sendMessage(page, "Working on it");
    ctrl.sendSseEvents(
      sse.withTool(
        "tool-tu",
        "TaskUpdate",
        { taskId: "1", status: "in_progress" },
        JSON.stringify({
          taskId: "1",
          statusChange: { from: "pending", to: "in_progress" },
        }),
        "Started the task.",
        "sess-tu",
      ),
    );
    await expect(page.getByText("Started the task.")).toBeVisible();

    await page.getByTitle("Tasks").click();
    await expect(page.getByText("In Progress")).toBeVisible();
    await expect(page.getByText("Write tests")).toBeVisible();
  });

  test("toggle behavior — clicking Tasks icon again closes the panel", async ({
    page,
  }) => {
    await setupApp(page, { sessions: [] });

    await page.getByTitle("Tasks").click();
    await expect(page.getByText("No tasks yet")).toBeVisible();

    await page.getByTitle("Tasks").click();
    await expect(page.getByText("No tasks yet")).not.toBeVisible();
  });
});

test.describe("task tool renderers", () => {
  test("TaskCreate renders as compact card in chat", async ({ page }) => {
    const ctrl = await setupApp(page, { sessions: [] });

    await sendMessage(page, "Create a task");
    ctrl.sendSseEvents(
      sse.withTool(
        "tool-tc-render",
        "TaskCreate",
        { subject: "Deploy service" },
        JSON.stringify({
          task: { id: "5", subject: "Deploy service", status: "pending" },
        }),
        "Done.",
        "sess-tc-render",
      ),
    );

    // Should show compact card with task info, not raw JSON
    const card = page.getByTestId("assistant-card").last();
    await expect(card.getByText("#5")).toBeVisible();
    await expect(card.getByText("Deploy service")).toBeVisible();
    // Should NOT show raw JSON
    await expect(card.getByText('"status"')).not.toBeVisible();
  });

  test("TaskCreate auto-opens the task panel", async ({ page }) => {
    const ctrl = await setupApp(page, { sessions: [] });

    // Panel should not be open initially
    await expect(page.getByText("No tasks yet")).not.toBeVisible();

    await sendMessage(page, "Plan work");
    ctrl.sendSseEvents(
      sse.withTool(
        "tool-tc-auto",
        "TaskCreate",
        { subject: "Auto-opened task" },
        JSON.stringify({
          task: { id: "1", subject: "Auto-opened task", status: "pending" },
        }),
        "Created.",
        "sess-tc-auto",
      ),
    );

    // Panel should auto-open with the task visible
    // The task panel (side panel) should show the task
    await expect(page.getByText("Auto-opened task").first()).toBeVisible();
    // The panel's Pending group should be visible
    await expect(page.getByText(/Pending/)).toBeVisible();
  });

  test("TaskUpdate renders with status badge", async ({ page }) => {
    const ctrl = await setupApp(page, { sessions: [] });

    await sendMessage(page, "Update task");
    ctrl.sendSseEvents(
      sse.withTool(
        "tool-tu-render",
        "TaskUpdate",
        { taskId: "3", status: "completed" },
        JSON.stringify({
          taskId: "3",
          statusChange: { from: "in_progress", to: "completed" },
        }),
        "Done.",
        "sess-tu-render",
      ),
    );

    // Should show the status badge
    await expect(page.getByText("completed")).toBeVisible();
    await expect(page.getByText("#3")).toBeVisible();
  });

  test("TaskList renders as compact task list", async ({ page }) => {
    const ctrl = await setupApp(page, { sessions: [] });

    await sendMessage(page, "List tasks");
    ctrl.sendSseEvents(
      sse.withTool(
        "tool-tl-render",
        "TaskList",
        {},
        JSON.stringify({
          tasks: [
            { id: "1", subject: "First task", status: "completed" },
            { id: "2", subject: "Second task", status: "in_progress" },
            { id: "3", subject: "Third task", status: "pending", blockedBy: ["2"] },
          ],
        }),
        "Listed.",
        "sess-tl-render",
      ),
    );

    // Wait for response to render
    await expect(page.getByText("Listed.")).toBeVisible();

    // Should show task items
    await expect(page.getByText("First task")).toBeVisible();
    await expect(page.getByText("Second task")).toBeVisible();
    await expect(page.getByText("Third task")).toBeVisible();
    // Should show blocked-by info
    await expect(page.getByText("blocked by #2")).toBeVisible();
  });
});

test.describe("memory tool renderer", () => {
  test("Write to memory file renders as memory notification", async ({
    page,
  }) => {
    const ctrl = await setupApp(page, { sessions: [] });

    await sendMessage(page, "Remember this");
    ctrl.sendSseEvents(
      sse.withTool(
        "tool-mem-write",
        "Write",
        {
          file_path: "/home/user/.claude/projects/myproject/memory/user_prefs.md",
          content: "---\nname: user prefs\n---\nPrefers dark mode",
        },
        "Wrote 3 lines to memory/user_prefs.md",
        "Saved to memory.",
        "sess-mem",
      ),
    );

    // Should show memory notification, not diff viewer
    await expect(page.getByText("Memory updated in")).toBeVisible();
    await expect(page.getByText("memory/user_prefs.md")).toBeVisible();
  });

  test("Write to MEMORY.md renders as memory notification", async ({
    page,
  }) => {
    const ctrl = await setupApp(page, { sessions: [] });

    await sendMessage(page, "Update index");
    ctrl.sendSseEvents(
      sse.withTool(
        "tool-mem-index",
        "Write",
        {
          file_path: "/home/user/.claude/projects/myproject/memory/MEMORY.md",
          content: "- [Prefs](user_prefs.md) — user preferences",
        },
        "Wrote 1 line to MEMORY.md",
        "Updated index.",
        "sess-mem-idx",
      ),
    );

    await expect(page.getByText("Memory updated in")).toBeVisible();
  });

  test("Write to non-memory file renders normally with diff", async ({
    page,
  }) => {
    const ctrl = await setupApp(page, { sessions: [] });

    await sendMessage(page, "Write code");
    ctrl.sendSseEvents(
      sse.withTool(
        "tool-write-code",
        "Write",
        {
          file_path: "/home/user/project/src/main.ts",
          content: 'console.log("hello");',
        },
        "Wrote 1 line to src/main.ts",
        "File written.",
        "sess-write-code",
      ),
    );

    // Should show the normal diff viewer with "New" badge, not memory notification
    await expect(page.getByText("New")).toBeVisible();
    await expect(page.getByText("Memory updated in")).not.toBeVisible();
  });
});
