import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const { applyNativePickerPatch } = require("./native-picker-patch.js");
const installed = readFileSync(new URL("../app/node_modules/@deckflow/html-editor/nativeFilePicker.js", import.meta.url), "utf8");
const legacyWindowsPicker = `    const dialogScript = kind === "directory"
      ? "Add-Type -AssemblyName System.Windows.Forms; $d=New-Object System.Windows.Forms.FolderBrowserDialog; $d.Description='Choose a folder containing HTML files'; if($d.ShowDialog() -eq 'OK'){[Console]::Write($d.SelectedPath)}"
      : "Add-Type -AssemblyName System.Windows.Forms; $d=New-Object System.Windows.Forms.OpenFileDialog; $d.Filter='HTML files (*.html)|*.html'; if($d.ShowDialog() -eq 'OK'){[Console]::Write($d.FileName)}";
    command = {
      file: "powershell.exe",
      args: ["-NoProfile", "-Command", dialogScript],
    };`;
const installedClean = installed.replace(/\s*\/\/ html-editor-picker-dialog-v2\r?\n/g, "\n");
const start = installedClean.indexOf("    const dialogScript =");
const end = installedClean.indexOf("\n  } else {", start);
assert.ok(start !== -1 && end !== -1, "Windows picker branch exists");
const legacy = installedClean.slice(0, start) + legacyWindowsPicker + installedClean.slice(end);
const patched = applyNativePickerPatch(legacy);

function loadPicker(source, execFile = () => assert.fail("Unexpected native process")) {
  const context = vm.createContext({ execFile, process: { platform: "win32" } });
  vm.runInContext(source.replace('import { execFile } from "node:child_process";\n', "").replaceAll("export function ", "function "), context);
  return context;
}

async function capture(source, kind, platform, output = " C:\\picked ") {
  let command;
  const picker = loadPicker(source);
  const result = await picker[kind === "directory" ? "chooseLocalHtmlDirectory" : "chooseLocalHtmlFile"]({
    platform,
    execute: async (file, args) => { command = { file, args: Array.from(args) }; return output; },
  });
  return { ...command, result };
}

test("patch upgrades both upstream and windowsHide-only sources idempotently", () => {
  const upstream = legacy.replace(', windowsHide: true', "");
  assert.equal(applyNativePickerPatch(upstream), patched);
  assert.equal(applyNativePickerPatch(patched), patched);
  assert.equal(applyNativePickerPatch(installed), installed);
  assert.match(patched, /encoding: "utf-8", windowsHide: true/);
  assert.throws(() => applyNativePickerPatch("unexpected package"), /execFile pattern not found/);
  assert.throws(() => applyNativePickerPatch(legacy.replace("$d.ShowDialog()", "$d.OtherDialog()")), /Windows picker pattern not found/);
});

for (const kind of ["file", "directory"]) {
  test(`Windows ${kind} uses STA and a disposed invisible topmost owner`, async () => {
    const { file, args, result } = await capture(patched, kind, "win32");
    assert.equal(file, "powershell.exe");
    assert.deepEqual(args.slice(0, -1), ["-NoProfile", "-STA", "-Command"]);
    assert.equal(result, "C:\\picked");
    const script = args.at(-1);
    for (const token of ["$owner=New-Object System.Windows.Forms.Form", "$owner.ShowInTaskbar=$false", "$owner.TopMost=$true", "$owner.StartPosition='Manual'", "$owner.FormBorderStyle='None'", "$owner.Location=New-Object System.Drawing.Point(-32000,-32000)", "$owner.Size=New-Object System.Drawing.Size(1,1)", "$owner.Opacity=0", "$owner.Show()", "$owner.Activate()", "$d.ShowDialog($owner)", "if($null -ne $promoter){$promoter.Stop(); $promoter.Dispose()}", "if($null -ne $d){$d.Dispose()}; $owner.Dispose()", "[PickerWindow]::Promote($owner.Handle,[uint32]$PID)"]) {
      assert.ok(script.includes(token), token);
    }
    assert.ok(script.indexOf("try {") < script.indexOf("$owner.Show()"));
    assert.ok(script.indexOf("$owner.Show()") < script.indexOf("$owner.Activate()"));
    assert.ok(script.indexOf("$owner.Activate()") < script.indexOf("$d.ShowDialog($owner)"));
    assert.doesNotMatch(script, /\$d\.(TopMost|ShowInTaskbar|Opacity|StartPosition|FormBorderStyle)/);
    if (kind === "directory") {
      assert.match(script, /FolderBrowserDialog; \$d.Description='Choose a folder containing HTML files'/);
      assert.match(script, /\[Console\]::Write\(\$d.SelectedPath\)/);
      assert.doesNotMatch(script, /\$d\.(Filter|FileName)/);
    } else {
      assert.match(script, /OpenFileDialog; \$d.Filter='HTML files \(\*\.html\)\|\*\.html'/);
      assert.match(script, /\[Console\]::Write\(\$d.FileName\)/);
      assert.doesNotMatch(script, /\$d\.(Description|SelectedPath)/);
    }
    assert.equal((await capture(patched, kind, "win32", " \n ")).result, null);
  });

  for (const platform of ["darwin", "linux"]) {
    test(`${platform} ${kind} command is unchanged`, async () => {
      assert.deepEqual(await capture(patched, kind, platform), await capture(legacy, kind, platform));
    });
  }

  test(`${kind} preserves cancellation and unavailable errors`, async () => {
    const picker = loadPicker(patched);
    const choose = picker[kind === "directory" ? "chooseLocalHtmlDirectory" : "chooseLocalHtmlFile"];
    assert.equal(await choose({ execute: async () => { throw new Error("user cancelled"); } }), null);
    assert.equal(await choose({ execute: async () => { throw { stderr: "canceled" }; } }), null);
    const cause = new Error("native picker failure");
    await assert.rejects(choose({ execute: async () => { throw cause; } }), (error) => error.code === "PICKER_UNAVAILABLE" && error.cause === cause);
  });
}

test("default execute retains windowsHide", async () => {
  let invocation;
  const picker = loadPicker(patched, (file, args, options, callback) => {
    invocation = { file, args: Array.from(args), options: { ...options } };
    callback(null, " C:\\test.html \n", "");
  });
  assert.equal(await picker.chooseLocalHtmlFile(), "C:\\test.html");
  assert.equal(invocation.file, "powershell.exe");
  assert.ok(invocation.args.includes("-STA"));
  assert.deepEqual(invocation.options, { encoding: "utf-8", windowsHide: true });
});

// Opt-in native UI probe: enumerate and close only windows in its own child PID.
const probe = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class PickerProbe {
  delegate bool EnumProc(IntPtr h, IntPtr p);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc callback, IntPtr p);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr h, uint kind);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr h, int index);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out Rect rect);
  [DllImport("user32.dll")] static extern bool PostMessage(IntPtr h, uint message, IntPtr w, IntPtr l);
  [StructLayout(LayoutKind.Sequential)] struct Rect { public int Left, Top, Right, Bottom; }
  public static string InspectAndClose(IntPtr owner, int pid) {
    string result = null;
    EnumWindows((h, p) => {
      uint windowPid;
      GetWindowThreadProcessId(h, out windowPid);
      if (windowPid != pid || h == owner || !IsWindowVisible(h) || GetWindow(h, 4) != owner) return true;
      Rect r; GetWindowRect(h, out r);
      var screen = System.Windows.Forms.SystemInformation.VirtualScreen;
      bool onScreen = r.Right > screen.Left && r.Left < screen.Right && r.Bottom > screen.Top && r.Top < screen.Bottom;
      bool foreground = GetForegroundWindow() == h;
      bool topmost = (GetWindowLong(h, -20) & 8) != 0;
      Rect o; GetWindowRect(owner, out o);
      bool ownerOffscreen = o.Right <= screen.Left || o.Left >= screen.Right || o.Bottom <= screen.Top || o.Top >= screen.Bottom;
      result = "{\\"pid\\":" + pid + ",\\"foreground\\":" + foreground.ToString().ToLowerInvariant() + ",\\"topmost\\":" + topmost.ToString().ToLowerInvariant() + ",\\"owned\\":true,\\"onScreen\\":" + onScreen.ToString().ToLowerInvariant() + ",\\"ownerOffscreen\\":" + ownerOffscreen.ToString().ToLowerInvariant() + "}";
      PostMessage(h, 0x0010, IntPtr.Zero, IntPtr.Zero);
      return false;
    }, IntPtr.Zero);
    return result;
  }
}
'@ -ReferencedAssemblies System.Windows.Forms,System.Drawing
$timer=New-Object System.Windows.Forms.Timer
$timer.Interval=1200
$timer.Add_Tick({
  if($null -ne $owner) {
    $report=[PickerProbe]::InspectAndClose($owner.Handle,$PID)
    if($null -ne $report){$timer.Stop(); $result=$report | ConvertFrom-Json; $result | Add-Member -NotePropertyName promoterActive -NotePropertyValue $promoter.Enabled; [Console]::WriteLine(($result | ConvertTo-Json -Compress))}
  }
})
$timer.Start()
try {
`;

for (const kind of ["file", "directory"]) {
  test(`real Windows ${kind} dialog is foreground, topmost, owned and on screen`, {
    skip: process.platform !== "win32" || process.env.NATIVE_PICKER_UI_TEST !== "1",
    timeout: 25000,
  }, async () => {
    const { args } = await capture(patched, kind, "win32", "");
    const script = probe.replace('$timer.Start()', '') + args.at(-1).replace('$owner.Show()', '$owner.Show(); $timer.Start()') + "\n} finally { $timer.Stop(); $timer.Dispose() }";
    const child = spawnSync("powershell.exe", ["-NoProfile", "-STA", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")], {
      encoding: "utf8", windowsHide: true, timeout: 20000,
    });
    assert.ifError(child.error);
    assert.equal(child.status, 0, child.stderr);
    const report = JSON.parse(child.stdout.trim());
    assert.equal(report.owned, true);
    assert.equal(report.foreground, true, JSON.stringify(report));
    assert.equal(report.topmost, true, JSON.stringify(report));
    assert.equal(report.onScreen, true, JSON.stringify(report));
    assert.equal(report.ownerOffscreen, true, JSON.stringify(report));
    assert.equal(report.promoterActive, false, 'Stable dialogs must not keep stealing focus');
    console.log(`Native ${kind} verification: ${JSON.stringify(report)}`);
  });
}
