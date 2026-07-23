<#
.SYNOPSIS
  Clean-slate reinstall of the Volt VS Code extension across every local editor.

.DESCRIPTION
  Dev/test loop hygiene. Each build sideloads a NEW versioned extension folder
  (volt-vscode-0.0.<count>), and an interrupted install or an un-awaited LSP
  shutdown leaves the old server running as a ZOMBIE that serves stale results
  and survives window reloads. This script gives you a known-good state:

    1. kills every running Volt lsp-server process (the zombies)
    2. builds a fresh .vsix (aborts here on failure -- before any destruction)
    3. per editor, ONLY if its CLI is on PATH: removes ALL installed versions,
       then installs the fresh .vsix

  An editor whose CLI is not on PATH is left untouched (we never purge what we
  can't reinstall). Run it, then fully QUIT and reopen the editor (not just reload).

  Usage:  pwsh packages/volt-vscode/scripts/reinstall-dev.ps1
          pwsh packages/volt-vscode/scripts/reinstall-dev.ps1 -NoBuild   # reuse existing .vsix
#>
param([switch]$NoBuild)

$ErrorActionPreference = 'Stop'
$pkg = Split-Path -Parent $PSScriptRoot   # packages/volt-vscode
$extId = 'volt-ai.volt-vscode'

# Editors as (extensions dir -> CLI command) pairs, so purge and install always cover the SAME set: an editor
# is never purged unless it can also be reinstalled.
$editors = @(
  @{ Dir = '.vscode';          Cli = 'code' }
  @{ Dir = '.vscode-insiders'; Cli = 'code-insiders' }
  @{ Dir = '.vscode-oss';      Cli = 'codium' }
  @{ Dir = '.cursor';          Cli = 'cursor' }
  @{ Dir = '.windsurf';        Cli = 'windsurf' }
  @{ Dir = '.windsurf-next';   Cli = 'windsurf-next' }
)

# A running editor holds file locks on its extension folders, so the purge below half-completes silently.
# Warn (don't hard-fail -- killing the user's editor is worse) so a stale folder that couldn't be removed is
# explainable rather than mysterious.
$running = Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -match '^(Code|Code - Insiders|Cursor|Windsurf|VSCodium|Codium)$' }
if ($running) {
  Write-Warning ("These editors are running and may keep locked extension folders: {0}. Close them for a full purge." -f (($running.ProcessName | Sort-Object -Unique) -join ', '))
}

# 1 - kill running Volt language servers (orphans included). Match the extension path specifically ('volt-vscode',
# not bare 'volt') so an unrelated lsp-server.js run from within the repo isn't caught. Collect first, then count
# off the array -- `$n++` inside ForEach-Object writes to the pipeline child scope and would always report 0.
$servers = @(Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'lsp-server\.js' -and $_.CommandLine -match 'volt-vscode' })
foreach ($p in $servers) {
  Write-Host "  killing lsp-server pid $($p.ProcessId)"
  Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
}
Write-Host "killed $($servers.Count) lsp-server process(es)"

# 2 - build FIRST, so a build failure aborts before anything is purged. A native command's non-zero exit does
# NOT trip $ErrorActionPreference, so check $LASTEXITCODE explicitly -- else a failed build silently falls
# through to installing a stale .vsix.
if (-not $NoBuild) {
  Write-Host "building .vsix ..."
  Push-Location $pkg
  try {
    & bun run package
    if ($LASTEXITCODE -ne 0) { throw "'bun run package' failed (exit $LASTEXITCODE)" }
  } finally { Pop-Location }
}
$vsix = Get-ChildItem $pkg -Filter '*.vsix' | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if ($null -eq $vsix) { throw "no .vsix found in $pkg - run without -NoBuild" }
Write-Host "installing $($vsix.Name)"

# 3 - per editor, CLI-gated: purge all versions then install fresh. Skip (don't purge) editors with no CLI.
foreach ($ed in $editors) {
  $cli = Get-Command $ed.Cli -ErrorAction SilentlyContinue
  $extRoot = Join-Path $env:USERPROFILE "$($ed.Dir)\extensions"
  $installed = @()
  if (Test-Path $extRoot) {
    $installed = @(Get-ChildItem $extRoot -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -match [regex]::Escape($extId) })
  }
  if ($null -eq $cli) {
    if ($installed.Count -gt 0) {
      Write-Warning "Volt extension is installed under $($ed.Dir) but '$($ed.Cli)' is not on PATH - skipping (won't purge what can't be reinstalled)."
    }
    continue
  }

  foreach ($d in $installed) {
    Remove-Item $d.FullName -Recurse -Force -ErrorAction SilentlyContinue
    Write-Host "  removed $($ed.Dir)/$($d.Name)"
  }
  # Drop the stale .obsolete marker so the editor doesn't warn about the removed versions on next start.
  $obsolete = Join-Path $extRoot '.obsolete'
  if (Test-Path $obsolete) { Remove-Item $obsolete -Force -ErrorAction SilentlyContinue }

  Write-Host "  -> $($ed.Cli) --install-extension"
  # The editor CLIs write node deprecation warnings to stderr even on success. Under
  # $ErrorActionPreference='Stop' that surfaces as a terminating NativeCommandError and ABORTS the whole script
  # mid-loop -- which is how a run once purged VS Code, installed it, and then never reached Windsurf, leaving it
  # on six stale versions. Relax it around the native call only; $LASTEXITCODE is the real success signal.
  $prev = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try { & $cli.Source --install-extension $vsix.FullName --force } finally { $ErrorActionPreference = $prev }
  if ($LASTEXITCODE -ne 0) { Write-Warning "install into $($ed.Cli) failed (exit $LASTEXITCODE)" }
}

Write-Host "`nDone. QUIT and reopen your editor (a window reload is not enough for a version swap)."
