/**
 * SP-01  Blank chat shows Say Hi shortcut button
 * SP-02  Say Hi button sends a greeting message
 * SP-03  Model chip visible in top bar
 * SP-04  Clicking model chip opens model picker popover
 * SP-05  Selecting a model in popover sends PUT /api/settings
 */
import { test, expect } from "@playwright/test";
import { setupApp, sse } from "./helpers/setup";

test.describe("shortcut panel", () => {
  test("SP-01 blank chat shows Say Hi button", async ({ page }) => {
    await setupApp(page, {});

    await expect(page.getByText("Welcome back")).toBeVisible();
    await expect(page.getByRole("button", { name: "Say Hi" })).toBeVisible();
  });

  test("SP-02 Say Hi button sends a greeting message", async ({ page }) => {
    const ctrl = await setupApp(page, {});

    await page.getByRole("button", { name: "Say Hi" }).click();

    ctrl.sendSseEvents(sse.text("Hello!", "sess-hi"));

    const body = ctrl.lastChatBody();
    expect(body).not.toBeNull();
    expect(body!.content).toContain("Hi");
  });

  test("SP-03 model chip visible in top bar", async ({ page }) => {
    await setupApp(page, {});

    // The model chip shows the current model (default "sonnet" from mock settings)
    await expect(page.getByTitle("Change model")).toBeVisible();
  });

  test("SP-04 clicking model chip opens model picker popover", async ({ page }) => {
    await setupApp(page, {});

    await page.getByTitle("Change model").click();

    // Popover shows model options
    await expect(page.getByRole("button", { name: "Haiku" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Opus", exact: true })).toBeVisible();
  });

  test("SP-05 selecting a model sends PUT /api/settings", async ({ page }) => {
    const ctrl = await setupApp(page, {});

    await page.getByTitle("Change model").click();
    await page.getByRole("button", { name: "Haiku" }).click();

    // Should show success
    await expect(page.getByText("Updated")).toBeVisible();
    expect(ctrl.lastSettingsSave()?.model).toBe("haiku");
  });
});
