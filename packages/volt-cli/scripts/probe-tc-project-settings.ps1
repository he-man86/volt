# Probe: WHERE TwinCAT keeps a PLC project's compiler settings (openspec twincat-project-settings, task 1.1).
#
# The CODESYS bridge materializes `Project Settings.projectsettings` from the language model's
# ConfigurationService (DIALECT C24). TwinCAT has no in-proc scripting host, so the worker can only reach what the
# automation interface (ITcSmTreeItem.ProduceXml) and the project files expose. This dumps, per PLC project:
#   - the PLC project item (TIPC^<name>, the "outer" node) ProduceXml;
#   - its NestedProject (the PLC project root, ITcPlcIECProject) ProduceXml;
# so a run BEFORE and AFTER changing a setting in the IDE (Properties -> Compile / Compiler warnings) can be diffed
# together with the .plcproj / .tsproj files.
#
# Read-only: nothing is written, nothing is saved.
#
#   powershell -File packages/volt-cli/scripts/ide.ps1 up -Vendor twincat -Fixture 14 -Instance twincat-project-settings -Wait
#   powershell -File packages/volt-cli/scripts/probe-tc-project-settings.ps1 -XaePid <pid> -Out <dir>
param(
    [Parameter(Mandatory = $true)] [int]$XaePid,
    [Parameter(Mandatory = $true)] [string]$Out
)
$ErrorActionPreference = "Stop"

# The DTE of THIS XAE, by pid, from the ROT: another workflow may run an XAE of its own, and GetActiveObject
# returns whichever registered first. TcXaeShell registers its DTE as `!TcXaeShell.DTE.15.0:<pid>`.
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
Write-Host "solution: $($dte.Solution.FullName)"
New-Item -ItemType Directory -Force $Out | Out-Null

$sm = $dte.Solution.Projects.Item(1).Object
$tipc = $sm.LookupTreeItem("TIPC")
for ($i = 1; $i -le $tipc.ChildCount; $i++) {
    $plc = $tipc.Child($i)
    $name = $plc.Name
    $plc.ProduceXml() | Set-Content -Encoding utf8 (Join-Path $Out "$name.plcitem.xml")
    $root = $plc.NestedProject
    $root.ProduceXml() | Set-Content -Encoding utf8 (Join-Path $Out "$name.nested.xml")
    Write-Host "  $name : item type $($plc.ItemType), nested '$($root.Name)' type $($root.ItemType)"

    # The automation interface's view (LIVE, includes unsaved edits): IECProjectDef/CompilerSettings.
    $cs = ([xml]$root.ProduceXml()).TreeItem.IECProjectDef.CompilerSettings
    Write-Host "    AI  CompilerSettings: ReplaceConstants=$($cs.ReplaceConstants) MaxWarnings=$($cs.MaxWarnings) CompilerDefines='$($cs.CompilerDefines)'"

    # The .plcproj's view (SAVED state only): PropertyGroup/CompilerDefines + the PlcProjectOptions XmlArchive,
    # whose OptionKeys hold name/value pairs as alternating <v> children of a `Values` hashtable.
    $path = ([xml]$plc.ProduceXml()).TreeItem.PlcProjectDef.ProjectPath
    [xml]$proj = Get-Content -Raw -Encoding UTF8 $path
    $ns = New-Object System.Xml.XmlNamespaceManager $proj.NameTable
    $ns.AddNamespace("m", "http://schemas.microsoft.com/developer/msbuild/2003")
    $defs = $proj.SelectSingleNode("//m:PropertyGroup/m:CompilerDefines", $ns)
    Write-Host "    FILE PropertyGroup/CompilerDefines: $(if ($defs) { "'" + $defs.InnerText + "'" } else { '(absent)' })"
    foreach ($o in $proj.SelectNodes("//m:PlcProjectOptions//m:o[m:d[@n='Values']/m:v]", $ns)) {
        $key = $o.SelectSingleNode("m:v[@n='Name']", $ns).InnerText
        $vals = @($o.SelectNodes("m:d[@n='Values']/m:v", $ns) | ForEach-Object { $_.InnerText })
        $pairs = for ($k = 0; $k -lt $vals.Count; $k += 2) {
            $v = $vals[$k + 1]; if ($v.Length -gt 40) { $v = $v.Substring(0, 40) + "..." }; "$($vals[$k])=$v"
        }
        Write-Host "    FILE option $key : $($pairs -join '; ')"
    }
}
