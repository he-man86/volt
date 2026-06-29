# Add or remove a directory from the per-user PATH, idempotently. Called by the Volt CLI installer's NSIS
# (install = add, uninstall = remove). Avoids the duplicate-entry growth raw NSIS PATH editing is prone to.
param(
    [Parameter(Mandatory)][ValidateSet('add', 'remove')][string]$Action,
    [Parameter(Mandatory)][string]$Dir
)
$cur = [Environment]::GetEnvironmentVariable('Path', 'User')
$parts = @($cur -split ';' | Where-Object { $_ -and ($_ -ne $Dir) })
if ($Action -eq 'add') { $parts += $Dir }
[Environment]::SetEnvironmentVariable('Path', ($parts -join ';'), 'User')
