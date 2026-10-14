import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import patches from './cli-pid-patch.js';

const cliFile = fileURLToPath(new URL('../app/node_modules/@deckflow/html-editor/cli.js', import.meta.url));
const entry = fileURLToPath(new URL('../app/node_modules/@deckflow/html-editor/bin/htmleditor.js', import.meta.url));

test('CLI owned PID patch is idempotent', () => {
  const source = readFileSync(cliFile, 'utf8');
  const patched = patches.applyCliPidPatch(source);
  assert.equal(patches.applyCliPidPatch(patched), patched);
  assert.ok(patched.includes('readFileSync(pidFile, "utf8").trim() === String(process.pid)'));
});

async function stoppedChild(replacePid) {
  const root = mkdtempSync(join(tmpdir(), 'html-editor-owned-pid-'));
  const pidFile = join(root, '.server.pid');
  const input = join(root, 'brief.html');
  writeFileSync(input, '<!doctype html><html><body><p>PID lifecycle fixture</p></body></html>');
  const child = spawn(process.execPath, [entry, input, '--port', '0', '--no-open'], {
    windowsHide: true,
    env: { ...process.env, HTML_EDITOR_PIDFILE: pidFile },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const exited = once(child, 'exit');
  let errors = '';
  child.stderr.on('data', (chunk) => { errors += chunk; });
  let expired = false;
  const timer = setTimeout(() => { expired = true; child.kill(); }, 10000);
  try {
    writeFileSync(pidFile, String(child.pid));
    const url = await new Promise((resolveUrl, reject) => {
      let output = '';
      child.on('error', reject);
      child.stdout.on('data', (chunk) => {
        output += chunk;
        const match = output.match(/Local HTML Editor: (http:\/\/127\.0\.0\.1:\d+)/);
        if (match) resolveUrl(match[1]);
      });
      child.on('exit', () => reject(new Error('CLI exited before ready: ' + errors)));
    });
    if (replacePid) writeFileSync(pidFile, 'new-server-pid');
    const response = await fetch(url + '/api/stop-editor', {
      method: 'POST',
      headers: { origin: url, referer: url + '/__local-editor__/', 'content-type': 'application/json', 'x-html-editor-action': 'stop' },
      body: '{}',
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).stopped, true);
    const [code] = await exited;
    assert.equal(expired, false, 'Stop must terminate its CLI process promptly');
    assert.equal(code, 0, errors);
    if (replacePid) assert.equal(readFileSync(pidFile, 'utf8'), 'new-server-pid');
    else assert.equal(existsSync(pidFile), false);
  } finally {
    clearTimeout(timer);
    if (child.exitCode === null) { child.kill(); await exited; }
    assert.ok(resolve(root).startsWith(resolve(tmpdir()) + '\\'));
    rmSync(root, { recursive: true, force: true });
  }
}

test('in-page stop exits CLI and removes its own PID', async () => stoppedChild(false));
test('exit does not remove a replacement process PID', async () => stoppedChild(true));
