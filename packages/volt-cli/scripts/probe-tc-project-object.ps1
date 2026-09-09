# Probe: WHAT IS `Solution.Projects.Item(i).Object`, and how do you tell a TwinCAT project from anything else?
#
# `FindTwinCatProject` adopts that object as the system manager. Its two escape hatches — the `obj.SystemManager`
# fallback and the `continue` that rejects a non-TwinCAT project — were both DEAD: `_sysManager = obj` is a
# dynamic-to-dynamic store, which the compiler emits as a bare field write with NO runtime-binder call, so the
# try/catch around it could never fire. The loop therefore adopted project #1's `.Object` whatever it was.
#
# The fix needs a POSITIVE test for "this object is an ITcSysManager", and the only member the driver ever calls
# on one is `LookupTreeItem`. So this measures exactly that, rather than assuming it:
#   - does a bogus path THROW (fine — the member exists and answered) or hang / open a dialog (not usable)?
#   - what does asking for a member the object does NOT have raise, and is it distinguishable?
#   - is there a `SystemManager` property on the project object in this host (the full-VS shape the dead
#     fallback was written for)?
#
# Read-only throughout: no path this looks up exists, and nothing is written.
#
#   pwsh packages/volt-cli/scripts/ide.ps1 up -Vendor twincat -Which 14
#   pwsh packages/volt-cli/scripts/probe-tc-project-object.ps1

$ErrorActionPreference = "Continue"

function Get-XaeDte {
    foreach ($p in @("TcXaeShell.DTE.15.0", "TcXaeShell.DTE", "VisualStudio.DTE.15.0")) {
        try { return [Runtime.InteropServices.Marshal]::GetActiveObject($p) } catch {}
    }
    throw "no running XAE - open the fixture solution in TcXaeShell first"
}

# What a call RAISED, in one line — the exception type plus the HRESULT, because that is the whole question:
# a missing MEMBER and a bad ARGUMENT have to be tellable apart from C#.
function Try-Call([scriptblock]$b) {
    try { $v = & $b; return "ok -> " + $(if ($null -eq $v) { "(null)" } else { $v.GetType().FullName }) }
    catch {
        $e = $_.Exception
        while ($e.InnerException) { $e = $e.InnerException }
        $hr = ""
        if ($e -is [Runtime.InteropServices.COMException]) { $hr = " hr=0x{0:X8}" -f $e.HResult }
        return "$($e.GetType().FullName)$hr : $($e.Message.Split([char]10)[0])"
    }
}

$dte = Get-XaeDte
Write-Host "solution: $($dte.Solution.FullName)"
$count = $dte.Solution.Projects.Count
Write-Host "projects: $count`n"

for ($i = 1; $i -le $count; $i++) {
    $proj = $dte.Solution.Projects.Item($i)
    Write-Host "--- project #$i"
    Write-Host "  Name     : $(Try-Call { $proj.Name })  = $($proj.Name)"
    Write-Host "  FullName : $(Try-Call { $proj.FullName })  = $($proj.FullName)"
    Write-Host "  Kind     : $($proj.Kind)"

    $obj = $proj.Object
    if ($null -eq $obj) { Write-Host "  .Object  : NULL"; continue }
    Write-Host "  .Object  : $($obj.GetType().FullName)"

    # The full-VS shape the dead fallback was written for. On TcXaeShell `.Object` IS the manager, so this is
    # expected to fail here — what matters is HOW it fails.
    Write-Host "  .SystemManager        : $(Try-Call { $obj.SystemManager })"
    # A member that certainly does not exist — the control for the line above.
    Write-Host "  .VoltNotAMember       : $(Try-Call { $obj.VoltNotAMember })"
    # THE PROBE ITSELF. A path that cannot resolve: the member exists and refuses, or the member is absent.
    Write-Host "  LookupTreeItem(bogus) : $(Try-Call { $obj.LookupTreeItem('VOLT^PROBE^NO^SUCH^PATH') })"
    Write-Host "  LookupTreeItem('')    : $(Try-Call { $obj.LookupTreeItem('') })"
}
