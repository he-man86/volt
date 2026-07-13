# Install/uninstall the Volt VS Code extension into every editor found (VS Code, Windsurf, Cursor, VSCodium).
# Called by the installer's NSIS (connector.nsh): install = sideload the bundled .vsix; uninstall = remove it.
# Best-effort per editor — a missing editor is skipped, a failed CLI doesn't abort the install.
param(
    [Parameter(Mandatory)][ValidateSet('install', 'uninstall')][string]$Action,
    [string]$Vsix
)
$EXT_ID = 'volt-ai.volt-vscode'

# Resolve an editor's CLI: known per-user/system paths first, then PATH.
function Resolve-Cli($command, $paths) {
    foreach ($p in $paths) { if ($p -and (Test-Path $p)) { return $p } }
    $c = Get-Command $command -ErrorAction SilentlyContinue
    if ($c) { return $c.Source }
    return $null
}

$editors = @(
    @{ name = 'VS Code';  cli = (Resolve-Cli 'code'     @("$env:LOCALAPPDATA\Programs\Microsoft VS Code\bin\code.cmd", "${env:ProgramFiles}\Microsoft VS Code\bin\code.cmd")) },
    @{ name = 'Windsurf'; cli = (Resolve-Cli 'windsurf' @("$env:LOCALAPPDATA\Programs\Windsurf\bin\windsurf.cmd")) },
    @{ name = 'Cursor';   cli = (Resolve-Cli 'cursor'   @("$env:LOCALAPPDATA\Programs\cursor\resources\app\bin\cursor.cmd")) },
    @{ name = 'VSCodium'; cli = (Resolve-Cli 'codium'   @("$env:LOCALAPPDATA\Programs\VSCodium\bin\codium.cmd")) }
)

foreach ($e in $editors) {
    if (-not $e.cli) { continue }
    try {
        if ($Action -eq 'install') {
            if (-not (Test-Path $Vsix)) { continue }
            & $e.cli --install-extension $Vsix --force 2>&1 | Out-Null
            "  [$($e.name)] extension installed"
        }
        else {
            & $e.cli --uninstall-extension $EXT_ID 2>&1 | Out-Null
            "  [$($e.name)] extension removed"
        }
    }
    catch { "  [$($e.name)] skipped: $($_.Exception.Message)" }
}
