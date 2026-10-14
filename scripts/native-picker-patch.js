"use strict";

const originalWindowsPicker = `    const dialogScript = kind === "directory"
      ? "Add-Type -AssemblyName System.Windows.Forms; $d=New-Object System.Windows.Forms.FolderBrowserDialog; $d.Description='Choose a folder containing HTML files'; if($d.ShowDialog() -eq 'OK'){[Console]::Write($d.SelectedPath)}"
      : "Add-Type -AssemblyName System.Windows.Forms; $d=New-Object System.Windows.Forms.OpenFileDialog; $d.Filter='HTML files (*.html)|*.html'; if($d.ShowDialog() -eq 'OK'){[Console]::Write($d.FileName)}";
    command = {
      file: "powershell.exe",
      args: ["-NoProfile", "-Command", dialogScript],
    };`;

const nativeCode = `using System; using System.Runtime.InteropServices;
public static class PickerWindow {
  delegate bool EnumProc(IntPtr h, IntPtr p);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc callback, IntPtr p);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr h, uint kind);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] static extern bool BringWindowToTop(IntPtr h);
  [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int command);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern bool AttachThreadInput(uint attach, uint attachTo, bool attachNow);
  [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags);
  [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr h, int index);
  public static bool Promote(IntPtr owner, uint processId) {
    bool found = false;
    EnumWindows((h, p) => {
      uint pid; GetWindowThreadProcessId(h, out pid);
      if (pid != processId || h == owner || !IsWindowVisible(h) || GetWindow(h, 4) != owner) return true;
      SetWindowPos(h, new IntPtr(-1), 0, 0, 0, 0, 0x0003);
      ShowWindow(h, 5);
      IntPtr foreground = GetForegroundWindow();
      uint foregroundPid;
      uint foregroundThread = GetWindowThreadProcessId(foreground, out foregroundPid);
      uint currentThread = GetCurrentThreadId();
      bool attached = foregroundThread != 0 && foregroundThread != currentThread && AttachThreadInput(currentThread, foregroundThread, true);
      try {
        BringWindowToTop(h);
        SetForegroundWindow(h);
      } finally {
        if (attached) AttachThreadInput(currentThread, foregroundThread, false);
      }
      found = GetForegroundWindow() == h && (GetWindowLong(h, -20) & 8) != 0;
      return false;
    }, IntPtr.Zero);
    return found;
  }
}`;

const patchedWindowsPicker = `    // html-editor-picker-dialog-v2
    const dialogScript = [
      "Add-Type -AssemblyName System.Windows.Forms",
      ${JSON.stringify("Add-Type -TypeDefinition '" + nativeCode + "'")},
      "$owner=New-Object System.Windows.Forms.Form",
      "$d=$null",
      "$promoter=$null",
      "try {",
      "$owner.ShowInTaskbar=$false",
      "$owner.TopMost=$true",
      "$owner.StartPosition='Manual'",
      "$owner.FormBorderStyle='None'",
      "$owner.Location=New-Object System.Drawing.Point(-32000,-32000)",
      "$owner.Size=New-Object System.Drawing.Size(1,1)",
      "$owner.Opacity=0",
      kind === "directory"
        ? "$d=New-Object System.Windows.Forms.FolderBrowserDialog; $d.Description='Choose a folder containing HTML files'"
        : "$d=New-Object System.Windows.Forms.OpenFileDialog; $d.Filter='HTML files (*.html)|*.html'",
      "$owner.Show()",
      "$owner.Activate()",
      "$promoter=New-Object System.Windows.Forms.Timer; $promoter.Interval=40; $promoter.Tag=@{Attempts=0; Successes=0}",
      "$promoter.Add_Tick({ $promoter.Tag.Attempts++; if([PickerWindow]::Promote($owner.Handle,[uint32]$PID)){$promoter.Tag.Successes++}else{$promoter.Tag.Successes=0}; if($promoter.Tag.Successes -ge 10 -or $promoter.Tag.Attempts -ge 50){$promoter.Stop()} }); $promoter.Start()",
      kind === "directory"
        ? "if($d.ShowDialog($owner) -eq 'OK'){[Console]::Write($d.SelectedPath)}"
        : "if($d.ShowDialog($owner) -eq 'OK'){[Console]::Write($d.FileName)}",
      "} finally { if($null -ne $promoter){$promoter.Stop(); $promoter.Dispose()}; if($null -ne $d){$d.Dispose()}; $owner.Dispose() }",
    ].join("; ");
    command = {
      file: "powershell.exe",
      args: ["-NoProfile", "-STA", "-Command", dialogScript],
    };`;

function applyNativePickerPatch(source) {
  const visibleConsole = 'execFile(file, args, { encoding: "utf-8" }';
  const hiddenConsole = 'execFile(file, args, { encoding: "utf-8", windowsHide: true }';
  if (source.includes(visibleConsole)) source = source.replace(visibleConsole, hiddenConsole);
  if (!source.includes(hiddenConsole)) throw new Error("native-picker-patch: execFile pattern not found");
  if (source.includes(patchedWindowsPicker)) return source;
  const marker = source.indexOf("    // html-editor-picker-dialog-v2");
  if (marker >= 0) {
    const end = source.indexOf("\n  } else {", marker);
    if (end > marker) return source.slice(0, marker) + patchedWindowsPicker + source.slice(end);
  }
  if (source.includes(originalWindowsPicker)) return source.replace(originalWindowsPicker, patchedWindowsPicker);
  const start = source.indexOf('    const dialogScript = [');
  const end = source.indexOf('\n  } else {', start);
  if (start >= 0 && end > start) {
    const previous = source.slice(start, end);
    if (previous.includes('$owner.TopMost=$true') && previous.includes('$d.ShowDialog($owner)') && !previous.includes('PickerWindow')) {
      return source.slice(0, start) + patchedWindowsPicker + source.slice(end);
    }
  }
  throw new Error("native-picker-patch: Windows picker pattern not found");
}

module.exports = { applyNativePickerPatch };
