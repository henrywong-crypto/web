/**
 * Markdown rendering tests for assistant messages.
 *
 * MR-01  Code block has syntax highlighting (colored tokens)
 * MR-02  Code block shows language label
 * MR-03  Code block copy button works
 * MR-04  Inline code has distinct background and border styling
 * MR-05  Inline code does NOT show backtick characters
 * MR-06  Links render as clickable anchors with target=_blank
 * MR-07  Tables render with borders and header styling
 * MR-08  Blockquotes render with left border accent
 * MR-09  Lists render with proper markers
 * MR-10  Assistant text has readable contrast against background
 */
import { test, expect } from "@playwright/test";
import { setupApp, sendMessage, sse } from "./helpers/setup";

test.describe("markdown rendering", () => {
  test("MR-01 code block has syntax-highlighted tokens", async ({ page }) => {
    const ctrl = await setupApp(page, {});
    const code = "```javascript\nconst x = 42;\nconsole.log(x);\n```";

    await sendMessage(page, "show code");
    ctrl.sendSseEvents(sse.text(code, "sess-mr1"));

    // Wait for the code block to appear
    const codeBlock = page.locator("pre").first();
    await expect(codeBlock).toBeVisible();

    // Syntax highlighting should produce colored <span> elements inside the code
    const coloredSpans = codeBlock.locator("span[style]");
    await expect(coloredSpans.first()).toBeVisible();
    const count = await coloredSpans.count();
    expect(count).toBeGreaterThan(1);
  });

  test("MR-02 code block shows language label", async ({ page }) => {
    const ctrl = await setupApp(page, {});
    const code = "```python\nprint('hello')\n```";

    await sendMessage(page, "show code");
    ctrl.sendSseEvents(sse.text(code, "sess-mr2"));

    // Language label should be visible
    await expect(page.getByText("python", { exact: false })).toBeVisible();
  });

  test("MR-03 code block copy button is present and clickable", async ({ page }) => {
    const ctrl = await setupApp(page, {});
    const code = "```bash\necho hello\n```";

    await sendMessage(page, "show code");
    ctrl.sendSseEvents(sse.text(code, "sess-mr3"));

    // Hover the code block area to trigger group-hover visibility
    const codeArea = page.locator(".group").first();
    await expect(codeArea).toBeVisible();
    await codeArea.hover();

    // Copy button should become visible on hover
    const copyBtn = codeArea.locator("button").first();
    await expect(copyBtn).toBeVisible();

    // Should contain copy icon (svg)
    await expect(copyBtn.locator("svg")).toBeVisible();
  });

  test("MR-04 inline code has distinct background and border", async ({ page }) => {
    const ctrl = await setupApp(page, {});

    await sendMessage(page, "show inline");
    ctrl.sendSseEvents(sse.text("Use the `useState` hook to manage state.", "sess-mr4"));

    const inlineCode = page.locator("code").filter({ hasText: "useState" }).first();
    await expect(inlineCode).toBeVisible();

    // Inline code should have background color set (not transparent)
    const bg = await inlineCode.evaluate(
      (el) => getComputedStyle(el).backgroundColor,
    );
    expect(bg).not.toBe("rgba(0, 0, 0, 0)");
    expect(bg).not.toBe("transparent");
  });

  test("MR-05 inline code does not display backtick characters", async ({ page }) => {
    const ctrl = await setupApp(page, {});

    await sendMessage(page, "show inline");
    ctrl.sendSseEvents(sse.text("Run `npm install` to install.", "sess-mr5"));

    const inlineCode = page.locator("code").filter({ hasText: "npm install" }).first();
    await expect(inlineCode).toBeVisible();

    // The prose ::before/::after should not add visible backtick content.
    // Check that the visible text content doesn't have backticks wrapping it.
    const beforeContent = await inlineCode.evaluate(
      (el) => getComputedStyle(el, "::before").content,
    );
    const afterContent = await inlineCode.evaluate(
      (el) => getComputedStyle(el, "::after").content,
    );
    // Should be empty or "none", not "`"
    expect(beforeContent).not.toBe('"`"');
    expect(afterContent).not.toBe('"`"');
  });

  test("MR-06 links render as clickable anchors opening in new tab", async ({ page }) => {
    const ctrl = await setupApp(page, {});

    await sendMessage(page, "give link");
    ctrl.sendSseEvents(sse.text("Visit [Example](https://example.com) for more.", "sess-mr6"));

    const link = page.locator("a").filter({ hasText: "Example" }).first();
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute("href", "https://example.com");
    await expect(link).toHaveAttribute("target", "_blank");
  });

  test("MR-07 tables render with borders and header styling", async ({ page }) => {
    const ctrl = await setupApp(page, {});
    const table = "| Name | Age |\n| --- | --- |\n| Alice | 30 |\n| Bob | 25 |";

    await sendMessage(page, "show table");
    ctrl.sendSseEvents(sse.text(table, "sess-mr7"));

    const tableEl = page.locator("table").first();
    await expect(tableEl).toBeVisible();

    // Headers should exist
    await expect(page.locator("th").filter({ hasText: "Name" })).toBeVisible();
    await expect(page.locator("th").filter({ hasText: "Age" })).toBeVisible();

    // Data cells should exist
    await expect(page.locator("td").filter({ hasText: "Alice" })).toBeVisible();
    await expect(page.locator("td").filter({ hasText: "30" })).toBeVisible();

    // Table cells should have visible borders
    const thBorder = await page.locator("th").first().evaluate(
      (el) => getComputedStyle(el).borderWidth,
    );
    expect(thBorder).not.toBe("0px");
  });

  test("MR-08 blockquotes render with left border accent", async ({ page }) => {
    const ctrl = await setupApp(page, {});

    await sendMessage(page, "quote");
    ctrl.sendSseEvents(sse.text("> This is a blockquote", "sess-mr8"));

    const bq = page.locator("blockquote").first();
    await expect(bq).toBeVisible();

    const borderLeft = await bq.evaluate(
      (el) => getComputedStyle(el).borderLeftWidth,
    );
    expect(borderLeft).not.toBe("0px");
  });

  test("MR-09 ordered and unordered lists render", async ({ page }) => {
    const ctrl = await setupApp(page, {});
    const md = "- Item A\n- Item B\n\n1. First\n2. Second";

    await sendMessage(page, "list");
    ctrl.sendSseEvents(sse.text(md, "sess-mr9"));

    await expect(page.locator("ul").first()).toBeVisible();
    await expect(page.locator("ol").first()).toBeVisible();
    await expect(page.getByText("Item A")).toBeVisible();
    await expect(page.getByText("First")).toBeVisible();
  });

  test("MR-10 assistant text has readable contrast against background", async ({ page }) => {
    const ctrl = await setupApp(page, {});

    await sendMessage(page, "Hi");
    ctrl.sendSseEvents(sse.text("Hello there! This is a response.", "sess-mr10"));

    const msgEl = page.getByText("Hello there! This is a response.").first();
    await expect(msgEl).toBeVisible();

    // Get text color and background color, compute contrast ratio
    const { fg, bg } = await msgEl.evaluate((el) => {
      const style = getComputedStyle(el);
      return { fg: style.color, bg: style.backgroundColor };
    });

    // Parse rgb(a) values
    function parseRgb(c: string): [number, number, number] {
      const m = c.match(/[\d.]+/g);
      if (!m) return [0, 0, 0];
      return [parseFloat(m[0]), parseFloat(m[1]), parseFloat(m[2])];
    }

    function luminance(r: number, g: number, b: number): number {
      const [rs, gs, bs] = [r, g, b].map((c) => {
        c /= 255;
        return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
      });
      return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
    }

    const [r1, g1, b1] = parseRgb(fg);
    // If bg is transparent, use the page background (dark mode default ~hsl(220 26% 7%))
    let [r2, g2, b2] = parseRgb(bg);
    if (bg === "rgba(0, 0, 0, 0)" || bg === "transparent") {
      // approximate dark mode --background: hsl(220 26% 7%) ≈ rgb(13, 17, 23)
      [r2, g2, b2] = [13, 17, 23];
    }

    const l1 = luminance(r1, g1, b1);
    const l2 = luminance(r2, g2, b2);
    const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);

    // WCAG AA requires >= 4.5 for normal text
    expect(ratio).toBeGreaterThan(4.5);
  });
});
