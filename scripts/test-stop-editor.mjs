import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import patches from "./stop-editor-patch.js";

const packageRoot = fileURLToPath(new URL("../app/node_modules/@deckflow/html-editor/", import.meta.url));
const root = mkdtempSync(join(tmpdir(), "html-editor-stop-api-"));
const installed = join(root, "editor");
cpSync(packageRoot, installed, { recursive: true });
symlinkSync(realpathSync(resolve(packageRoot, "../..")), join(root, "node_modules"), "junction");
for (const [relative, patch] of [
  ["server.js", patches.applyStopServerPatch],
  ["public/app.js", patches.applyStopAppPatch],
  ["public/index.html", patches.applyStopUiPatch],
  ["public/styles.css", patches.applyStopStylesPatch],
]) {
  const target = join(installed, relative);
  const original = readFileSync(target, "utf8");
  const patched = patch(original);
  assert.equal(patch(patched), patched, `${relative}: patch must be idempotent`);
  writeFileSync(target, patched);
}
const { createEditorServer, createProjectServer } = await import(pathToFileURL(join(installed, "server.js")));
const input = join(root, "brief.html");
writeFileSync(input, "<!doctype html><html><body><p>Stop test</p></body></html>");
const headers = (url) => ({
  "content-type": "application/json",
  "X-HTML-Editor-Action": "stop",
  origin: url,
  referer: `${url}/__local-editor__/`,
});
const rawRequest = (url, options) => new Promise((resolveRequest, reject) => {
  const req = request(url, options, (res) => {
    let body = "";
    res.setEncoding("utf8");
    res.on("data", (chunk) => { body += chunk; });
    res.on("end", () => resolveRequest({ status: res.statusCode, body }));
  });
  req.setTimeout(3_000, () => req.destroy(new Error("Stop API request timed out")));
  req.on("error", reject);
  req.end("{}");
});

try {
  await test("stop rejects wrong methods, origins, hosts, headers and non-editor pages", async () => {
    const server = await createEditorServer({ input, port: 0 });
    try {
      for (const method of ["GET", "PUT", "DELETE", "OPTIONS"]) {
        const response = await fetch(`${server.url}/api/stop-editor`, { method, headers: headers(server.url) });
        assert.equal(response.status, 405, method);
        assert.equal(response.headers.get("allow"), "POST");
      }
      const invalid = [
        { origin: "http://evil.example" },
        { origin: "null" },
        { origin: "" },
        { origin: `${server.url}/project.html` },
        { origin: `${server.url.replace("http://", "http://user@")}` },
        { "X-HTML-Editor-Action": "" },
        { "X-HTML-Editor-Action": "restart" },
        { "content-type": "text/plain" },
        { "content-type": "application/x-www-form-urlencoded" },
        { referer: `${server.url}/project-assets/brief.html` },
        { referer: `${server.url}/__local-editor__/app.js` },
        { referer: "" },
        { "sec-fetch-site": "cross-site" },
        { "sec-fetch-dest": "iframe" },
      ];
      for (const bad of invalid) {
        const response = await rawRequest(`${server.url}/api/stop-editor`, { method: "POST", headers: { ...headers(server.url), ...bad } });
        assert.equal(response.status, 403, JSON.stringify(bad));
      }
      for (const hostileHost of [
        `evil.example:${new URL(server.url).port}`,
        `user@127.0.0.1:${new URL(server.url).port}`,
        `127.0.0.1:${new URL(server.url).port}/ignored`,
        "[",
      ]) {
        const response = await rawRequest(`${server.url}/api/stop-editor`, {
          method: "POST",
          headers: { ...headers(server.url), host: hostileHost, origin: server.url, referer: `${server.url}/__local-editor__/` },
        });
        assert.equal(response.status, 403, hostileHost);
      }
      for (const body of ["bad json", "null", "[]"]) {
        const response = await fetch(`${server.url}/api/stop-editor`, { method: "POST", headers: headers(server.url), body });
        assert.equal(response.status, 400, body);
      }
      assert.equal((await fetch(`${server.url}/api/project`)).status, 200, "Rejected requests must not close server");
    } finally {
      await server.close();
    }
  });

  await test("project-only server does not expose stop endpoint", async () => {
    const server = await createProjectServer({ input, port: 0 });
    try {
      assert.equal((await fetch(`${server.url}/api/stop-editor`, { method: "POST", headers: headers(server.url), body: "{}" })).status, 404);
    } finally {
      await server.close();
    }
  });

  await test("an already-started write cannot mutate files after stop acknowledgement", { timeout: 6_000 }, async () => {
    const before = readFileSync(input);
    const server = await createEditorServer({ input, port: 0 });
    const body = JSON.stringify({
      path: "brief.html",
      patches: [{ target: { tagName: "p", selector: "p", originalText: "Stop test" }, operations: [{ type: "text-content", value: "Must not be written" }] }],
    });
    let delayed;
    const completed = new Promise((resolveResponse, reject) => {
      delayed = request(`${server.url}/api/patch-elements`, {
        method: "POST",
        headers: { "content-type": "application/json", "content-length": Buffer.byteLength(body) },
      }, (res) => {
        let result = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => { result += chunk; });
        res.on("end", () => resolveResponse({ status: res.statusCode, result }));
      });
      delayed.on("error", reject);
    });
    try {
      await new Promise((resolveWritten, reject) => delayed.write(body.slice(0, 20), (error) => error ? reject(error) : resolveWritten()));
      const stopped = await fetch(`${server.url}/api/stop-editor`, { method: "POST", headers: headers(server.url), body: "{}" });
      assert.deepEqual(await stopped.json(), { ok: true, stopped: true });
      delayed.end(body.slice(20));
      const response = await completed;
      assert.equal(response.status, 500);
      assert.match(response.result, /Editor is stopping/);
      assert.deepEqual(readFileSync(input), before);
    } finally {
      delayed.destroy();
      await server.close();
    }
  });

  await test("stop acknowledges then closes SSE, active sockets, watcher and listener within a bound", { timeout: 6_000 }, async () => {
    const server = await createEditorServer({ input, port: 0 });
    const sse = await fetch(`${server.url}/api/events`);
    const reader = sse.body.getReader();
    assert.match(new TextDecoder().decode((await reader.read()).value), /event: ready/);
    const socket = connect(Number(new URL(server.url).port), "127.0.0.1");
    const socketClosed = new Promise((resolveClosed, reject) => {
      socket.once("close", resolveClosed);
      socket.on("error", reject);
    });
    await new Promise((resolveConnected) => socket.once("connect", resolveConnected));
    socket.write("GET /api/project HTTP/1.1\r\nHost: 127.0.0.1\r\n");
    const start = Date.now();
    try {
      const response = await fetch(`${server.url}/api/stop-editor`, { method: "POST", headers: headers(server.url), body: "{}" });
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { ok: true, stopped: true });
      const first = server.close();
      assert.equal(server.close(), first, "close must return the same promise");
      await first;
      await socketClosed;
      while (!(await reader.read()).done) { /* Drain any buffered SSE message. */ }
      assert.ok(Date.now() - start < 3_000, "Active sockets must not hang shutdown");
      await assert.rejects(fetch(`${server.url}/api/project`));
      await server.close();
      writeFileSync(input, "<!doctype html><html><body><p>Watcher is closed</p></body></html>");
    } finally {
      socket.destroy();
      await reader.cancel();
      await server.close();
    }
  });
  console.log("Stop editor API and patch idempotence tests passed");
} finally {
  // root was created by this test and never points at an installed/user directory.
  assert.equal(dirname(root), realpathSync(tmpdir()));
  rmSync(root, { recursive: true, force: true });
}
