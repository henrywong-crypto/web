/**
 * UF-15  Dark mode toggle   — clicking toggle applies light mode
 * UF-16  Tab navigation     — Terminal tab shows terminal and shortcuts panel
 * UF-16b Shortcuts toggle   — Hide/show shortcuts panel in terminal tab
 * UF-17  Slash commands     — typing "/" opens menu; selecting fills composer
 */
import { test, expect } from "@playwright/test";
import { setupApp } from "./helpers/setup";

test.describe("ui", () => {
  test("UF-15 dark mode toggle switches to light mode", async ({ page }) => {
    await setupApp(page);

    // App starts in dark mode. The toggle title is "Light mode" (click to switch to light)
    // or "Dark mode" (click to switch to dark). Check which is present.
    const toggle = page.getByTitle("Light mode");
    await toggle.click();

    // Light mode: toggle now shows "Dark mode" option
    await expect(page.getByTitle("Dark mode")).toBeVisible();

    // Clicking again restores dark mode
    await page.getByTitle("Dark mode").click();
    await expect(page.getByTitle("Light mode")).toBeVisible();
  });

  test("UF-16 tab navigation shows correct panels", async ({ page }) => {
    await setupApp(page, {});

    // Chat tab is active by default — composer is visible
    const composer = page.getByPlaceholder("Message Claude…");
    await expect(composer).toBeVisible();

    // Navigate to Terminal tab — shows terminal and shortcuts panel
    const terminalTab = page.getByTitle("Terminal");
    await terminalTab.click();
    // Terminal panel is present (renders a black bg container)
    await expect(page.locator(".bg-black").first()).toBeVisible();
    // Shortcuts panel is visible within the terminal tab
    await expect(page.getByText("Shortcuts")).toBeVisible();
    // Chat composer is hidden
    await expect(composer).not.toBeVisible();

    // Navigate back to Chat tab
    const chatTab = page.getByTitle("Chat");
    await chatTab.click();
    await expect(composer).toBeVisible();
  });

  test("UF-16b hide and show shortcuts panel in terminal tab", async ({ page }) => {
    await setupApp(page, {});

    // Navigate to Terminal tab — shortcuts panel is visible by default
    await page.getByTitle("Terminal").click();
    await expect(page.getByText("Shortcuts")).toBeVisible();

    // Click the hide button to collapse the shortcuts panel
    await page.getByTitle("Hide shortcuts").click();
    await expect(page.getByText("Shortcuts")).not.toBeVisible();

    // The "Show shortcuts" button appears
    await expect(page.getByTitle("Show shortcuts")).toBeVisible();

    // Click it to restore the shortcuts panel
    await page.getByTitle("Show shortcuts").click();
    await expect(page.getByText("Shortcuts")).toBeVisible();
  });

  test("UF-17a slash command menu appears when typing /", async ({ page }) => {
    await setupApp(page);

    await page.getByPlaceholder("Message Claude…").type("/");

    // Command menu becomes visible — use the slash command menu items specifically
    const menu = page.locator(".absolute.bottom-full");
    await expect(menu.getByText("/help")).toBeVisible();
    await expect(menu.getByText("/clear")).toBeVisible();
  });

  test("UF-17b selecting a slash command fills the composer", async ({ page }) => {
    await setupApp(page);

    const composer = page.getByPlaceholder("Message Claude…");
    await composer.type("/");

    // Click the /clear command
    await page.getByRole("button", { name: /\/clear/ }).click();

    // Composer is filled with the command
    await expect(composer).toHaveValue("/clear ");

    // Menu closes after selection
    await expect(page.getByText("/help")).not.toBeVisible();
  });
});
