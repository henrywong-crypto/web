/**
 * UF-45  Reset button hidden     — not rendered when hasUserRootfs is false
 * UF-46  Reset button visible    — rendered when hasUserRootfs is true
 * UF-47  Reset dialog opens      — clicking the button opens the confirmation dialog
 * UF-48  Reset dialog cancel     — clicking Cancel closes the dialog without navigation
 * UF-49  Reset form submits      — clicking Reset POSTs to /rootfs/delete with the CSRF token
 * UF-50  Reset triggers reload   — after successful delete the page reloads
 */
import { test, expect } from "@playwright/test";
import { setupApp, CSRF_TOKEN } from "./helpers/setup";

test.describe("reset environment", () => {
  test("UF-45 reset button is hidden when hasUserRootfs is false", async ({
    page,
  }) => {
    await setupApp(page, { hasUserRootfs: false });

    await expect(page.getByTitle("Reset environment")).not.toBeVisible();
  });

  test("UF-46 reset button is visible when hasUserRootfs is true", async ({
    page,
  }) => {
    await setupApp(page, { hasUserRootfs: true });

    await expect(page.getByTitle("Reset environment")).toBeVisible();
  });

  test("UF-47 clicking the reset button opens the confirmation dialog", async ({
    page,
  }) => {
    await setupApp(page, { hasUserRootfs: true });

    await page.getByTitle("Reset environment").click();

    await expect(page.getByText("Reset Environment?")).toBeVisible();
    await expect(page.getByText("This cannot be undone.")).toBeVisible();
  });

  test("UF-48 clicking Cancel closes the dialog without navigating", async ({
    page,
  }) => {
    await setupApp(page, { hasUserRootfs: true });

    await page.getByTitle("Reset environment").click();
    await expect(page.getByText("Reset Environment?")).toBeVisible();

    await page.getByRole("button", { name: "Cancel" }).click();

    // Dialog is gone and the app is still on the same page
    await expect(page.getByText("Reset Environment?")).not.toBeVisible();
    await expect(page.getByPlaceholder("Message Claude…")).toBeVisible();
  });

  test("UF-49 clicking Reset POSTs to /rootfs/delete with the CSRF token", async ({
    page,
  }) => {
    await setupApp(page, { hasUserRootfs: true });

    await page.getByTitle("Reset environment").click();
    await expect(page.getByText("Reset Environment?")).toBeVisible();

    const [request] = await Promise.all([
      page.waitForRequest("**/rootfs/delete"),
      page.getByRole("button", { name: "Reset", exact: true }).click(),
    ]);

    expect(request.method()).toBe("POST");
    expect(await request.headerValue("x-csrf-token")).toBe(CSRF_TOKEN);
  });

  test("UF-50 reset triggers page reload after successful delete", async ({
    page,
  }) => {
    await setupApp(page, { hasUserRootfs: true });

    await page.getByTitle("Reset environment").click();
    await expect(page.getByText("Reset Environment?")).toBeVisible();

    // Intercept window.location.reload to detect it was called
    await page.evaluate(() => {
      (window as unknown as { __reloadCalled: boolean }).__reloadCalled = false;
      const origReload = window.location.reload.bind(window.location);
      Object.defineProperty(window.location, "reload", {
        value: () => {
          (window as unknown as { __reloadCalled: boolean }).__reloadCalled =
            true;
          // Don't actually reload to keep the test stable
        },
        configurable: true,
      });
    });

    await page.getByRole("button", { name: "Reset", exact: true }).click();

    // Wait for the fetch to complete and reload to be called
    await page.waitForTimeout(500);

    const reloadCalled = await page.evaluate(
      () => (window as unknown as { __reloadCalled: boolean }).__reloadCalled,
    );
    expect(reloadCalled).toBe(true);
  });
});
