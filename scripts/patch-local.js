"use strict";

// Local, reversible tweak so the built-in "Open" dialog (a PowerShell file
// picker spawned by the editor) does not flash a console window on Windows.
// Safe to run repeatedly; it is applied again after every npm install.

const fs = require("node:fs");
const path = require("node:path");

const TOOL = path.join(__dirname, "..");

// Reapply the deletion/save fix when setup reinstalls the editor package.
const appPath = path.join(TOOL, "app", "node_modules", "@deckflow", "html-editor", "public", "app.js");
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
  if (original.includes(cachedTarget)) {
    const patched = original
      .replace(cachedTarget, liveTarget)
      .replace("  elementTargets: new WeakMap(),\n", "")
      .replace("  state.elementTargets.set(element, target);\n", "")
      .replace(tableCache, "");
    fs.writeFileSync(appPath, patched);
    console.log("patch-local: applied deletion/save target fix.");
  } else if (original.includes(liveTarget)) {
    console.log("patch-local: deletion/save target fix already applied.");
  } else {
    console.warn("patch-local: deletion/save target pattern not found; review this editor version.");
  }
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

let source = fs.readFileSync(target, "utf8");

if (source.includes("windowsHide")) {
  console.log("patch-local: already applied.");
  process.exit(0);
}

const from = 'execFile(file, args, { encoding: "utf-8" }';
const to = 'execFile(file, args, { encoding: "utf-8", windowsHide: true }';

if (!source.includes(from)) {
  console.log("patch-local: expected pattern not found, skipping.");
  process.exit(0);
}

source = source.replace(from, to);
fs.writeFileSync(target, source);
console.log("patch-local: applied windowsHide to native file picker.");
