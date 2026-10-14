import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createEditorServer } from '../app/node_modules/@deckflow/html-editor/server.js';
import patches from './fit-focus-patch.js';

const modulePath = process.env.PLAYWRIGHT_MODULE;
if (!modulePath) throw new Error('Set PLAYWRIGHT_MODULE to the Playwright package directory');
const require = createRequire(join(modulePath, 'package.json'));
const { chromium } = require('playwright');
const fitSource = readFileSync(new URL('../app/node_modules/@deckflow/html-editor/public/iframeFit.js', import.meta.url), 'utf8');
assert.equal(patches.applyFitFocusPatch(patches.applyFitFocusPatch(fitSource)), patches.applyFitFocusPatch(fitSource));
const root = mkdtempSync(join(tmpdir(), 'html-editor-fit-focus-'));
const input = join(root, 'brief.html');
writeFileSync(input, '<!doctype html><html><head><meta charset="utf-8"></head><body><h1 id="title">Before</h1><p>Keep</p></body></html>');
const server = await createEditorServer({ input, port: 0 });
const browser = await chromium.launch({ channel: 'chrome' });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto(server.url + '/__local-editor__/', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.querySelector('#status').textContent.startsWith('Loaded '));
  const title = page.frameLocator('#preview').locator('#title');
  await title.click({ position: { x: 20, y: 15 } });
  await title.fill('Uncommitted editing text');
  assert.doesNotMatch(readFileSync(input, 'utf8'), /Uncommitted editing text/);
  for (const width of [800, 390, 1040, 1280]) {
    await page.setViewportSize({ width, height: 800 });
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await title.getAttribute('contenteditable'), 'plaintext-only');
    assert.equal(await title.evaluate((node) => node.ownerDocument.activeElement === node), true, 'Fitting must not blur the editing node');
    assert.equal(await title.textContent(), 'Uncommitted editing text');
  }
  await title.fill('Saved after resizing');
  const confirm = page.waitForEvent('dialog');
  const clicked = page.locator('#stopEditorBtn').click();
  const dialog = await confirm;
  try {
    assert.match(readFileSync(input, 'utf8'), /Saved after resizing/, 'Inline text must reach disk before shutdown confirmation');
    assert.match(readFileSync(input, 'utf8'), /<p>Keep<\/p>/);
    assert.doesNotMatch(readFileSync(input, 'utf8'), /contenteditable|data-local-editor-editing/);
  } finally {
    await dialog.accept();
    await clicked;
  }
  await page.waitForFunction(() => document.querySelector('#status').textContent === '服务已停止');
  await server.close();
  await assert.rejects(fetch(server.url + '/api/project'));
  console.log('Fit focus regression passed: active editing survives four widths and saves before stop');
} finally {
  await browser.close();
  await server.close();
  assert.ok(resolve(root).startsWith(resolve(tmpdir()) + '\\'));
  rmSync(root, { recursive: true, force: true });
}
