"use strict";

// Stops the background editor server started by launcher.js.

const fs = require("node:fs");
const path = require("node:path");
const { spawn, execFileSync } = require("node:child_process");

const TOOL = __dirname;
const PIDFILE = path.join(TOOL, ".server.pid");
const LOG = path.join(TOOL, "logs", "launcher.log");

function log(message) {
  try {
    fs.mkdirSync(path.dirname(LOG), { recursive: true });
    fs.appendFileSync(LOG, `[${new Date().toISOString()}] ${message}\n`);
  } catch {
    /* ignore */
  }
}

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(path.join(TOOL, "config.json"), "utf8"));
  } catch {
    return {};
  }
}

const PORT = Number(readConfig().port) || 4177;

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

function main() {
  const killed = new Set();

  try {
    if (fs.existsSync(PIDFILE)) {
      const pid = fs.readFileSync(PIDFILE, "utf8").trim();
      if (pid && killPid(pid)) killed.add(pid);
      fs.rmSync(PIDFILE);
    }
  } catch {
    /* ignore */
  }

  for (const pid of pidsOnPort(PORT)) {
    if (killPid(pid)) killed.add(pid);
  }

  log(killed.size ? `stopped pid(s): ${[...killed].join(", ")}` : "nothing to stop");
  showMessage(
    killed.size
      ? "HTML Editor 已停止。"
      : "HTML Editor 当前未在运行。",
  );
}

main();
