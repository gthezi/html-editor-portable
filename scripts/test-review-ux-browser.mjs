import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildReviewableHtml } from './review-export.js';
import { bootReview } from './review-runtime.js';

const modulePath = process.env.PLAYWRIGHT_MODULE;
if (!modulePath) throw new Error('Set PLAYWRIGHT_MODULE to the Playwright package directory');
const require = createRequire(join(modulePath, 'package.json'));
const { chromium } = require('playwright');
const root = mkdtempSync(join(tmpdir(), 'html-editor-review-colors-'));
const artifacts = resolve('logs/review-tests');
mkdirSync(artifacts, { recursive: true });
const source = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>Review color fixture</title><style>
body{margin:0;background:#f8fafc;color:#202124;font:18px/1.8 system-ui,sans-serif}main{padding:56px 32px;max-width:820px}h1{font-size:28px}p{margin:28px 0} @media(max-width:600px){main{padding:64px 18px}h1{font-size:22px}}
</style></head><body><main><h1>研究汇报批注</h1><p id="one">这是<span>需要审阅</span><strong>的正文</strong>内容，用于验证选区高亮。</p><p id="two">这里是第二条需要核对的数据。</p><p id="three">第三部分介绍实验设计。</p><p id="four">同一位作者的后续意见。</p></main></body></html>`;
const file = join(root, 'brief.review.html');
writeFileSync(file, buildReviewableHtml(source, { filename: 'brief.html', runtimeSource: bootReview.toString() }), 'utf8');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
let context;
const errors = [];

async function selectText(page, selector, exact) {
  await page.evaluate(({ selector, exact }) => {
    const element = document.querySelector(selector);
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    const nodes = [];
    let stream = '';
    while (walker.nextNode()) {
      nodes.push({ node: walker.currentNode, start: stream.length });
      stream += walker.currentNode.nodeValue;
    }
    const start = stream.indexOf(exact);
    if (start < 0) throw new Error('Selection text unavailable: ' + exact);
    const point = (offset) => {
      const node = nodes.find((entry) => offset < entry.start + entry.node.nodeValue.length) || nodes.at(-1);
      return { node: node.node, offset: offset - node.start };
    };
    const from = point(start);
    const to = point(start + exact.length);
    const range = document.createRange();
    range.setStart(from.node, from.offset);
    range.setEnd(to.node, to.offset);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    element.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
    // Simulate loss of native selection when typing in a sidebar input.
    selection.removeAllRanges();
  }, { selector, exact });
}

async function activeHighlight(page, exact, color) {
  const result = await page.evaluate(({ color }) => {
    const highlight = CSS.highlights.get('he-review-active-' + color);
    return highlight ? [...highlight].map((range) => range.toString()) : [];
  }, { color });
  assert.deepEqual(result, [exact]);
}

async function saveComment(page, selector, exact, author, expectedColor, body, override) {
  const ui = page.locator('[data-he-review-ui]');
  await selectText(page, selector, exact);
  await ui.getByRole('textbox', { name: '作者', exact: true }).fill(author);
  const checked = ui.getByRole('radio', { checked: true });
  assert.equal(await checked.getAttribute('data-color'), expectedColor);
  if (override) await ui.locator(`[data-color="${override}"][role="radio"]`).click();
  await ui.getByRole('textbox', { name: '批注', exact: true }).fill(body);
  await ui.getByRole('textbox', { name: '建议（可选）', exact: true }).click();
  assert.equal(await ui.getByRole('textbox', { name: '批注', exact: true }).inputValue(), body);
  await activeHighlight(page, exact, override || expectedColor);
  await ui.getByRole('button', { name: '保存批注', exact: true }).click();
}

async function downloadPayload(page) {
  const pending = page.waitForEvent('download');
  await page.locator('[data-he-review-ui]').getByRole('button', { name: '导出审阅文件', exact: true }).click();
  const download = await pending;
  const contents = readFileSync(await download.path(), 'utf8');
  const match = contents.match(/<script[^>]*data-he-review-payload[^>]*>([\s\S]*?)<\/script>/);
  assert.ok(match);
  return { contents, payload: JSON.parse(match[1]) };
}

try {
  context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(pathToFileURL(file).href);
  const ui = page.locator('[data-he-review-ui]');
  await selectText(page, '#one', '需要审阅的正文');
  await ui.getByRole('textbox', { name: '作者', exact: true }).fill('张老师');
  await ui.getByRole('textbox', { name: '批注', exact: true }).fill('请补充研究依据。');
  await ui.getByRole('button', { name: '收起批注', exact: true }).click();
  assert.equal(await ui.locator('.he-review-panel').isHidden(), true);
  await ui.getByRole('button', { name: '打开批注', exact: true }).click();
  assert.equal(await ui.getByRole('textbox', { name: '作者', exact: true }).inputValue(), '张老师');
  assert.equal(await ui.getByRole('textbox', { name: '批注', exact: true }).inputValue(), '请补充研究依据。');
  await activeHighlight(page, '需要审阅的正文', 'yellow');
  const visibleRange = await page.evaluate(() => {
    const range = [...CSS.highlights.get('he-review-active-yellow')][0];
    const rect = range.getBoundingClientRect();
    return { x: rect.x - 2, y: rect.y - 2, width: rect.width + 4, height: rect.height + 4 };
  });
  const highlightedPixels = await page.screenshot({ clip: visibleRange });
  await page.evaluate(() => CSS.highlights.clear());
  const unhighlightedPixels = await page.screenshot({ clip: visibleRange });
  assert.notDeepEqual(highlightedPixels, unhighlightedPixels, 'Active highlight must change rendered pixels after native selection is gone');
  // Restore visual rendering through a swatch command.
  await ui.getByRole('radio', { name: '黄色', exact: true }).click();
  await page.screenshot({ path: join(artifacts, 'review-active-desktop.png') });
  await ui.getByRole('button', { name: '保存批注', exact: true }).click();
  await ui.getByRole('button', { name: '收起批注', exact: true }).click();
  assert.equal(await ui.locator('.he-review-panel').isHidden(), true);
  await ui.getByRole('button', { name: '打开批注', exact: true }).click();
  assert.equal(await ui.locator('.he-review-panel').isVisible(), true);
  await saveComment(page, '#two', '第二条需要核对的数据', '李老师', 'blue', '核对第二条数据。');
  await saveComment(page, '#three', '实验设计', '王老师', 'pink', '补充实验对照。');
  await saveComment(page, '#four', '后续意见', '张老师', 'yellow', '同一作者继续批注。');
  assert.deepEqual(await ui.locator('.he-review-item').evaluateAll((items) => items.map((item) => item.dataset.color)), ['yellow', 'blue', 'pink', 'yellow']);
  const firstDownload = await downloadPayload(page);
  assert.deepEqual(firstDownload.payload.authorColors, { '张老师': 'yellow', '李老师': 'blue', '王老师': 'pink' });
  const reviewed = join(root, 'brief.reviewed.html');
  writeFileSync(reviewed, firstDownload.contents, 'utf8');
  await page.screenshot({ path: join(artifacts, 'review-colors-desktop.png') });
  await context.close();

  // A fresh browser context has no draft cache, so only portable file data can restore colors.
  context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1280, height: 900 } });
  const reopened = await context.newPage();
  reopened.on('pageerror', (error) => errors.push(error.message));
  await reopened.goto(pathToFileURL(reviewed).href);
  const restoredUi = reopened.locator('[data-he-review-ui]');
  await restoredUi.getByRole('button', { name: '打开批注', exact: true }).click();
  assert.deepEqual(await restoredUi.locator('.he-review-item').evaluateAll((items) => items.map((item) => item.dataset.color)), ['yellow', 'blue', 'pink', 'yellow']);
  await restoredUi.locator('.he-review-item').first().getByRole('button', { name: '编辑批注', exact: true }).click();
  await restoredUi.getByRole('radio', { name: '粉色', exact: true }).click();
  await restoredUi.getByRole('button', { name: '保存修改', exact: true }).click();
  assert.deepEqual(await restoredUi.locator('.he-review-item').evaluateAll((items) => items.map((item) => item.dataset.color)), ['pink', 'blue', 'pink', 'pink']);
  await restoredUi.locator('.he-review-item').nth(1).getByRole('button', { name: '定位到原文', exact: true }).click();
  await activeHighlight(reopened, '第二条需要核对的数据', 'blue');
  const secondDownload = await downloadPayload(reopened);
  assert.equal(secondDownload.payload.authorColors['张老师'], 'pink');
  assert.equal(secondDownload.payload.comments[3].color, 'pink');
  assert.equal(secondDownload.payload.source, source, 'Review actions must not modify source HTML');
  await reopened.setViewportSize({ width: 390, height: 844 });
  await selectText(reopened, '#one', '需要审阅的正文');
  await restoredUi.getByRole('textbox', { name: '批注', exact: true }).fill('手机视图批注');
  const panel = await restoredUi.locator('.he-review-panel').boundingBox();
  assert.ok(panel.x >= 0 && panel.x + panel.width <= 391 && panel.y + panel.height <= 845);
  const swatchSizes = await restoredUi.getByRole('radio').evaluateAll((items) => items.map((item) => ({ width: item.offsetWidth, height: item.offsetHeight })));
  assert.ok(swatchSizes.every((size) => size.width === 32 && size.height === 32));
  await activeHighlight(reopened, '需要审阅的正文', 'pink');
  const mobileOverlap = await reopened.evaluate(() => {
    const panel = document.querySelector('[data-he-review-ui]').shadowRoot.querySelector('.he-review-panel').getBoundingClientRect();
    const range = [...CSS.highlights.get('he-review-active-pink')][0];
    return [...range.getClientRects()].some((rect) => rect.width > 0 && rect.height > 0 && rect.left < panel.right && rect.right > panel.left && rect.top < panel.bottom && rect.bottom > panel.top);
  });
  assert.equal(mobileOverlap, false, 'Mobile panel must not hide the active text range');
  await reopened.screenshot({ path: join(artifacts, 'review-active-mobile.png') });
  await restoredUi.getByRole('button', { name: '取消', exact: true }).click();
  assert.equal(await reopened.evaluate(() => [...CSS.highlights.keys()].filter((name) => name.startsWith('he-review-active')).length), 0);
  await context.close();

  // Force the fallback implementation; it must retain colored highlights without wrapping text.
  context = await browser.newContext({ acceptDownloads: true });
  const fallback = await context.newPage();
  await fallback.addInitScript(() => { window.Highlight = undefined; });
  await fallback.goto(pathToFileURL(file).href);
  await selectText(fallback, '#one', '需要审阅的正文');
  const fallbackUi = fallback.locator('[data-he-review-ui]');
  await fallbackUi.getByRole('textbox', { name: '作者', exact: true }).fill('张老师');
  await fallbackUi.getByRole('radio', { name: '蓝色', exact: true }).click();
  await fallbackUi.getByRole('textbox', { name: '批注', exact: true }).fill('Fallback color');
  assert.ok(await fallback.locator('[data-he-review-active="true"][data-he-review-color="blue"]').count() > 0);
  await fallbackUi.getByRole('button', { name: '保存批注', exact: true }).click();
  assert.ok(await fallback.locator('[data-he-review-active="false"][data-he-review-color="blue"]').count() > 0);
  assert.equal(await fallback.locator('#one').innerHTML(), '这是<span>需要审阅</span><strong>的正文</strong>内容，用于验证选区高亮。');
  assert.deepEqual(errors, []);
  console.log('Review UX passed: offline file, three authors, stable colors, override, export/reopen, active highlight pixels, mobile, fallback');
} finally {
  await browser.close();
  // This is the exact unique temporary test directory created above.
  assert.ok(resolve(root).startsWith(resolve(tmpdir()) + '\\'));
  rmSync(root, { recursive: true, force: true });
}
