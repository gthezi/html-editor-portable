import assert from "node:assert/strict";
import { cpSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import patches from "./stop-editor-patch.js";

const modulePath = process.env.PLAYWRIGHT_MODULE;
if (!modulePath) throw new Error("Set PLAYWRIGHT_MODULE to the absolute playwright package directory");
const requirePlaywright = createRequire(join(modulePath, "package.json"));
const { chromium } = requirePlaywright("playwright");
const packageRoot = fileURLToPath(new URL("../app/node_modules/@deckflow/html-editor/", import.meta.url));
const root = mkdtempSync(join(tmpdir(), "html-editor-stop-browser-"));
const installed = join(root, "editor");
cpSync(packageRoot, installed, { recursive: true });
symlinkSync(realpathSync(resolve(packageRoot, "../..")), join(root, "node_modules"), "junction");
for (const [relative, patch] of [
  ["server.js", patches.applyStopServerPatch],
  ["public/app.js", patches.applyStopAppPatch],
  ["public/index.html", patches.applyStopUiPatch],
  ["public/styles.css", patches.applyStopStylesPatch],
]) {
  const target = join(installed, relative);
  writeFileSync(target, patch(readFileSync(target, "utf8")));
}
const { createEditorServer } = await import(pathToFileURL(join(installed, "server.js")));
const chrome = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const browser = await chromium.launch({ headless: true, ...(existsSync(chrome) ? { executablePath: chrome } : {}) });

async function fixture(name, run) {
  const input = join(root, `${name}.html`);
  writeFileSync(input, '<!doctype html><html><head><meta charset="utf-8"></head><body><h1 id="title">Before</h1><p>Keep this paragraph.</p></body></html>');
  const server = await createEditorServer({ input, port: 0 });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  try {
    await page.goto(`${server.url}/__local-editor__/`, { waitUntil: "networkidle" });
    await page.frameLocator("#preview").locator("#title").waitFor();
    await page.waitForFunction(() => document.querySelector("#status").textContent.startsWith("Loaded "));
    await run({ page, server, input });
    assert.deepEqual(pageErrors, [], `${name}: unexpected page errors`);
    console.log(`Passed: ${name}`);
  } finally {
    await page.close();
    await server.close();
  }
}

async function editInline(page, text) {
  const title = page.frameLocator("#preview").locator("#title");
  await title.click({ position: { x: 20, y: 15 } });
  await title.fill(text);
  assert.equal(await title.textContent(), text);
  assert.equal(await title.getAttribute("contenteditable"), "plaintext-only");
}

try {
  await fixture("save-inline-before-stop", async ({ page, server, input }) => {
    const paths = [];
    page.on("request", (request) => paths.push(new URL(request.url()).pathname));
    const button = page.getByRole("button", { name: "\u505c\u6b62\u7f16\u8f91\u5668", exact: true });
    assert.equal(await button.getAttribute("title"), "\u505c\u6b62\u7f16\u8f91\u5668");
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 800 });
      const bounds = await button.boundingBox();
      assert.ok(bounds && bounds.width >= 30 && bounds.height >= 30 && bounds.x >= 0 && bounds.x + bounds.width <= width);
      assert.ok((await page.screenshot()).byteLength > 5_000, "Rendered screenshot must be nonblank");
    }
    await page.setViewportSize({ width: 1280, height: 800 });
    await editInline(page, "Saved before shutdown");
    assert.doesNotMatch(readFileSync(input, "utf8"), /Saved before shutdown/);
    const dialogPromise = page.waitForEvent("dialog");
    const clicked = button.click();
    const dialog = await dialogPromise;
    try {
      assert.equal(dialog.type(), "confirm");
      assert.match(readFileSync(input, "utf8"), /Saved before shutdown/, `Requests before confirmation: ${paths.join(", ")}`);
      assert.equal(paths.includes("/api/stop-editor"), false, "Server stop must follow confirmation");
    } finally {
      await dialog.accept();
      await clicked;
    }
    await page.waitForFunction(() => document.querySelector("#status").textContent === "\u670d\u52a1\u5df2\u505c\u6b62");
    assert.ok(paths.indexOf("/api/patch-elements") < paths.indexOf("/api/stop-editor"));
    assert.equal(await page.locator(".workspace").evaluate((node) => node.inert), true);
    assert.equal(await page.locator("#chooseFileBtn").isDisabled(), true);
    assert.equal(await button.isDisabled(), true);
    const saved = readFileSync(input, "utf8");
    assert.match(saved, /Keep this paragraph\./);
    assert.doesNotMatch(saved, /data-local-editor|contenteditable|data-editor-stopping/);
    await server.close();
    await assert.rejects(fetch(`${server.url}/api/project`));
    const eventsBefore = paths.filter((path) => path === "/api/events").length;
    await page.waitForTimeout(3_200);
    assert.equal(paths.filter((path) => path === "/api/events").length, eventsBefore, "Closed SSE must not retry");
    assert.equal(page.isClosed(), false, "Do not close the user's browser tab");
    assert.equal(await page.locator("#status").textContent(), "\u670d\u52a1\u5df2\u505c\u6b62");
  });

  await fixture("save-error-keeps-editor-usable", async ({ page, server, input }) => {
    let stops = 0;
    let dialogs = 0;
    page.on("request", (request) => { if (new URL(request.url()).pathname === "/api/stop-editor") stops += 1; });
    page.on("dialog", async (dialog) => { dialogs += 1; await dialog.accept(); });
    await page.route("**/api/patch-elements", (route) => route.fulfill({
      status: 500, contentType: "application/json", body: JSON.stringify({ ok: false, error: "mock disk full" }),
    }));
    await editInline(page, "Preserve unsaved text");
    await page.locator("#stopEditorBtn").click();
    await page.waitForFunction(() => document.querySelector("#status").textContent.includes("mock disk full"));
    assert.equal(stops, 0);
    assert.equal(dialogs, 0, "Save failure must not ask to stop");
    assert.equal(await page.locator("#stopEditorBtn").isDisabled(), false);
    assert.equal(await page.locator("#chooseFileBtn").isDisabled(), false);
    assert.equal(await page.locator(".workspace").evaluate((node) => node.inert), false);
    assert.equal(await page.frameLocator("#preview").locator("#title").textContent(), "Preserve unsaved text");
    assert.doesNotMatch(readFileSync(input, "utf8"), /Preserve unsaved text/);
    assert.equal((await fetch(`${server.url}/api/project`)).status, 200);
    await page.unroute("**/api/patch-elements");
    await editInline(page, "Retry after save failure");
    await page.locator("#stopEditorBtn").click();
    await page.waitForFunction(() => document.querySelector("#status").textContent === "\u670d\u52a1\u5df2\u505c\u6b62");
    assert.match(readFileSync(input, "utf8"), /Retry after save failure/);
    assert.equal(stops, 1);
    assert.equal(dialogs, 1);
  });

  await fixture("cancel-after-save", async ({ page, server, input }) => {
    let stops = 0;
    page.on("request", (request) => { if (new URL(request.url()).pathname === "/api/stop-editor") stops += 1; });
    page.once("dialog", async (dialog) => { await dialog.dismiss(); });
    await editInline(page, "Saved but not stopped");
    await page.locator("#stopEditorBtn").click();
    await page.waitForFunction(() => !document.querySelector("#stopEditorBtn").disabled);
    assert.match(readFileSync(input, "utf8"), /Saved but not stopped/);
    assert.equal(stops, 0);
    assert.equal((await fetch(`${server.url}/api/project`)).status, 200);
    await editInline(page, "Editing after cancellation");
  });

  await fixture("stop-request-error-can-retry", async ({ page, server }) => {
    page.on("dialog", async (dialog) => { await dialog.accept(); });
    await page.route("**/api/stop-editor", (route) => route.fulfill({
      status: 503, contentType: "application/json", body: JSON.stringify({ ok: false, error: "mock stop failure" }),
    }));
    await page.locator("#stopEditorBtn").click();
    await page.waitForFunction(() => document.querySelector("#status").textContent.includes("mock stop failure"));
    assert.equal(await page.locator("#stopEditorBtn").isDisabled(), false);
    assert.equal(await page.locator("#chooseFileBtn").isDisabled(), false);
    assert.equal((await fetch(`${server.url}/api/project`)).status, 200);
    await page.unroute("**/api/stop-editor");
    await editInline(page, "Editing after failed stop");
    await page.locator("#stopEditorBtn").click();
    await page.waitForFunction(() => document.querySelector("#status").textContent === "\u670d\u52a1\u5df2\u505c\u6b62");
  });
  console.log("All stop editor browser integration tests passed");
} finally {
  await browser.close();
  assert.equal(dirname(root), realpathSync(tmpdir()));
  rmSync(root, { recursive: true, force: true });
}
