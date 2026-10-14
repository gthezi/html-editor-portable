param(
  [switch]$NoStart,
  [switch]$Force
)

$ErrorActionPreference = 'Stop'

$Tool = Split-Path -Parent $PSScriptRoot
$cfgPath = Join-Path $Tool 'config.json'
$cfg = Get-Content -LiteralPath $cfgPath -Encoding UTF8 -Raw | ConvertFrom-Json

$nodeVersion = $cfg.nodeVersion
$label = $cfg.contextMenuLabel
$shortcutName = $cfg.shortcutName
$stopShortcutName = if ($cfg.stopShortcutName) { $cfg.stopShortcutName } else { 'HTML Editor - Stop' }

$nodeDir = Join-Path $Tool 'node'
$nodeExe = Join-Path $nodeDir 'node.exe'
$npmCli = Join-Path $nodeDir 'node_modules\npm\bin\npm-cli.js'
$appDir = Join-Path $Tool 'app'
$scriptDir = Join-Path $Tool 'scripts'
$wscript = Join-Path $env:SystemRoot 'System32\wscript.exe'

function Step($message) { Write-Host ""; Write-Host "==> $message" -ForegroundColor Cyan }
function Ok($message) { Write-Host "    $message" -ForegroundColor Green }

Write-Host "HTML Editor setup" -ForegroundColor White
Write-Host "Tool folder: $Tool"

# 1. Portable Node runtime ---------------------------------------------------
Step "Checking Node runtime"
if ($Force -or -not (Test-Path $nodeExe) -or -not (Test-Path $npmCli)) {
  $zipName = "node-$nodeVersion-win-x64.zip"
  $url = "https://nodejs.org/dist/$nodeVersion/$zipName"
  $zip = Join-Path $env:TEMP $zipName
  Write-Host "    Downloading $url"

  if (Get-Command curl.exe -ErrorAction SilentlyContinue) {
    & curl.exe -sL -o $zip $url
  } else {
    Invoke-WebRequest -Uri $url -OutFile $zip -UseBasicParsing
  }
  if (-not (Test-Path $zip)) { throw "Node download failed: $url" }

  $tmp = Join-Path $env:TEMP ("html-editor-node-" + [guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Force -Path $tmp | Out-Null
  if (Get-Command tar.exe -ErrorAction SilentlyContinue) {
    & tar.exe -xf $zip -C $tmp
  } else {
    Expand-Archive -LiteralPath $zip -DestinationPath $tmp -Force
  }

  $extracted = Join-Path $tmp "node-$nodeVersion-win-x64"
  if (-not (Test-Path $extracted)) { throw "Unexpected Node archive layout" }
  if (Test-Path $nodeDir) { Remove-Item -LiteralPath $nodeDir -Recurse -Force }
  Move-Item -LiteralPath $extracted -Destination $nodeDir

  # Clean up only the temp folder we just created.
  if ($tmp.StartsWith([System.IO.Path]::GetTempPath()) -and (Split-Path -Leaf $tmp).StartsWith('html-editor-node-')) {
    Remove-Item -LiteralPath $tmp -Recurse -Force
  }
  Ok "Installed Node $nodeVersion"
} else {
  Ok "Node already present ($(& $nodeExe -v))"
}

# 2. Editor package ----------------------------------------------------------
Step "Checking the editor package"
$pkgDir = Join-Path $appDir 'node_modules\@deckflow\html-editor'
if ($Force -or -not (Test-Path $pkgDir)) {
  Push-Location $appDir
  try {
    & $nodeExe $npmCli ci --registry=https://registry.npmjs.org/ --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw "npm ci failed" }
  } finally {
    Pop-Location
  }
  Ok "Installed @deckflow/html-editor"
} else {
  Ok "Editor package already present"
}

# 3. Local patches ----------------------------------------------------------
Step "Applying local editor patches"
& $nodeExe (Join-Path $scriptDir 'patch-local.js')
if ($LASTEXITCODE -ne 0) { throw "Local editor patches failed" }

# 4. Default workspace page --------------------------------------------------
Step "Checking default workspace"
$workspace = Join-Path $Tool 'workspace'
New-Item -ItemType Directory -Force -Path $workspace | Out-Null
$welcome = Join-Path $workspace 'welcome.html'
if (-not (Test-Path $welcome)) {
  Write-Host "    welcome.html is missing; it should ship with the tool." -ForegroundColor Yellow
} else {
  Ok "Workspace ready"
}

# 5. Desktop launcher --------------------------------------------------------
Step "Creating desktop launcher"
$desktop = [Environment]::GetFolderPath('Desktop')
$shell = New-Object -ComObject WScript.Shell

function New-Lnk($lnkPath, $vbsName, $description) {
  $sc = $shell.CreateShortcut($lnkPath)
  $sc.TargetPath = $wscript
  $sc.Arguments = '"' + (Join-Path $Tool $vbsName) + '"'
  $sc.WorkingDirectory = $Tool
  $sc.IconLocation = "$nodeExe,0"
  $sc.Description = $description
  $sc.Save()
}

New-Lnk (Join-Path $desktop ($shortcutName + '.lnk')) 'start.vbs' 'Open the local HTML visual editor'
$legacyStopLink = [IO.Path]::GetFullPath((Join-Path $desktop ($stopShortcutName + '.lnk')))
if (Test-Path -LiteralPath $legacyStopLink) {
  $legacy = $shell.CreateShortcut($legacyStopLink)
  if ($legacy.TargetPath -ieq $wscript -and $legacy.Arguments -ieq ('"' + (Join-Path $Tool 'stop.vbs') + '"')) {
    Remove-Item -LiteralPath $legacyStopLink -Force
  }
}
Ok "Desktop: $shortcutName.lnk"

# 6. Explorer context menu (does not change the default program) -------------
Step "Registering Explorer context menu"
$base = 'HKCU:\Software\Classes\SystemFileAssociations\.html\shell\HtmlEditorEdit'
New-Item -Path $base -Force | Out-Null
Set-ItemProperty -Path $base -Name '(default)' -Value $label
New-ItemProperty -Path $base -Name 'Icon' -Value "$nodeExe,0" -PropertyType String -Force | Out-Null
$cmdKey = Join-Path $base 'command'
New-Item -Path $cmdKey -Force | Out-Null
$cmdValue = 'wscript.exe "' + (Join-Path $Tool 'open.vbs') + '" "%1"'
Set-ItemProperty -Path $cmdKey -Name '(default)' -Value $cmdValue
Ok "Right-click entry added for .html files"

Write-Host ""
Write-Host "Setup complete." -ForegroundColor Green

# 7. Optional immediate start ------------------------------------------------
if (-not $NoStart) {
  Step "Starting HTML Editor"
  Start-Process -FilePath $wscript -ArgumentList ('"' + (Join-Path $Tool 'start.vbs') + '"') -WindowStyle Hidden
  Ok "Launching; the browser will open shortly."
}
