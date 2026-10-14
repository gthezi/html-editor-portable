"use strict";

const reviewImports =
  'import { buildReviewableHtml, reviewDownloadName } from "./review-export.js?v=review-export-v1";\n' +
  'import { bootReview } from "./review-runtime.js?v=review-runtime-v1";\n';

const reviewButton = `          <button id="exportReviewBtn" class="review-export-button" type="button" title="Generate a reviewable HTML copy">
            <svg class="button-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M20 11.5a7.5 7.5 0 0 1-8 7.5 8.5 8.5 0 0 1-3-.55L4 20l1.55-4.25A7.5 7.5 0 1 1 20 11.5Z" />
              <path d="M8.5 11.5h.01M12 11.5h.01M15.5 11.5h.01" />
            </svg>
            <span>Review copy</span>
          </button>
`;

const reviewStyle = `.review-export-button {
  height: 34px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  padding: 0 11px;
  border: 1px solid var(--line-strong);
  border-radius: 8px;
  background: var(--surface);
  color: var(--ink);
  box-shadow: 0 1px 2px rgba(20,20,18,.06);
  white-space: nowrap;
}

.review-export-button:hover:not(:disabled) { border-color: var(--ink); background: var(--surface-soft); }
.review-export-button .button-icon { width: 15px; height: 15px; }
`;

const reviewStyleMobile = `  .file-picker-button > span,
  .review-export-button > span { display: none; }
  .review-export-button { padding-inline: 9px; }
`;

const reviewExportFunction = `async function exportReviewCopy() {
  try {
    await saveFile();
    if (!state.source) throw new Error("Choose an HTML file before exporting a review copy");
    const filename = state.currentPath || state.browserFileName || "document.html";
    const html = buildReviewableHtml(state.source, {
      filename,
      runtimeSource: bootReview.toString(),
    });
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = reviewDownloadName(filename);
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setStatus(\`Downloaded \${anchor.download}\`, "ok");
  } catch (error) {
    setStatus(error.message, "error");
  }
}
`;

function applyReviewIntegration(source) {
  let next = String(source || "");
  if (!next.includes("./review-export.js?v=review-export-v1")) {
    const marker = "// state 保存编辑器运行时状态；真正的 HTML 内容仍然在 iframe 文档里。";
    if (!next.includes(marker)) throw new Error("review patch: app import marker not found");
    next = next.replace(marker, `${reviewImports}\n${marker}`);
  }
  if (!next.includes("exportReviewBtn: document.querySelector(\"#exportReviewBtn\")")) {
    const marker = '  chooseFileBtn: document.querySelector("#chooseFileBtn"),\n';
    if (!next.includes(marker)) throw new Error("review patch: element reference marker not found");
    next = next.replace(marker, `${marker}  exportReviewBtn: document.querySelector("#exportReviewBtn"),\n`);
  }
  if (!next.includes("async function exportReviewCopy()")) {
    const marker = "async function saveFile() {\n  stopInlineTextEdit({ commit: true });\n  await autoSave.flushNow();\n  if (state.dirty) {\n    throw state.autoSaveError || new Error(\"The current changes could not be saved\");\n  }\n}\n";
    if (!next.includes(marker)) throw new Error("review patch: save function marker not found");
    next = next.replace(marker, `${marker}\n${reviewExportFunction}`);
  }
  if (!next.includes("els.exportReviewBtn.addEventListener(\"click\", exportReviewCopy);")) {
    const marker = "autoSave = createAutoSaveController({";
    if (!next.includes(marker)) throw new Error("review patch: autosave marker not found");
    next = next.replace(marker, 'els.exportReviewBtn.addEventListener("click", exportReviewCopy);\n\n' + marker);
  }
  return next;
}

function applyReviewUi(source) {
  let next = String(source || "");
  if (!next.includes('id="exportReviewBtn"')) {
    const marker = '            <input id="htmlFileInput" type="file" accept=".html" hidden />\n          </div>\n';
    if (!next.includes(marker)) throw new Error("review patch: toolbar marker not found");
    next = next.replace(marker, `${marker}${reviewButton}`);
  }
  return next;
}

function applyReviewStyles(source) {
  let next = String(source || "");
  if (!next.includes(".review-export-button {")) {
    const marker = ".file-picker-button:hover:not(:disabled) { border-color: #30302d; background: #30302d; }\n";
    if (!next.includes(marker)) throw new Error("review patch: button style marker not found");
    next = next.replace(marker, `${marker}\n${reviewStyle}`);
  }
  if (!next.includes(".review-export-button > span")) {
    const marker = "  .file-picker-button > span { display: none; }\n";
    if (!next.includes(marker)) throw new Error("review patch: mobile style marker not found");
    next = next.replace(marker, reviewStyleMobile);
  }
  return next;
}

module.exports = { applyReviewIntegration, applyReviewUi, applyReviewStyles };
