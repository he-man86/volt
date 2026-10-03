# Probe helper (openspec `twincat-project-settings` 3.4): write the PLC project's three automation-interface compile
# options with ConsumeXml - the write path DIALECT D38 measured - and read them back. The live counterpart of the
# CODESYS probe `probe-codesys-compile-options.py`: with these set, the bridge's `Project Settings.projectsettings`
# and its build are TwinCAT's answers for the same settings.
#
# Run it against a FIXTURE copy only (ide.ps1 up -Vendor twincat -Instance <name>), never an engineer's project.
#   powershell -File packages/volt-cli/scripts/probe-tc-compile-options.ps1 -XaePid <pid> -Settings "<MaxWarnings>1</MaxWarnings>"
param(
    [Parameter(Mandatory = $true)] [int]$XaePid,
    [Parameter(Mandatory = $true)] [string]$Settings   # inner XML of IECProjectDef/CompilerSettings
)
$ErrorActionPreference = "Stop"
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;
public static class VoltRot {
    [DllImport("ole32.dll")] static extern int GetRunningObjectTable(int r, out IRunningObjectTable t);
    [DllImport("ole32.dll")] static extern int CreateBindCtx(int r, out IBindCtx c);
    public static object Find(string suffix) {
        IRunningObjectTable rot; GetRunningObjectTable(0, out rot);
        IEnumMoniker e; rot.EnumRunning(out e);
        var m = new IMoniker[1];
        while (e.Next(1, m, IntPtr.Zero) == 0) {
            IBindCtx ctx; CreateBindCtx(0, out ctx);
            string name; m[0].GetDisplayName(ctx, null, out name);
            if (name.EndsWith(suffix) && name.Contains("DTE")) { object o; rot.GetObject(m[0], out o); return o; }
        }
        return null;
    }
}
"@
$dte = [VoltRot]::Find(":$XaePid")
if ($null -eq $dte) { throw "no DTE in the ROT for XAE pid $XaePid" }
$sm = $dte.Solution.Projects.Item(1).Object
$root = $sm.LookupTreeItem("TIPC").Child(1).NestedProject
function Show([string]$when) {
    $cs = ([xml]$root.ProduceXml()).TreeItem.IECProjectDef.CompilerSettings
    Write-Host "$when ReplaceConstants=$($cs.ReplaceConstants) MaxWarnings=$($cs.MaxWarnings) CompilerDefines='$($cs.CompilerDefines)'"
}
Show "before"
$root.ConsumeXml("<TreeItem><IECProjectDef><CompilerSettings>$Settings</CompilerSettings></IECProjectDef></TreeItem>")
Show "after "
