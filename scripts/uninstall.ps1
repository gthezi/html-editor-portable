$ErrorActionPreference = 'Stop'

$Tool = Split-Path -Parent $PSScriptRoot
$cfg = Get-Content -LiteralPath (Join-Path $Tool 'config.json') -Encoding UTF8 -Raw | ConvertFrom-Json
$wscript = Join-Path $env:SystemRoot 'System32\wscript.exe'

Write-Host "Removing HTML Editor shortcuts and context menu..." -ForegroundColor Cyan

# Stop a running server first.
Start-Process -FilePath $wscript -ArgumentList ('"' + (Join-Path $Tool 'stop.vbs') + '"') -WindowStyle Hidden
Start-Sleep -Seconds 2

$desktop = [Environment]::GetFolderPath('Desktop')
$stopShortcutName = if ($cfg.stopShortcutName) { $cfg.stopShortcutName } else { 'HTML Editor - Stop' }
$shell = New-Object -ComObject WScript.Shell
foreach ($name in @($cfg.shortcutName, $stopShortcutName)) {
  $lnk = [IO.Path]::GetFullPath((Join-Path $desktop ($name + '.lnk')))
  if (Test-Path -LiteralPath $lnk) {
    $shortcut = $shell.CreateShortcut($lnk)
    $expectedVbs = if ($name -eq $cfg.shortcutName) { 'start.vbs' } else { 'stop.vbs' }
    if ($shortcut.TargetPath -ieq $wscript -and $shortcut.Arguments -ieq ('"' + (Join-Path $Tool $expectedVbs) + '"')) {
      Remove-Item -LiteralPath $lnk -Force
    }
  }
}

$base = 'HKCU:\Software\Classes\SystemFileAssociations\.html\shell\HtmlEditorEdit'
if (Test-Path $base) { Remove-Item -Path $base -Recurse -Force }

Write-Host "Done. Files under $Tool were left in place; delete the folder to remove them." -ForegroundColor Green
