$ErrorActionPreference = 'Stop'
$Tool = Split-Path -Parent $PSScriptRoot
$setupPath = Join-Path $PSScriptRoot 'setup.ps1'
$uninstallPath = Join-Path $PSScriptRoot 'uninstall.ps1'
foreach ($path in @($setupPath, $uninstallPath)) {
  $tokens = $null
  $errors = $null
  [Management.Automation.Language.Parser]::ParseFile($path, [ref]$tokens, [ref]$errors) | Out-Null
  if ($errors.Count) { throw ($errors | Out-String) }
}
$setup = Get-Content -LiteralPath $setupPath -Raw -Encoding UTF8
$sectionStart = $setup.IndexOf('# 5. Desktop launcher')
$sectionEnd = $setup.IndexOf('# 6. Explorer context menu', $sectionStart)
if ($sectionStart -lt 0 -or $sectionEnd -le $sectionStart) { throw 'Shortcut section missing' }
$section = $setup.Substring($sectionStart, $sectionEnd - $sectionStart)
$section = $section.Replace("`$desktop = [Environment]::GetFolderPath('Desktop')", '$desktop = $testDesktop')
$root = Join-Path ([IO.Path]::GetTempPath()) ('html-editor-shortcuts-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $root | Out-Null
$wscript = Join-Path $env:SystemRoot 'System32\wscript.exe'
$nodeExe = Join-Path $Tool 'node\node.exe'
$shortcutName = 'HTML Editor'
$stopShortcutName = 'HTML Editor - Stop'
function Step($message) {}
function Ok($message) {}
$shell = New-Object -ComObject WScript.Shell
try {
  foreach ($mode in @('fresh', 'upgrade', 'foreign')) {
    $testDesktop = Join-Path $root $mode
    New-Item -ItemType Directory -Path $testDesktop | Out-Null
    $old = Join-Path $testDesktop ($stopShortcutName + '.lnk')
    if ($mode -ne 'fresh') {
      $legacy = $shell.CreateShortcut($old)
      $legacy.TargetPath = $wscript
      $target = if ($mode -eq 'upgrade') { Join-Path $Tool 'stop.vbs' } else { Join-Path $root 'other-tool\stop.vbs' }
      $legacy.Arguments = '"' + $target + '"'
      $legacy.Save()
    }
    & ([scriptblock]::Create($section))
    $launch = Join-Path $testDesktop ($shortcutName + '.lnk')
    if (-not (Test-Path -LiteralPath $launch)) { throw "$mode missing launcher" }
    $link = $shell.CreateShortcut($launch)
    if ($link.Arguments -ne ('"' + (Join-Path $Tool 'start.vbs') + '"')) { throw "$mode incorrect launcher" }
    if ($mode -eq 'foreign') {
      if (-not (Test-Path -LiteralPath $old)) { throw 'Deleted another installation shortcut' }
    } elseif (Test-Path -LiteralPath $old) { throw "$mode still has Stop shortcut" }
    Write-Output "Shortcut regression passed: $mode"
  }
  $config = Get-Content -LiteralPath (Join-Path $Tool 'config.json') -Raw -Encoding UTF8 | ConvertFrom-Json
  if ($null -ne $config.stopShortcutName) { throw 'Obsolete Stop configuration present' }
  $welcome = Get-Content -LiteralPath (Join-Path $Tool 'workspace\welcome.html') -Raw -Encoding UTF8
  if ($welcome.Contains('HTML Editor - Stop')) { throw 'Obsolete in-page Stop reminder present' }
  Write-Output 'Setup/uninstall syntax and shortcut regression tests passed'
} finally {
  $resolved = [IO.Path]::GetFullPath($root)
  if ((Split-Path -Parent $resolved) -ne ([IO.Path]::GetTempPath().TrimEnd('\')) -or (Split-Path -Leaf $resolved) -notlike 'html-editor-shortcuts-*') { throw 'Unexpected cleanup target' }
  Remove-Item -LiteralPath $resolved -Recurse -Force
}
