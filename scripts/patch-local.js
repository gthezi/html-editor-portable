"use strict";

// Local, reversible tweak so the built-in "Open" dialog (a PowerShell file
// picker spawned by the editor) does not flash a console window on Windows.
// Safe to run repeatedly; it is applied again after every npm install.

const fs = require("node:fs");
const path = require("node:path");
const { applyReviewIntegration, applyReviewUi, applyReviewStyles } = require("./review-app-integration.js");
const { applyNativePickerPatch } = require("./native-picker-patch.js");
const { applyCliPidPatch } = require("./cli-pid-patch.js");
const { applyFitFocusPatch } = require("./fit-focus-patch.js");
const { applyStopServerPatch, applyStopAppPatch, applyStopUiPatch, applyStopStylesPatch } = require("./stop-editor-patch.js");

const TOOL = path.join(__dirname, "..");

// Reapply the deletion/save fix when setup reinstalls the editor package.
const appPath = path.join(TOOL, "app", "node_modules", "@deckflow", "html-editor", "public", "app.js");
const reviewRuntimeSourcePath = path.join(TOOL, "scripts", "review-runtime.js");
const reviewExportSourcePath = path.join(TOOL, "scripts", "review-export.js");
const reviewRuntimeTargetPath = path.join(TOOL, "app", "node_modules", "@deckflow", "html-editor", "public", "review-runtime.js");
const reviewExportTargetPath = path.join(TOOL, "app", "node_modules", "@deckflow", "html-editor", "public", "review-export.js");

for (const [sourcePath, targetPath] of [
  [reviewRuntimeSourcePath, reviewRuntimeTargetPath],
  [reviewExportSourcePath, reviewExportTargetPath],
]) {
  if (fs.existsSync(sourcePath) && fs.existsSync(path.dirname(targetPath))) {
    fs.copyFileSync(sourcePath, targetPath);
  }
}

if (fs.existsSync(appPath)) {
  const original = fs.readFileSync(appPath, "utf8");
  const cachedTarget = `function targetForElement(el) {
  const existing = state.elementTargets.get(el);
  if (existing) return existing;
  const target = createElementTarget(el, selectorFor(el));
  state.elementTargets.set(el, target);
  return target;
}`;
  const liveTarget = `function targetForElement(el) {
  // Earlier patches may have moved siblings or changed ancestor text. Resolve
  // live identity here; queued patches already retain their pre-edit snapshots.
  return createElementTarget(el, selectorFor(el));
}`;
  const tableCache = `      // A table operation changes its text fingerprint and DOM paths. Cache the
      // new identity so a second operation in the same auto-save batch resolves
      // against the source produced by the first operation.
      state.elementTargets.set(
        context.table,
        createElementTarget(context.table, selectorFor(context.table)),
      );
`;
  let patched = original;
  if (patched.includes(cachedTarget)) {
    patched = patched
      .replace(cachedTarget, liveTarget)
      .replace("  elementTargets: new WeakMap(),\n", "")
      .replace("  state.elementTargets.set(element, target);\n", "")
      .replace(tableCache, "");
    console.log("patch-local: applied deletion/save target fix.");
  } else if (patched.includes(liveTarget)) {
    console.log("patch-local: deletion/save target fix already applied.");
  } else {
    console.warn("patch-local: deletion/save target pattern not found; review this editor version.");
  }

  const reviewImports =
    'import { buildReviewableHtml, reviewDownloadName } from "./review-export.js?v=review-export-v1";\n' +
    'import { bootReview } from "./review-runtime.js?v=review-runtime-v1";\n';
  if (!patched.includes("./review-export.js?v=review-export-v1")) {
    const importMarker = "// state 保存编辑器运行时状态；真正的 HTML 内容仍然在 iframe 文档里。";
    if (!patched.includes(importMarker)) {
      throw new Error("patch-local: editor import marker not found");
    }
    patched = patched.replace(importMarker, `${reviewImports}\n${importMarker}`);
    console.log("patch-local: added review export imports.");
  }

  if (patched !== original) fs.writeFileSync(appPath, patched);

  const integrated = applyStopAppPatch(applyReviewIntegration(fs.readFileSync(appPath, "utf8")));
  if (integrated !== fs.readFileSync(appPath, "utf8")) fs.writeFileSync(appPath, integrated);
}

const indexPath = path.join(TOOL, "app", "node_modules", "@deckflow", "html-editor", "public", "index.html");
if (fs.existsSync(indexPath)) {
  const original = fs.readFileSync(indexPath, "utf8");
  const patched = applyStopUiPatch(applyReviewUi(original));
  if (patched !== original) fs.writeFileSync(indexPath, patched);
}

const stylesPath = path.join(TOOL, "app", "node_modules", "@deckflow", "html-editor", "public", "styles.css");
if (fs.existsSync(stylesPath)) {
  const original = fs.readFileSync(stylesPath, "utf8");
  const patched = applyStopStylesPatch(applyReviewStyles(original));
  if (patched !== original) fs.writeFileSync(stylesPath, patched);
}

const target = path.join(
  TOOL,
  "app",
  "node_modules",
  "@deckflow",
  "html-editor",
  "nativeFilePicker.js",
);

if (!fs.existsSync(target)) {
  console.log("patch-local: editor package not found, skipping.");
  process.exit(0);
}

const pickerSource = fs.readFileSync(target, "utf8");
const patchedPicker = applyNativePickerPatch(pickerSource);
if (patchedPicker !== pickerSource) fs.writeFileSync(target, patchedPicker);
console.log("patch-local: foreground native picker ready.");

const serverPath = path.join(TOOL, "app", "node_modules", "@deckflow", "html-editor", "server.js");
const serverSource = fs.readFileSync(serverPath, "utf8");
const patchedServer = applyStopServerPatch(serverSource);
if (patchedServer !== serverSource) fs.writeFileSync(serverPath, patchedServer);
console.log("patch-local: in-page editor stop ready.");

const fitPath = path.join(TOOL, "app", "node_modules", "@deckflow", "html-editor", "public", "iframeFit.js");
const fitSource = fs.readFileSync(fitPath, "utf8");
const patchedFit = applyFitFocusPatch(fitSource);
if (patchedFit !== fitSource) fs.writeFileSync(fitPath, patchedFit);

const cliPath = path.join(TOOL, "app", "node_modules", "@deckflow", "html-editor", "cli.js");
const cliSource = fs.readFileSync(cliPath, "utf8");
const patchedCli = applyCliPidPatch(cliSource);
if (patchedCli !== cliSource) fs.writeFileSync(cliPath, patchedCli);
