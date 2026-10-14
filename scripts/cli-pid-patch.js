"use strict";

function applyCliPidPatch(source) {
  if (source.includes("// html-editor-owned-pid-cleanup-v1")) return source;
  const importMarker = 'import { existsSync, readFileSync, statSync } from "node:fs";';
  const stateMarker = '  console.log(`Local HTML Editor: ${editor.url}`);';
  if (!source.includes(importMarker) || !source.includes(stateMarker)) {
    throw new Error("CLI PID patch: expected upstream CLI markers");
  }
  return source
    .replace(importMarker, 'import { existsSync, readFileSync, statSync, unlinkSync } from "node:fs";')
    .replace(stateMarker, `  // html-editor-owned-pid-cleanup-v1
  const pidFile = process.env.HTML_EDITOR_PIDFILE;
  if (pidFile) {
    process.once("exit", () => {
      try {
        // The wrapper supplies an exact path; never remove a newer server's PID.
        if (readFileSync(pidFile, "utf8").trim() === String(process.pid)) unlinkSync(pidFile);
      } catch {}
    });
  }
${stateMarker}`);
}

module.exports = { applyCliPidPatch };
