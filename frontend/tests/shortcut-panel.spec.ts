/**
 * SP-01  Blank chat shows shortcut buttons
 * SP-02  "Change Model" button opens settings modal
 * SP-03  "Resume" button sends /terminal claude --resume as chat message
 * SP-04  "Say Hi" button sends a greeting message
 * SP-05  Slash command buttons send commands via POST /chat
 */
import { test, expect } from "@playwright/test";
import { setupApp, sse } from "./helpers/setup";

test.describe("shortcut panel", () => {
  test("SP-01 blank chat shows shortcut buttons", async ({ page }) => {
    await setupApp(page, {});

    await expect(page.getByText("Ask anything or use / commands to get started")).toBeVisible();
    await expect(page.getByRole("button", { name: "Change Model" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Resume" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Say Hi" })).toBeVisible();
    await expect(page.getByRole("button", { name: "/clear" })).toBeVisible();
    await expect(page.getByRole("button", { name: "/compact" })).toBeVisible();
    await expect(page.getByRole("button", { name: "/cost" })).toBeVisible();
    await expect(page.getByRole("button", { name: "/status" })).toBeVisible();
  });

  test("SP-02 Change Model button opens settings modal", async ({ page }) => {
    await setupApp(page, {});

    await page.getByRole("button", { name: "Change Model" }).click();

    // Settings panel should be visible
    await expect(page.getByText("Settings")).toBeVisible();
  });

  test("SP-03 Resume button sends /terminal claude --resume", async ({ page }) => {
    const ctrl = await setupApp(page, {});

    await page.getByRole("button", { name: "Resume" }).click();

    ctrl.sendSseEvents(sse.text("Resuming...", "sess-resume"));

    const body = ctrl.lastChatBody();
    expect(body).not.toBeNull();
    expect(body!.content).toBe("/terminal claude --resume");
  });

  test("SP-04 Say Hi button sends a greeting message", async ({ page }) => {
    const ctrl = await setupApp(page, {});

    await page.getByRole("button", { name: "Say Hi" }).click();

    ctrl.sendSseEvents(sse.text("Hello!", "sess-hi"));

    const body = ctrl.lastChatBody();
    expect(body).not.toBeNull();
    expect(body!.content).toContain("Hi");
  });

  test("SP-05 slash command buttons send commands via POST /chat", async ({ page }) => {
    const ctrl = await setupApp(page, {});

    // Click the /clear button
    await page.getByRole("button", { name: "/clear" }).click();
    ctrl.sendSseEvents(sse.text("Cleared.", "sess-clear"));

    const body = ctrl.lastChatBody();
    expect(body).not.toBeNull();
    expect(body!.content).toBe("/clear");
  });
});
