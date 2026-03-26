/**
 * MCP-01  MCP tab visible        — clicking Settings shows the MCP Servers tab
 * MCP-02  Empty state             — shows "No MCP servers" when none configured
 * MCP-03  List servers            — shows configured servers with name and URL
 * MCP-04  Add server              — adding a server shows it in the list
 * MCP-05  Add server sends body   — POST body includes name, URL, and headers
 * MCP-06  Delete server           — clicking delete removes the server
 * MCP-07  Add form cancel         — cancel hides the form without saving
 * MCP-08  Add server error        — server error shows failure message
 * MCP-09  Add button disabled     — save is disabled when name or URL empty
 */
import { test, expect } from "@playwright/test";
import { setupApp } from "./helpers/setup";

test.describe("mcp servers", () => {
  test("MCP-01 clicking Settings shows the MCP Servers tab", async ({
    page,
  }) => {
    await setupApp(page);

    await page.getByTitle("Settings").click();
    await expect(page.getByText("MCP Servers")).toBeVisible();
  });

  test("MCP-02 MCP tab shows empty state when no servers configured", async ({
    page,
  }) => {
    await setupApp(page, { mcpServers: [] });

    await page.getByTitle("Settings").click();
    await page.getByText("MCP Servers").click();

    await expect(
      page.getByText("No MCP servers configured."),
    ).toBeVisible();
    await expect(page.getByText("Add Server")).toBeVisible();
  });

  test("MCP-03 MCP tab lists configured servers with name and URL", async ({
    page,
  }) => {
    await setupApp(page, {
      mcpServers: [
        { name: "my-search", type: "http", url: "https://search.example.com/mcp" },
        { name: "my-db", type: "http", url: "https://db.example.com/mcp" },
      ],
    });

    await page.getByTitle("Settings").click();
    await page.getByText("MCP Servers").click();

    await expect(page.getByText("my-search")).toBeVisible();
    await expect(
      page.getByText("https://search.example.com/mcp"),
    ).toBeVisible();
    await expect(page.getByText("my-db")).toBeVisible();
    await expect(page.getByText("https://db.example.com/mcp")).toBeVisible();
  });

  test("MCP-04 adding a server shows it in the list", async ({ page }) => {
    await setupApp(page, { mcpServers: [] });

    await page.getByTitle("Settings").click();
    await page.getByText("MCP Servers").click();
    await page.getByText("Add Server").click();

    await page.getByPlaceholder("Server name").fill("new-server");
    await page.getByPlaceholder("https://example.com/mcp").fill("https://new.example.com/mcp");
    await page.getByRole("button", { name: "Save" }).click();

    await expect(page.getByText("new-server")).toBeVisible();
    await expect(
      page.getByText("https://new.example.com/mcp"),
    ).toBeVisible();
  });

  test("MCP-05 POST body includes name, URL, and parsed headers", async ({
    page,
  }) => {
    const ctrl = await setupApp(page, { mcpServers: [] });

    await page.getByTitle("Settings").click();
    await page.getByText("MCP Servers").click();
    await page.getByText("Add Server").click();

    await page.getByPlaceholder("Server name").fill("auth-server");
    await page
      .getByPlaceholder("https://example.com/mcp")
      .fill("https://auth.example.com/mcp");
    await page
      .getByPlaceholder("Authorization=Bearer token")
      .fill("Authorization=Bearer sk-123\nX-Custom=val");
    await page.getByRole("button", { name: "Save" }).click();

    await expect(page.getByText("auth-server")).toBeVisible();

    const body = ctrl.lastMcpAdd();
    expect(body).not.toBeNull();
    expect(body!.name).toBe("auth-server");
    expect(body!.url).toBe("https://auth.example.com/mcp");
    expect(body!.headers).toEqual({
      Authorization: "Bearer sk-123",
      "X-Custom": "val",
    });
  });

  test("MCP-06 clicking delete removes the server from the list", async ({
    page,
  }) => {
    const ctrl = await setupApp(page, {
      mcpServers: [
        { name: "to-delete", type: "http", url: "https://del.example.com/mcp" },
      ],
    });

    await page.getByTitle("Settings").click();
    await page.getByText("MCP Servers").click();

    await expect(page.getByText("to-delete")).toBeVisible();
    await page.getByTitle("Remove server").click();

    await expect(page.getByText("to-delete")).not.toBeVisible();
    expect(ctrl.lastMcpDelete()).toBe("to-delete");
  });

  test("MCP-07 cancel hides the add form without saving", async ({
    page,
  }) => {
    const ctrl = await setupApp(page, { mcpServers: [] });

    await page.getByTitle("Settings").click();
    await page.getByText("MCP Servers").click();
    await page.getByText("Add Server").click();

    await page.getByPlaceholder("Server name").fill("should-not-save");
    await page.getByRole("button", { name: "Cancel" }).click();

    // Form should be hidden, Add Server button visible again
    await expect(page.getByPlaceholder("Server name")).not.toBeVisible();
    await expect(page.getByText("Add Server")).toBeVisible();
    expect(ctrl.lastMcpAdd()).toBeNull();
  });

  test("MCP-08 server error on add shows failure message", async ({
    page,
  }) => {
    await setupApp(page, { mcpServers: [], mcpAddError: true });

    await page.getByTitle("Settings").click();
    await page.getByText("MCP Servers").click();
    await page.getByText("Add Server").click();

    await page.getByPlaceholder("Server name").fill("fail-server");
    await page
      .getByPlaceholder("https://example.com/mcp")
      .fill("https://fail.example.com");
    await page.getByRole("button", { name: "Save" }).click();

    await expect(page.getByText(/Internal Server Error/)).toBeVisible();
  });

  test("MCP-09 save button is disabled when name or URL is empty", async ({
    page,
  }) => {
    await setupApp(page, { mcpServers: [] });

    await page.getByTitle("Settings").click();
    await page.getByText("MCP Servers").click();
    await page.getByText("Add Server").click();

    const saveBtn = page.getByRole("button", { name: "Save" });

    // Both empty
    await expect(saveBtn).toBeDisabled();

    // Only name filled
    await page.getByPlaceholder("Server name").fill("test");
    await expect(saveBtn).toBeDisabled();

    // Only URL filled
    await page.getByPlaceholder("Server name").fill("");
    await page
      .getByPlaceholder("https://example.com/mcp")
      .fill("https://test.com");
    await expect(saveBtn).toBeDisabled();

    // Both filled
    await page.getByPlaceholder("Server name").fill("test");
    await expect(saveBtn).toBeEnabled();
  });
});
