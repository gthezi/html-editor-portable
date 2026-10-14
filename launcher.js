"use strict";

// Starts (or reuses) the local deckflow HTML editor server and opens the browser.
// Every path is derived from this file's own folder, so the whole tool directory
// can be copied to another Windows machine unchanged.

const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { spawn, execFileSync } = require("node:child_process");

const TOOL = __dirname;
const LOG = path.join(TOOL, "logs", "launcher.log");
const PIDFILE = path.join(TOOL, ".server.pid");

function log(message) {
  try {
    fs.mkdirSync(path.dirname(LOG), { recursive: true });
    fs.appendFileSync(LOG, `[${new Date().toISOString()}] ${message}\n`);
  } catch {
    /* logging must never break startup */
  }
}

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(path.join(TOOL, "config.json"), "utf8"));
  } catch {
    return {};
  }
}

const cfg = readConfig();
const PORT = Number(cfg.port) || 4177;
const URL = `http://127.0.0.1:${PORT}/`;
const NODE = path.join(TOOL, "node", "node.exe");
const CLI = path.join(TOOL, "app", "node_modules", "@deckflow", "html-editor", "bin", "htmleditor.js");

function resolveDefaultTarget() {
  const value = cfg.defaultTarget || "workspace";
  if (path.isAbsolute(value)) return value;
  return path.join(TOOL, value);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function httpGet(requestPath, timeout = 1500) {
  return new Promise((resolve) => {
    const req = http.get({ host: "127.0.0.1", port: PORT, path: requestPath, timeout }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => resolve({ status: res.statusCode, body }));
    });
    req.on("error", () => resolve(null));
    req.on("timeout", () => {
      req.destroy();
      resolve(null);
    });
  });
}

function openBrowser(url) {
  try {
    spawn("cmd", ["/c", "start", "", url], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    }).unref();
  } catch (error) {
    log(`openBrowser failed: ${error}`);
  }
}

function showMessage(text) {
  try {
    spawn("wscript.exe", [path.join(TOOL, "message.vbs"), text], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    }).unref();
  } catch {
    /* ignore */
  }
}

function pidsOnPort(port) {
  try {
    const out = execFileSync("netstat", ["-ano", "-p", "tcp"], {
      encoding: "utf8",
      windowsHide: true,
    });
    const pids = new Set();
    for (const line of out.split(/\r?\n/)) {
      if (!line.includes("LISTENING")) continue;
      if (!new RegExp(`:${port}\\s`).test(line)) continue;
      const cols = line.trim().split(/\s+/);
      pids.add(cols[cols.length - 1]);
    }
    return [...pids];
  } catch {
    return [];
  }
}

function killPid(pid) {
  try {
    execFileSync("taskkill", ["/PID", String(pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    });
    return true;
  } catch {
    return false;
  }
}

function cleanStalePidFile() {
  try {
    if (fs.existsSync(PIDFILE)) fs.rmSync(PIDFILE);
  } catch {
    /* ignore */
  }
}

async function startServer(input) {
  if (!fs.existsSync(NODE)) {
    showMessage("HTML Editor is not set up yet. Please double-click Setup.cmd first.");
    log("node runtime missing");
    return false;
  }
  if (!fs.existsSync(CLI)) {
    showMessage("HTML Editor files are incomplete. Please run Setup.cmd again.");
    log("editor CLI missing");
    return false;
  }

  fs.mkdirSync(path.dirname(LOG), { recursive: true });
  const out = fs.openSync(path.join(TOOL, "logs", "server.log"), "a");
  const child = spawn(NODE, [CLI, input, "--port", String(PORT), "--no-open"], {
    detached: true,
    stdio: ["ignore", out, out],
    windowsHide: true,
    cwd: TOOL,
    env: { ...process.env, HTML_EDITOR_PIDFILE: PIDFILE },
  });
  child.unref();
  fs.writeFileSync(PIDFILE, String(child.pid));
  log(`started server pid=${child.pid} input=${input}`);

  for (let i = 0; i < 80; i += 1) {
    const res = await httpGet("/api/project");
    if (res && res.status === 200) return true;
    await sleep(250);
  }
  log("server did not become ready");
  return false;
}

async function currentDisplayFile() {
  const res = await httpGet("/api/file");
  if (!res || res.status !== 200) return null;
  try {
    return JSON.parse(res.body).displayPath || null;
  } catch {
    return null;
  }
}

async function switchToFile(file) {
  const res = await httpGet(`/api/file?path=${encodeURIComponent(file)}`, 8000);
  const ok = Boolean(res && res.status === 200);
  log(`switch to ${file} -> ${ok}`);
  return ok;
}

async function main() {
  const rawArg = process.argv[2];
  let requested = null;
  if (rawArg && /\.html?$/i.test(rawArg) && fs.existsSync(rawArg)) {
    requested = path.resolve(rawArg);
  } else if (rawArg) {
    log(`ignoring argument: ${rawArg}`);
  }

  const res = await httpGet("/api/project");
  const running = Boolean(res && res.status === 200);

  if (running) {
    log("server already running; reusing");
    if (requested) {
      const current = await currentDisplayFile();
      if (!current || path.resolve(current) !== requested) {
        const switched = await switchToFile(requested);
        if (!switched) {
          // Fall back to a clean restart bound to the requested file.
          for (const pid of pidsOnPort(PORT)) killPid(pid);
          cleanStalePidFile();
          await sleep(700);
          if (!(await startServer(requested))) {
            showMessage("HTML Editor failed to start. See logs\\launcher.log");
            return;
          }
        }
      }
    }
    openBrowser(URL);
    return;
  }

  cleanStalePidFile();
  const target = requested || resolveDefaultTarget();
  if (!(await startServer(target))) {
    showMessage("HTML Editor failed to start. See logs\\launcher.log");
    return;
  }
  openBrowser(URL);
}

main().catch((error) => {
  log(`fatal: ${error && error.stack ? error.stack : error}`);
  showMessage("HTML Editor failed to start. See logs\\launcher.log");
});
