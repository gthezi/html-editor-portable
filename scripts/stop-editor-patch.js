"use strict";

// Patches only the installed @deckflow/html-editor 0.1.8 lifecycle and stop UI.
function replaceOnce(source, before, after, label) {
  const index = source.indexOf(before);
  if (index < 0 || source.indexOf(before, index + before.length) >= 0) {
    throw new Error(`Stop editor patch: expected one ${label} anchor`);
  }
  return source.slice(0, index) + after + source.slice(index + before.length);
}

function upgradeStopServerPatch(source) {
  if (!source.includes("&& host.host === req.headers.host")) {
    source = replaceOnce(source, "        && host.port === String(address?.port)", "        && host.host === req.headers.host\n        && host.port === String(address?.port)", "canonical Host upgrade");
  }
  for (const signature of [
    '  function activateProjectInput(inputPath, kind = "file") {',
    "  function backupFile(target) {",
    "  function writeProjectFile(target, content) {",
  ]) {
    const guarded = `${signature}\n    if (stopRequested) throw new Error("Editor is stopping");`;
    if (!source.includes(guarded)) source = replaceOnce(source, signature, guarded, "shutdown mutation guard");
  }
  if (!source.includes('url = new URL(req.url || "/", "http://127.0.0.1");')) {
    source = replaceOnce(source, '    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);', `    let url;
    try {
      url = new URL(req.url || "/", "http://127.0.0.1");
    } catch {
      json(res, 400, { ok: false, error: "Invalid request URL" });
      return;
    }`, "safe route URL");
  }
  return replaceOnce(source, "// html-editor-stop-server-v1", "// html-editor-stop-server-v2", "server patch version");
}

function applyStopServerPatch(source) {
  if (source.includes("// html-editor-stop-server-v2")) return source;
  if (source.includes("// html-editor-stop-server-v1")) return upgradeStopServerPatch(source);
  source = replaceOnce(source, "  let watcher = null;", `  let watcher = null;
  // html-editor-stop-server-v1
  const stopSockets = new Set();
  let stopRequested = false;
  let stopPromise = null;

  function closeEditorServer() {
    if (stopPromise) return stopPromise;
    stopRequested = true;
    watcher?.close();
    watcher = null;
    for (const client of eventClients) client.end();
    eventClients.clear();
    stopPromise = new Promise((resolveClose, rejectClose) => {
      const deadline = setTimeout(() => {
        for (const socket of stopSockets) socket.destroy();
      }, 750);
      deadline.unref();
      server.close((error) => {
        clearTimeout(deadline);
        if (error && error.code !== "ERR_SERVER_NOT_RUNNING") rejectClose(error);
        else resolveClose();
      });
      server.closeIdleConnections?.();
    });
    return stopPromise;
  }

  function validStopRequest(req) {
    try {
      const host = new URL(\`http://\${req.headers.host}\`);
      const origin = new URL(req.headers.origin);
      const referer = new URL(req.headers.referer);
      const address = server.address();
      return ["127.0.0.1", "localhost", "[::1]"].includes(host.hostname)
        && host.host === req.headers.host
        && host.port === String(address?.port)
        && origin.origin === host.origin
        && !origin.username && !origin.password
        && origin.href === \`\${origin.origin}/\`
        && referer.origin === host.origin
        && ["/__local-editor__/", "/__local-editor__/index.html"].includes(referer.pathname)
        && req.headers["x-html-editor-action"] === "stop"
        && /^application\\/json(?:\\s*;|$)/i.test(req.headers["content-type"] || "")
        && (!req.headers["sec-fetch-site"] || req.headers["sec-fetch-site"] === "same-origin")
        && (!req.headers["sec-fetch-dest"] || req.headers["sec-fetch-dest"] === "empty");
    } catch {
      return false;
    }
  }
`, "watcher state");
  source = replaceOnce(source, '    if (url.pathname === "/api/project" && req.method === "GET") {', `    if (url.pathname === "/api/stop-editor") {
      if (!serveEditorUi) {
        json(res, 404, { ok: false, error: "Editor UI is not enabled" });
        return;
      }
      if (req.method !== "POST") {
        res.setHeader("allow", "POST");
        json(res, 405, { ok: false, error: "Use POST" });
        return;
      }
      if (!validStopRequest(req)) {
        json(res, 403, { ok: false, error: "Stop must be requested from the local editor page" });
        return;
      }
      try {
        const payload = JSON.parse(await readBody(req));
        if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("Expected a JSON object");
      } catch {
        json(res, 400, { ok: false, error: "Expected a JSON object" });
        return;
      }
      // Flush the acknowledgement before ending SSE or the request socket.
      res.setHeader("connection", "close");
      res.once("finish", () => { void closeEditorServer().catch(console.error); });
      json(res, 200, { ok: true, stopped: true });
      return;
    }
    if (stopRequested) {
      json(res, 503, { ok: false, error: "Editor is stopping" });
      return;
    }

    if (url.pathname === "/api/project" && req.method === "GET") {`, "project route");
  source = replaceOnce(source, '  await new Promise((resolveListen, rejectListen) => {', `  server.on("connection", (socket) => {
    stopSockets.add(socket);
    socket.once("close", () => stopSockets.delete(socket));
    if (stopRequested) socket.destroy();
  });

  await new Promise((resolveListen, rejectListen) => {`, "listen");
  source = replaceOnce(source, `  let closed = false;
  return {
    defaultFile,
    projectDir,
    url: \`http://\${host}:\${actualPort}\`,
    async close() {
      if (closed) return;
      closed = true;
      watcher?.close();
      for (const client of eventClients) client.end();
      await new Promise((resolveClose, rejectClose) => {
        server.close((error) => (error ? rejectClose(error) : resolveClose()));
      });
    },
  };`, `  return {
    defaultFile,
    projectDir,
    url: \`http://\${host}:\${actualPort}\`,
    close: closeEditorServer,
  };`, "returned close API");
  return upgradeStopServerPatch(source);
}

function upgradeStopAppPatch(source) {
  source = replaceOnce(source, `  setOpenPickerMenu(false);
  lockStopUi(true);
  try {`, `  setOpenPickerMenu(false);
  try {
    stopInlineTextEdit({ commit: true });
    lockStopUi(true);`, "commit before locking focus");
  source = replaceOnce(source, 'els.stopEditorBtn.addEventListener("click", stopEditor);', `els.stopEditorBtn.addEventListener("pointerdown", (event) => event.preventDefault());
els.stopEditorBtn.addEventListener("click", stopEditor);`, "preserve inline focus on stop pointerdown");
  return replaceOnce(source, "// html-editor-stop-app-v1", "// html-editor-stop-app-v2", "application patch version");
}

function applyStopAppPatch(source) {
  if (source.includes("// html-editor-stop-app-v2")) return source;
  if (source.includes("// html-editor-stop-app-v1")) return upgradeStopAppPatch(source);
  source = replaceOnce(source, "  autoSaveError: null,", `  autoSaveError: null,
  stopPhase: "idle",
  stopTransitions: 0,`, "application state");
  source = replaceOnce(source, '  reloadBtn: document.querySelector("#reloadBtn"),', '  reloadBtn: document.querySelector("#reloadBtn"),\n  stopEditorBtn: document.querySelector("#stopEditorBtn"),', "stop button reference");
  source = replaceOnce(source, 'function setStatus(message, tone = "normal") {', 'function setStatus(message, tone = "normal") {\n  if (state.stopPhase === "stopped") { message = "\\u670d\\u52a1\\u5df2\\u505c\\u6b62"; tone = "normal"; }', "status");
  for (const signature of [
    "async function loadFile(path = state.currentPath) {",
    "async function loadBrowserHtmlFile(file, handle = null) {",
    "async function chooseLocalInput(kind) {",
  ]) {
    const name = signature.match(/function (\w+)/)[1];
    source = replaceOnce(source, signature, `async function ${name}(...args) {
  if (state.stopPhase !== "idle") return;
  state.stopTransitions += 1;
  try { return await ${name}BeforeStop(...args); }
  finally { state.stopTransitions -= 1; }
}

${signature.replace(name, `${name}BeforeStop`)}`, name);
  }
  source = replaceOnce(source, "async function postJson(url, payload) {", `async function postJson(url, payload) {
  if (["stopping", "stopped"].includes(state.stopPhase)) throw new Error("Editor is stopped");`, "write guard");
  source = replaceOnce(source, "async function flushPendingPatches() {", `async function flushPendingPatches() {
  if (["stopping", "stopped"].includes(state.stopPhase)) return true;`, "autosave guard");
  source = replaceOnce(source, "async function saveFile() {", `async function saveFile() {
  if (["stopping", "stopped"].includes(state.stopPhase)) throw new Error("Editor is stopped");`, "save guard");
  source = replaceOnce(source, "function connectProjectEvents() {", `function connectProjectEvents() {
  if (state.stopPhase !== "idle") return;`, "SSE reconnect guard");
  source = replaceOnce(source, '    const change = JSON.parse(event.data);', '    if (state.stopPhase !== "idle") return;\n    const change = JSON.parse(event.data);', "SSE event guard");
  source = replaceOnce(source, "autoSave = createAutoSaveController({", `// html-editor-stop-app-v1
let stopControlSnapshot = [];

function lockStopUi(locked) {
  document.body.dataset.editorStopping = String(locked);
  els.workspace.inert = locked;
  if (locked) {
    stopControlSnapshot = [...document.querySelectorAll("button, input, textarea, select")]
      .map((control) => [control, control.disabled]);
    for (const [control] of stopControlSnapshot) control.disabled = true;
  } else {
    for (const [control, disabled] of stopControlSnapshot) control.disabled = disabled;
    stopControlSnapshot = [];
  }
}

// Capture shortcuts and preview input while save/confirmation/stop is in progress.
function blockStopInput(event) {
  if (state.stopPhase === "idle") return;
  event.preventDefault();
  event.stopImmediatePropagation();
}
for (const type of ["keydown", "beforeinput", "input", "paste", "drop", "pointerdown", "mousedown", "click", "dblclick"]) {
  window.addEventListener(type, blockStopInput, true);
}

async function stopEditor() {
  if (state.stopPhase !== "idle") return;
  if (state.stopTransitions || state.fileSwitchInProgress) {
    setStatus("\\u8bf7\\u7b49\\u5f85\\u6587\\u4ef6\\u64cd\\u4f5c\\u5b8c\\u6210", "warn");
    return;
  }
  let reconnectEvents = false;
  let previewWindow = null;
  const inputTypes = ["keydown", "beforeinput", "input", "paste", "drop", "pointerdown", "mousedown", "click", "dblclick"];
  state.stopPhase = "saving";
  setOpenPickerMenu(false);
  lockStopUi(true);
  try {
    previewWindow = els.preview.contentWindow;
    for (const type of inputTypes) previewWindow?.addEventListener(type, blockStopInput, true);
    await saveFile();
    if (!window.confirm("\\u5df2\\u4fdd\\u5b58\\u4fee\\u6539\\u3002\\u786e\\u5b9a\\u505c\\u6b62\\u7f16\\u8f91\\u5668\\u670d\\u52a1\\uff1f")) return;
    state.stopPhase = "stopping";
    autoSave.cancel();
    reconnectEvents = Boolean(state.projectEvents);
    state.projectEvents?.close();
    state.projectEvents = null;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5_000);
    let response;
    try {
      response = await fetch("/api/stop-editor", {
        method: "POST",
        headers: { "content-type": "application/json", "X-HTML-Editor-Action": "stop" },
        body: "{}",
        signal: controller.signal,
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok || !payload.stopped) throw new Error(payload.error || "Stop request failed");
    } finally {
      clearTimeout(timeout);
    }
    state.stopPhase = "stopped";
    autoSave.destroy();
    state.previewEventCleanup?.();
    state.previewEventCleanup = null;
    state.canvasEditor?.destroy();
    state.canvasEditor = null;
    setStatus("\\u670d\\u52a1\\u5df2\\u505c\\u6b62");
  } catch (error) {
    setStatus(\`\\u672a\\u505c\\u6b62\\u7f16\\u8f91\\u5668\\uff1a\${error.message}\`, "error");
  } finally {
    if (state.stopPhase !== "stopped") {
      state.stopPhase = "idle";
      lockStopUi(false);
      for (const type of inputTypes) previewWindow?.removeEventListener(type, blockStopInput, true);
      if (reconnectEvents) connectProjectEvents();
    }
  }
}
els.stopEditorBtn.addEventListener("click", stopEditor);

autoSave = createAutoSaveController({`, "autosave initialization");
  return upgradeStopAppPatch(source);
}

function applyStopUiPatch(source) {
  if (source.includes('id="stopEditorBtn"')) return source;
  const button = `          <button id="stopEditorBtn" class="icon-button stop-editor-button" type="button" title="&#20572;&#27490;&#32534;&#36753;&#22120;" aria-label="&#20572;&#27490;&#32534;&#36753;&#22120;">
            <svg class="lucide lucide-power" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M12 2v10" />
              <path d="M18.4 6.6a9 9 0 1 1-12.77.04" />
            </svg>
          </button>
`;
  return replaceOnce(source, '          <span class="local-badge">', button + '          <span class="local-badge">', "toolbar");
}

function applyStopStylesPatch(source) {
  if (source.includes("/* html-editor-stop-styles-v1 */")) return source;
  return source + `
/* html-editor-stop-styles-v1 */
.stop-editor-button { flex: 0 0 34px; width: 34px; height: 34px; color: var(--danger); }
.stop-editor-button:hover:not(:disabled) { background: var(--danger-soft); border-color: var(--danger); }
body[data-editor-stopping="true"] #preview { pointer-events: none; }
`;
}

module.exports = { applyStopServerPatch, applyStopAppPatch, applyStopUiPatch, applyStopStylesPatch };
