/**
 * Task panel:
 * - Clicking Tasks icon opens the task panel
 * - Panel shows tasks populated via TaskCreate tool results
 * - Clicking Close dismisses the panel
 * - Empty state shown when no tasks exist
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

    // Send a message that triggers a TaskCreate tool result
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

    // Wait for response to finish rendering
    await expect(page.getByText("Created a task.")).toBeVisible();

    // Open the task panel
    await page.getByTitle("Tasks").click();

    // The task should appear in the panel
    await expect(page.getByText("Fix login bug")).toBeVisible();
    await expect(page.getByText("Pending")).toBeVisible();
  });

  test("task status updates are reflected in the panel", async ({ page }) => {
    const ctrl = await setupApp(page, { sessions: [] });

    // Create a task
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

    // Update the task to in_progress
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

    // Open panel and verify status
    await page.getByTitle("Tasks").click();
    await expect(page.getByText("In Progress")).toBeVisible();
    await expect(page.getByText("Write tests")).toBeVisible();
  });

  test("toggle behavior — clicking Tasks icon again closes the panel", async ({
    page,
  }) => {
    await setupApp(page, { sessions: [] });

    // Open
    await page.getByTitle("Tasks").click();
    await expect(page.getByText("No tasks yet")).toBeVisible();

    // Toggle closed by clicking the same icon
    await page.getByTitle("Tasks").click();
    await expect(page.getByText("No tasks yet")).not.toBeVisible();
  });
});
