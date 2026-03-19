/**
 * SP-01  Terminal tab shows shortcut panel with "Shortcuts" heading
 * SP-02  "Change Model" button opens settings modal
 * SP-03  "Resume" button sends /terminal claude --resume as chat message
 * SP-04  "Say Hi" button sends a greeting message
 * SP-05  Slash command buttons send commands via POST /chat
 * SP-06  Shortcut panel can be hidden/shown
 */
import { test, expect } from "@playwright/test";
import { setupApp, sendMessage, sse } from "./helpers/setup";

test.describe("shortcut panel", () => {
  test("SP-01 terminal tab shows shortcut panel with Shortcuts heading", async ({ page }) => {
    await setupApp(page, {});

    await page.getByTitle("Terminal").click();

    await expect(page.getByText("Shortcuts")).toBeVisible();
  });

  test("SP-02 Change Model button opens settings modal", async ({ page }) => {
    await setupApp(page, {});

    await page.getByTitle("Terminal").click();
    await page.getByRole("button", { name: "Change Model" }).click();

    // Settings panel should be visible
    await expect(page.getByText("Settings")).toBeVisible();
  });

  test("SP-03 Resume button sends /terminal claude --resume", async ({ page }) => {
    const ctrl = await setupApp(page, {});

    await page.getByTitle("Terminal").click();
    await page.getByRole("button", { name: "Resume" }).click();

    // Should switch to chat tab and send the command
    ctrl.sendSseEvents(sse.text("Resuming...", "sess-resume"));

    const body = ctrl.lastChatBody();
    expect(body).not.toBeNull();
    expect(body!.content).toBe("/terminal claude --resume");
  });

  test("SP-04 Say Hi button sends a greeting message", async ({ page }) => {
    const ctrl = await setupApp(page, {});

    await page.getByTitle("Terminal").click();
    await page.getByRole("button", { name: "Say Hi" }).click();

    ctrl.sendSseEvents(sse.text("Hello!", "sess-hi"));

    const body = ctrl.lastChatBody();
    expect(body).not.toBeNull();
    expect(body!.content).toContain("Hi");
  });

  test("SP-05 slash command buttons send commands via POST /chat", async ({ page }) => {
    const ctrl = await setupApp(page, {});

    await page.getByTitle("Terminal").click();

    // Click the /clear button
    await page.getByRole("button", { name: "/clear" }).click();
    ctrl.sendSseEvents(sse.text("Cleared.", "sess-clear"));

    const body = ctrl.lastChatBody();
    expect(body).not.toBeNull();
    expect(body!.content).toBe("/clear");
  });

  test("SP-06 shortcut panel can be hidden and shown", async ({ page }) => {
    await setupApp(page, {});

    await page.getByTitle("Terminal").click();
    await expect(page.getByText("Shortcuts")).toBeVisible();

    // Hide the panel
    await page.getByTitle("Hide shortcuts").click();
    await expect(page.getByText("Shortcuts")).not.toBeVisible();

    // Show it again
    await expect(page.getByTitle("Show shortcuts")).toBeVisible();
    await page.getByTitle("Show shortcuts").click();
    await expect(page.getByText("Shortcuts")).toBeVisible();
  });
});
