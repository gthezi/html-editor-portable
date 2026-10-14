import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { buildReviewableHtml, reviewDownloadName } from "./review-export.js";

const runtime = "function bootReview() { document.body.dataset.reviewReady = 'true'; }";

test("buildReviewableHtml preserves source and appends a self-contained review payload", () => {
  const source = "<!doctype html><html><body><h1>研究汇报</h1><p data-note=\"x\">原始内容</p></body></html>";
  const result = buildReviewableHtml(source, { filename: "brief.html", runtimeSource: runtime });
  assert.match(result, /<h1>研究汇报<\/h1>/);
  assert.match(result, /data-he-review-payload/);
  assert.match(result, /data-he-review-runtime/);
  assert.match(result, /研究汇报/);
  assert.match(result, /\\u003c/);
  const payloadMatch = result.match(/<script type="application\/json" data-he-review-payload>([\s\S]*?)<\/script>/);
  assert.ok(payloadMatch);
  const payload = JSON.parse(payloadMatch[1]);
  assert.equal(payload.version, 1);
  assert.equal(payload.filename, "brief.html");
  assert.equal(payload.source, source);
  assert.deepEqual(payload.comments, []);
  assert.equal(result.indexOf("data-he-review-payload"), result.lastIndexOf("data-he-review-payload"));
});

test("re-export removes an existing review layer instead of nesting it", () => {
  const source = '<html><body><main>Content</main><script data-he-review-payload>{"version":1,"comments":[]}</script><script data-he-review-runtime>old()</script></body></html>';
  const result = buildReviewableHtml(source, { filename: "review.html", runtimeSource: runtime });
  assert.equal((result.match(/data-he-review-payload/g) || []).length, 1);
  assert.equal((result.match(/data-he-review-runtime/g) || []).length, 1);
  assert.ok(!result.includes("old()"));
});

test("re-export preserves comments, colors and document identity while retaining current body", () => {
  const previous = { version: 1, documentId: "stable-document", comments: [{ id: "one", author: "张老师", text: "原批注", anchor: { exact: "Updated" } }], authorColors: { "张老师": "blue" }, revision: 4, source: "Old body" };
  const source = `<html><body><p>Updated body</p><script data-he-review-payload>${JSON.stringify(previous)}</script><script data-he-review-runtime>old()</script></body></html>`;
  const result = buildReviewableHtml(source, { filename: "reviewed.html", runtimeSource: runtime });
  const payload = JSON.parse(result.match(/<script type="application\/json" data-he-review-payload>([\s\S]*?)<\/script>/)[1]);
  assert.deepEqual(payload.comments, previous.comments);
  assert.deepEqual(payload.authorColors, previous.authorColors);
  assert.equal(payload.documentId, previous.documentId);
  assert.equal(payload.revision, previous.revision);
  assert.ok(payload.source.includes("Updated body"));
  assert.ok(!payload.source.includes("Old body"));
  assert.ok(!payload.source.includes("data-he-review-payload"));
});

test("damaged or unsupported existing review data is not silently discarded", () => {
  for (const data of ["not JSON", '{"version":2,"comments":[]}', '{}']) {
    assert.throws(() => buildReviewableHtml(`<body><script data-he-review-payload>${data}</script></body>`, { runtimeSource: runtime }), /Existing review data is invalid/);
  }
});

test("reviewDownloadName creates an explicit review copy name", () => {
  assert.equal(reviewDownloadName("D:/reports/brief.html"), "brief.review.html");
  assert.equal(reviewDownloadName("brief.htm"), "brief.review.html");
  assert.equal(reviewDownloadName(""), "document.review.html");
});

test("the source runtime is available before package patching", () => {
  const runtimeSource = readFileSync(new URL("./review-runtime.js", import.meta.url), "utf8");
  assert.match(runtimeSource, /export function bootReview/);
});
