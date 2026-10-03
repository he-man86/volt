# Probe helper: SET compiler warnings to a requested state (-State Disabled = unchecked, Enabled = checked) in a live
# XAE's PLC project properties, then Save All - the IDE-side half of the twincat-project-settings measurement
# (DIALECT D37). Run probe-tc-project-settings.ps1 before and after, and diff the .plcproj.
#
# The click is a TOGGLE (the grid exposes no checkbox state, see below), so the script does not trust it: it reads
# the SAVED state from the .plcproj (DisabledWarningIds, D37) BEFORE, refuses a warning already in the requested
# state (a click would flip it the wrong way), and AFTER Save All reads the file again and fails by name for every
# warning whose saved state is not the requested one - a click that landed on another cell, a scaling the offset
# does not fit, or the vendor defect that does not persist clearing the LAST disabled id (D37). The page must hold
# no unsaved warning edits when this starts: the file is the only state it can read.
#
# Why a GUI driver at all: the warning list has NO automation-interface surface. ITcSmTreeItem.ProduceXml of the
# PLC project carries CompilerSettings (ReplaceConstants / MaxWarnings / CompilerDefines - writable with
# ConsumeXml, which is how those three were measured) but nothing about warnings, so the only way to make TwinCAT
# write its own representation is to click the box an engineer clicks.
#
# The traps, each of which cost a round:
#   - the page list ("Compile", "Compiler Warnings", ...) is WinForms buttons UIA reports as patternless panes:
#     BM_CLICK on their hwnd works;
#   - the warnings grid is a 3S TreeTableView. Its rows support Select (which scrolls the row into view) but the
#     checkbox cell is not togglable: SetValue is "not supported", Invoke does nothing, and POSTED mouse/space
#     messages are ignored. Only a REAL click (SendInput) toggles it, so this briefly takes the foreground and the
#     cursor and puts both back;
#   - the checkbox column sits 249px right of the grid's left edge at 125% scaling (120 DPI), the ONLY scaling
#     measured. The offset is scaled by the XAE window's DPI (GetDpiForWindow); whether that fits another scaling is
#     unmeasured, and the file read-back is what proves it did - a miss fails the run instead of reporting success;
#   - the row's rectangle comes from UIA after Select.
#
# Run it against a FIXTURE copy only (ide.ps1 up -Vendor twincat -Instance <name>), never an engineer's project.
#   powershell -File packages/volt-cli/scripts/probe-tc-project-settings-gui.ps1 -XaePid <pid> -Warnings C0371,C0033 -State Disabled
param(
    [Parameter(Mandatory = $true)] [int]$XaePid,
    [Parameter(Mandatory = $true)] [string[]]$Warnings,
    [Parameter(Mandatory = $true)] [ValidateSet("Disabled", "Enabled")] [string]$State,
    [string]$PlcProject = "",
    [int]$CheckboxOffsetAt120Dpi = 249
)
$ErrorActionPreference = "Stop"

Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;
public static class VoltProbe {
    [DllImport("ole32.dll")] static extern int GetRunningObjectTable(int r, out IRunningObjectTable t);
    [DllImport("ole32.dll")] static extern int CreateBindCtx(int r, out IBindCtx c);
    public static object Dte(string suffix) {
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
    [DllImport("user32.dll")] public static extern uint GetDpiForWindow(IntPtr h);
    [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
    [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
    [DllImport("user32.dll")] static extern bool GetCursorPos(out POINT p);
    [DllImport("user32.dll")] static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern void mouse_event(uint f, int x, int y, uint d, UIntPtr e);
    public static void RealClick(IntPtr win, int x, int y) {
        POINT old; GetCursorPos(out old); var prev = GetForegroundWindow();
        SetForegroundWindow(win); System.Threading.Thread.Sleep(300);
        if (GetForegroundWindow() != win) throw new InvalidOperationException("XAE did not take the foreground; nothing clicked");
        SetCursorPos(x, y); System.Threading.Thread.Sleep(100);
        mouse_event(2, 0, 0, 0, UIntPtr.Zero); mouse_event(4, 0, 0, 0, UIntPtr.Zero);
        System.Threading.Thread.Sleep(300);
        SetCursorPos(old.X, old.Y); SetForegroundWindow(prev);
    }
}
"@
$UIA = [System.Windows.Automation.AutomationElement]
$TS = [System.Windows.Automation.TreeScope]
$True_ = [System.Windows.Automation.Condition]::TrueCondition

$dte = [VoltProbe]::Dte(":$XaePid")
if ($null -eq $dte) { throw "no DTE in the ROT for XAE pid $XaePid" }
$root = $UIA::FromHandle((Get-Process -Id $XaePid).MainWindowHandle)
function ByName([string]$n) { @($root.FindAll($TS::Descendants, (New-Object System.Windows.Automation.PropertyCondition($UIA::NameProperty, $n)))) }

# 0. The SAVED disabled set (D37): the .plcproj's PlcProjectOptions XmlArchive, OptionKey {8F99A816-..}, value
#    DisabledWarningIds = bare ints joined by ','. No key, or no value, is nothing disabled.
$sm = $dte.Solution.Projects.Item(1).Object
$plcItem = if ($PlcProject) { $sm.LookupTreeItem("TIPC^$PlcProject") } else { $sm.LookupTreeItem("TIPC").Child(1) }
if (-not $PlcProject) { $PlcProject = $plcItem.Name }
$plcproj = ([xml]$plcItem.ProduceXml()).TreeItem.PlcProjectDef.ProjectPath
function SavedDisabled {
    [xml]$proj = Get-Content -Raw -Encoding UTF8 $plcproj
    $ns = New-Object System.Xml.XmlNamespaceManager $proj.NameTable
    $ns.AddNamespace("m", "http://schemas.microsoft.com/developer/msbuild/2003")
    $set = @()
    foreach ($o in $proj.SelectNodes("//m:PlcProjectOptions//m:o[m:d[@n='Values']/m:v]", $ns)) {
        if ($o.SelectSingleNode("m:v[@n='Name']", $ns).InnerText -ne "{8F99A816-E488-41E4-9FA3-846536012284}") { continue }
        $vals = @($o.SelectNodes("m:d[@n='Values']/m:v", $ns) | ForEach-Object { $_.InnerText })
        for ($k = 0; $k -lt $vals.Count; $k += 2) {
            if ($vals[$k] -eq "DisabledWarningIds" -and $vals[$k + 1]) {
                $set = @($vals[$k + 1].Split(",") | ForEach-Object { "C" + ([int]$_).ToString("D4") })
            }
        }
    }
    return , $set
}
$before = SavedDisabled
Write-Host "saved disabled before: $($before -join ', ')"
foreach ($w in $Warnings) {
    if (($before -contains $w) -eq ($State -eq "Disabled")) {
        throw "warning $w is already $State in the saved project; a click would flip it the other way - nothing clicked"
    }
}

# 1. Open the PLC project's property document: select "<plc> Project" in Solution Explorer, Project.Properties.
$node = (ByName "$PlcProject Project")[0]
if ($null -eq $node) { throw "no '$PlcProject Project' node in Solution Explorer" }
$node.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern).Select()
$dte.ExecuteCommand("Project.Properties"); Start-Sleep 3

# 2. The "Compiler Warnings" page.
$page = ByName "Compiler Warnings" | Where-Object { $_.Current.NativeWindowHandle -ne 0 } | Select-Object -First 1
if ($null -eq $page) { throw "no 'Compiler Warnings' page button" }
[void][VoltProbe]::SendMessage([IntPtr]$page.Current.NativeWindowHandle, 0x00F5, [IntPtr]::Zero, [IntPtr]::Zero)
Start-Sleep 2

# 3. Each warning: select its row (scrolls it into view), then a real click on its checkbox.
$hwnd = [IntPtr](Get-Process -Id $XaePid).MainWindowHandle
$dpi = [VoltProbe]::GetDpiForWindow($hwnd)
if ($dpi -eq 0) { throw "GetDpiForWindow answered 0 for the XAE window" }
$CheckboxOffset = [int][Math]::Round($CheckboxOffsetAt120Dpi * $dpi / 120.0)
Write-Host "window DPI $dpi -> checkbox offset ${CheckboxOffset}px (measured: 249px at 120 DPI only)"
foreach ($w in $Warnings) {
    $grid = (ByName "TreeTableView")[0]
    $row = @($grid.FindAll($TS::Descendants, $True_)) | Where-Object { $_.Current.Name.StartsWith("${w}:") } | Select-Object -First 1
    if ($null -eq $row) { throw "warning $w is not in this TwinCAT's list" }
    $row.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern).Select(); Start-Sleep 1
    $r = $row.Current.BoundingRectangle; $g = $grid.Current.BoundingRectangle
    if ($r.Y -lt $g.Y -or $r.Y + $r.Height -gt $g.Y + $g.Height) { throw "row $w did not scroll into view ($r in $g)" }
    [VoltProbe]::RealClick($hwnd, [int]($g.X + $CheckboxOffset), [int]($r.Y + $r.Height / 2))
    Write-Host "clicked $w (unverified until the saved file is read back)"
}

# 4. Persist, then verify against the SAVED file - the click is blind, the file is not.
$dte.ExecuteCommand("File.SaveAll"); Start-Sleep 3
$after = SavedDisabled
Write-Host "saved disabled after:  $($after -join ', ')"
$wrong = @($Warnings | Where-Object { ($after -contains $_) -ne ($State -eq "Disabled") })
if ($wrong.Count -gt 0) {
    $clearsAll = $State -eq "Enabled" -and @($before | Where-Object { $Warnings -notcontains $_ }).Count -eq 0
    $hint = if ($clearsAll) { " (this clears the LAST disabled id, which TwinCAT 4024.74 does not persist - DIALECT D37)" }
            else { " (the click may have missed: offset/scaling, or another cell)" }
    throw "saved state is not $State for: $($wrong -join ', ')$hint"
}
Write-Host "verified: $($Warnings -join ', ') $State in the saved .plcproj"
