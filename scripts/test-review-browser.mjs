import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { buildReviewableHtml } from "./review-export.js";
import { bootReview } from "./review-runtime.js";

const playwrightPath = process.env.PLAYWRIGHT_MODULE;
if (!playwrightPath) throw new Error("Set PLAYWRIGHT_MODULE to run browser review tests");
const requirePlaywright = createRequire(join(playwrightPath, "package.json"));
const { chromium } = requirePlaywright("playwright");

const clean = "<!doctype html><html><head><meta charset=\"utf-8\"><title>Review fixture</title></head><body><main><h1>研究汇报标题</h1><p>这是需要审阅的正文内容。</p></main></body></html>";
const html = buildReviewableHtml(clean, {
  filename: "brief.html",
  runtimeSource: bootReview.toString(),
});
const root = mkdtempSync(join(tmpdir(), "html-editor-review-browser-"));
const file = join(root, "brief.review.html");
writeFileSync(file, html, "utf8");
const server = createServer((request, response) => {
  response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  response.end(html);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
const url = `http://127.0.0.1:${address.port}/brief.review.html`;
const browser = await chromium.launch({ executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", headless: true });
try {
  const page = await browser.newPage({ acceptDownloads: true });
  await page.goto(url, { waitUntil: "load" });
  const host = page.locator("[data-he-review-ui]");
  await host.locator("button[aria-label='打开批注']").click();
  await page.evaluate(() => {
    const target = [...document.querySelectorAll("p")].find((node) => node.textContent.includes("需要审阅"));
    const text = [...target.childNodes].find((node) => node.nodeType === Node.TEXT_NODE);
    const start = text.nodeValue.indexOf("需要审阅");
    const range = document.createRange();
    range.setStart(text, start);
    range.setEnd(text, start + "需要审阅".length);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
  });
  await host.locator("textarea[aria-label='批注']").fill("请补充数据来源。");
  await host.locator("button[aria-label='保存批注']").click();
  assert.equal(await host.locator(".he-review-item").count(), 1);
  assert.equal(await host.locator(".he-review-item p").first().textContent(), "请补充数据来源。");
  const downloadPromise = page.waitForEvent("download");
  await host.locator("button[aria-label='导出审阅文件']").click();
  const download = await downloadPromise;
  const exported = readFileSync(await download.path(), "utf8");
  assert.match(exported, /data-he-review-payload/);
  assert.match(exported, /请补充数据来源。/);
  assert.match(exported, /data-he-review-runtime/);
  assert.match(exported, /这是需要审阅的正文内容。/);
  console.log("Browser review flow passed");
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
  rmSync(root, { recursive: true, force: true });
}
