# Authors `VltFixtureMembers` INTO the TwinCAT fixture project a running XAE has open: an ST function block whose
# members Volt does not show (a CFC method, an SFC action) beside one it does (an ST method), so the live e2e can
# push the FB, its ST member and a hidden member's declaration and prove the hidden bodies are never written
# (openspec implementation-keyword 3b.1, `e2e/graphical/hidden-members.test.ts`). The CODESYS twin is
# `author-hidden-member-fixture.py`.
#
# WHY the IDE and not a file: Volt never creates a diagram, and a hand-written .TcPOU would be a shape Volt invented
# (`vendor-serialization-needs-identity-gate`). `CreateChild` accepts a diagram language (DIALECT D19), so the XAE
# writes every byte.
#
# Run against a FIXTURE copy served by `ide.ps1 up -Vendor twincat -Fixture 14`, then copy the new .TcPOU and the
# .plcproj entry back into `test/fixtures/TwinCAT Project14`. It saves the solution.
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName Microsoft.VisualBasic

function Get-XaeDte {
    foreach ($p in @("TcXaeShell.DTE.15.0", "TcXaeShell.DTE", "VisualStudio.DTE.15.0")) {
        try { return [Runtime.InteropServices.Marshal]::GetActiveObject($p) } catch {}
    }
    throw "no running XAE - open the fixture solution in TcXaeShell first"
}

# A tree item's declaration/implementation live on ITcPlcDeclaration / ITcPlcImplementation, not its default
# interface - PowerShell's late binding cannot reach them, CallByName can (`twincat-com-automation-traps`).
function Set-Text($item, [string]$prop, [string]$text) {
    [Microsoft.VisualBasic.Interaction]::CallByName($item, $prop, [Microsoft.VisualBasic.CallType]::Let, $text) | Out-Null
}

$name = "VltFixtureMembers"
$dte = Get-XaeDte
$sm = $dte.Solution.Projects.Item(1).Object
Write-Host "solution: $($dte.Solution.FullName)"
$root = $sm.LookupTreeItem("TIPC").Child(1).NestedProject
$pous = $null
for ($i = 1; $i -le $root.ChildCount; $i++) { if ($root.Child($i).Name -eq "POUs") { $pous = $root.Child($i) } }
if (-not $pous) { throw "no POUs folder under $($root.PathName)" }
for ($i = 1; $i -le $pous.ChildCount; $i++) { if ($pous.Child($i).Name -eq $name) { throw "$name already exists" } }

$fbPath = "$($pous.PathName)^$name"
$pous.CreateChild($name, 604, "", "ST") | Out-Null
$fb = $sm.LookupTreeItem($fbPath)
Set-Text $fb "DeclarationText" "FUNCTION_BLOCK $name`r`nVAR_INPUT`r`n`tbGo : BOOL;`r`nEND_VAR`r`nVAR`r`n`tnTick : INT;`r`nEND_VAR`r`n"
Set-Text $fb "ImplementationText" "nTick := nTick + 1;"
Write-Host "created $name (ST)"

$sm.LookupTreeItem($fbPath).CreateChild("Visible", 609, "", "ST") | Out-Null
$m = $sm.LookupTreeItem("$fbPath^Visible")
Set-Text $m "DeclarationText" "METHOD Visible : BOOL`r`nVAR_INPUT`r`n`tbIn : BOOL;`r`nEND_VAR`r`n"
Set-Text $m "ImplementationText" "Visible := bIn;"
Write-Host "created Visible (ST method)"

# A METHOD's vInfo is `[language, returnType]` - measured: a plain "CFC" string is taken and silently makes an ST
# method, an int or a one-element array is refused (DIALECT D19 measured only the POU, 602).
$sm.LookupTreeItem($fbPath).CreateChild("CfcStep", 609, "", [string[]]@("CFC", "BOOL")) | Out-Null
$c = $sm.LookupTreeItem("$fbPath^CfcStep")
Set-Text $c "DeclarationText" "METHOD CfcStep : BOOL`r`nVAR_INPUT`r`n`tbIn : BOOL;`r`nEND_VAR`r`n"
Write-Host "created CfcStep (CFC method)"

$sm.LookupTreeItem($fbPath).CreateChild("SfcRun", 608, "", "SFC") | Out-Null
Write-Host "created SfcRun (SFC action)"

$dte.Solution.SaveAs($dte.Solution.FullName)
$dte.ExecuteCommand("File.SaveAll")
Write-Host "saved"
