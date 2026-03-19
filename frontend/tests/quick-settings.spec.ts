/**
 * QS-01  Quick settings button opens panel
 * QS-02  Toggling "Auto-scroll to bottom" persists to localStorage
 * QS-03  Closing quick settings panel hides it
 * QS-04  Toggle states restored from localStorage on reload
 */
import { test, expect } from "@playwright/test";
import { setupApp } from "./helpers/setup";

test.describe("quick settings", () => {
  test("QS-01 quick settings button in IconRail opens panel", async ({ page }) => {
    await setupApp(page, {});

    await page.getByTitle("Quick preferences").click();

    await expect(page.getByText("Quick Settings")).toBeVisible();
    await expect(page.getByText("Auto-scroll")).toBeVisible();
  });

  test("QS-02 toggling auto-scroll persists to localStorage", async ({ page }) => {
    await setupApp(page, {});

    await page.getByTitle("Quick preferences").click();

    // Click the auto-scroll toggle
    const toggle = page.locator("label").filter({ hasText: "Auto-scroll" }).locator("button[role='switch']");
    await toggle.click();

    // Check localStorage
    const prefs = await page.evaluate(() => localStorage.getItem("ui_preferences"));
    const parsed = JSON.parse(prefs!);
    expect(parsed.autoScrollToBottom).toBe(true);
  });

  test("QS-03 closing quick settings panel hides it", async ({ page }) => {
    await setupApp(page, {});

    await page.getByTitle("Quick preferences").click();
    await expect(page.getByText("Quick Settings")).toBeVisible();

    // Click backdrop
    await page.locator("[data-testid='quick-settings-backdrop']").click();
    await expect(page.getByText("Quick Settings")).not.toBeVisible();
  });

  test("QS-04 toggle states restored from localStorage on reload", async ({ page }) => {
    // Pre-seed localStorage
    await page.addInitScript(() => {
      localStorage.setItem(
        "ui_preferences",
        JSON.stringify({ autoExpandTools: true, showThinking: false, autoScrollToBottom: true }),
      );
    });

    await setupApp(page, {});

    await page.getByTitle("Quick preferences").click();

    // Auto-expand tools should be on
    const expandToggle = page.locator("label").filter({ hasText: "Auto-expand tools" }).locator("button[role='switch']");
    await expect(expandToggle).toHaveAttribute("aria-checked", "true");

    // Show thinking should be off
    const thinkingToggle = page.locator("label").filter({ hasText: "Show thinking" }).locator("button[role='switch']");
    await expect(thinkingToggle).toHaveAttribute("aria-checked", "false");

    // Auto-scroll should be on
    const scrollToggle = page.locator("label").filter({ hasText: "Auto-scroll" }).locator("button[role='switch']");
    await expect(scrollToggle).toHaveAttribute("aria-checked", "true");
  });
});
