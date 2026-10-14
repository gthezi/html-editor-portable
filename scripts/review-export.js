const REVIEW_PAYLOAD_ATTRIBUTE = "data-he-review-payload";
const REVIEW_RUNTIME_ATTRIBUTE = "data-he-review-runtime";

function escapeJsonForScript(value) {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026");
}

function removeReviewScripts(source) {
  return String(source || "")
    .replace(new RegExp(`<script\\b[^>]*${REVIEW_PAYLOAD_ATTRIBUTE}[^>]*>[\\s\\S]*?<\\/script>`, "gi"), "")
    .replace(new RegExp(`<script\\b[^>]*${REVIEW_RUNTIME_ATTRIBUTE}[^>]*>[\\s\\S]*?<\\/script>`, "gi"), "");
}

function existingReviewPayload(source) {
  const match = String(source || "").match(new RegExp(`<script\\b[^>]*${REVIEW_PAYLOAD_ATTRIBUTE}[^>]*>([\\s\\S]*?)<\\/script>`, "i"));
  if (!match) return null;
  try {
    const payload = JSON.parse(match[1]);
    if (!payload || payload.version !== 1 || !Array.isArray(payload.comments)) throw new Error("Unsupported review data");
    return payload;
  } catch {
    throw new Error("Existing review data is invalid; keep this file and repair its review data before exporting");
  }
}

function insertBeforeDocumentEnd(source, addition) {
  const match = String(source || "").match(/<\/body\s*>/i);
  if (match && match.index != null) {
    return `${source.slice(0, match.index)}${addition}${source.slice(match.index)}`;
  }
  const htmlEnd = String(source || "").match(/<\/html\s*>/i);
  if (htmlEnd && htmlEnd.index != null) {
    return `${source.slice(0, htmlEnd.index)}${addition}${source.slice(htmlEnd.index)}`;
  }
  return `${source}${addition}`;
}

function stableDocumentId(filename, source) {
  let hash = 2166136261;
  for (const char of `${filename}\n${source}`) {
    hash ^= char.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `review-${(hash >>> 0).toString(16)}`;
}

export function buildReviewableHtml(source, {
  filename = "document.html",
  runtimeSource = "",
  documentId = stableDocumentId(filename, source),
} = {}) {
  if (!String(runtimeSource).trim()) throw new Error("Review runtime is unavailable");
  const existing = existingReviewPayload(source);
  const cleanSource = removeReviewScripts(source);
  const payload = {
    ...existing,
    version: 1,
    documentId: existing && typeof existing.documentId === "string" ? existing.documentId : documentId,
    filename,
    source: cleanSource,
    comments: existing ? existing.comments : [],
    author: existing && typeof existing.author === "string" ? existing.author : "",
  };
  const payloadScript = `<script type="application/json" ${REVIEW_PAYLOAD_ATTRIBUTE}>${escapeJsonForScript(payload)}</script>`;
  const runtimeScript = `<script ${REVIEW_RUNTIME_ATTRIBUTE}>\n(${String(runtimeSource).trim()})();\n</script>`;
  return insertBeforeDocumentEnd(cleanSource, `\n${payloadScript}\n${runtimeScript}\n`);
}

export function reviewDownloadName(filename = "document.html") {
  const base = String(filename).split(/[\\/]/).pop() || "document.html";
  return base.replace(/\.html?$/i, "") + ".review.html";
}
