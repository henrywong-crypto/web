/**
 * DC-01  Disconnect overlay appears when WS closes
 * DC-02  Reconnect button is visible in overlay
 * DC-03  Clicking reconnect triggers page reload
 */
import { test, expect } from "@playwright/test";
import { setupApp } from "./helpers/setup";

test.describe("disconnect detection", () => {
  test("DC-01+02 overlay with reconnect button appears on WS close", async ({ page }) => {
    // Intercept WebSocket before the page loads
    page.routeWebSocket(/\/ws\//, (ws) => {
      // Accept the connection, then close it after a short delay
      setTimeout(() => {
        ws.close();
      }, 200);
    });

    await setupApp(page, {});

    // The overlay should appear after WS closes
    await expect(page.getByText("Connection Lost")).toBeVisible({ timeout: 5000 });
    await expect(page.getByRole("button", { name: "Reconnect" })).toBeVisible();
  });

  test("DC-03 clicking reconnect triggers page reload", async ({ page }) => {
    page.routeWebSocket(/\/ws\//, (ws) => {
      setTimeout(() => {
        ws.close();
      }, 200);
    });

    await setupApp(page, {});

    await expect(page.getByText("Connection Lost")).toBeVisible({ timeout: 5000 });

    // Listen for navigation (reload)
    const navigationPromise = page.waitForNavigation({ timeout: 5000 });
    await page.getByRole("button", { name: "Reconnect" }).click();
    await navigationPromise;
  });
});
