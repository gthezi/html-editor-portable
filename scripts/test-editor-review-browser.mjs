import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createEditorServer } from "../app/node_modules/@deckflow/html-editor/server.js";

const playwrightPath = process.env.PLAYWRIGHT_MODULE;
if (!playwrightPath) throw new Error("Set PLAYWRIGHT_MODULE to run browser editor tests");
const requirePlaywright = createRequire(join(playwrightPath, "package.json"));
const { chromium } = requirePlaywright("playwright");
const root = mkdtempSync(join(tmpdir(), "html-editor-review-editor-"));
const input = join(root, "brief.html");
const source = "<!doctype html><html><body><h1>Editor export</h1><p>Review this document.</p></body></html>";
writeFileSync(input, source, "utf8");
const server = await createEditorServer({ input, port: 0 });
const browser = await chromium.launch({ executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", headless: true });
try {
  const page = await browser.newPage({ acceptDownloads: true });
  await page.goto(`${server.url}/__local-editor__/`, { waitUntil: "networkidle" });
  const button = page.locator("#exportReviewBtn");
  await button.waitFor();
  const downloadPromise = page.waitForEvent("download");
  await button.click();
  const download = await downloadPromise;
  assert.equal(download.suggestedFilename(), "brief.review.html");
  const exported = readFileSync(await download.path(), "utf8");
  assert.match(exported, /data-he-review-payload/);
  assert.match(exported, /data-he-review-runtime/);
  assert.match(exported, /Review this document\./);
  assert.equal(readFileSync(input, "utf8"), source);
  console.log("Editor review export flow passed");
} finally {
  await browser.close();
  await server.close();
  rmSync(root, { recursive: true, force: true });
}
