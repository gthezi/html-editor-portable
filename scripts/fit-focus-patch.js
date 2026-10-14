"use strict";

function applyFitFocusPatch(source) {
  if (source.includes("// html-editor-fit-focus-v1")) return source;
  const before = '    const editingNodes = [...document.querySelectorAll("[data-local-editor-editing]")];';
  if (!source.includes(before)) throw new Error("Fit focus patch: editing node marker not found");
  return source.replace(before, `    // html-editor-fit-focus-v1
    // Removing contenteditable on the focused node fires blur and ends its edit.
    const editingNodes = [...document.querySelectorAll("[data-local-editor-editing]")]
      .filter((node) => !node.contains(document.activeElement));`);
}

module.exports = { applyFitFocusPatch };
