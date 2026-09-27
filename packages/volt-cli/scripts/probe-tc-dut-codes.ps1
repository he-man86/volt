# Probe: which TREEITEMTYPE each DUT in a live TwinCAT PLC project carries RIGHT NOW.
#
# openspec `dut-subtype-on-the-wire` task 1.2. TwinCAT stores a DUT under four tree codes - 605 enum, 606 struct,
# 607 union, 623 alias (DIALECT C2b) - and the driver maps all four to the one DUT kind. The change turns a
# subtype edit into ONE in-place content update of the same object, so it has to know what the vendor does to the
# code when a 606 is handed an enum declaration: re-derive it (605), keep 606 with an enum body, or refuse.
#
# This probe only READS. The writes are made through the bridge (`volt push`, the path a user takes), and this is
# run between them. Every DUT whose name matches -Prefix is listed with its code, its parent folder and the head
# of its declaration, so a code and the shape it is supposed to name can be compared line by line.
#
# Run it against a FIXTURE (`ide.ps1 up -Vendor twincat -Fixture 14`), never an engineer's own project.
param([string]$Prefix = "VltM_")

$ErrorActionPreference = "Stop"

function Get-XaeDte {
    foreach ($p in @("TcXaeShell.DTE.15.0", "TcXaeShell.DTE", "VisualStudio.DTE.15.0")) {
        try { return [Runtime.InteropServices.Marshal]::GetActiveObject($p) } catch {}
    }
    throw "no running XAE - open the fixture solution in TcXaeShell first"
}

$codes = @{ 605 = "enum"; 606 = "struct"; 607 = "union"; 623 = "alias" }

$dte = Get-XaeDte
$sm = $dte.Solution.Projects.Item(1).Object
Write-Host "solution: $($dte.Solution.FullName)"
$root = $sm.LookupTreeItem("TIPC").Child(1).NestedProject

function Walk($node, [string]$path) {
    for ($i = 1; $i -le $node.ChildCount; $i++) {
        $c = $node.Child($i)
        $t = [int]$c.ItemType
        if ($t -eq 601) { Walk $c "$path/$($c.Name)"; continue }
        if ($codes.ContainsKey($t) -and $c.Name -like "$Prefix*") {
            # The declaration's first lines, so the code can be read against the shape. `ProduceXml` does NOT carry
            # it for a DUT (only PlcDutDef export flags) - `DeclarationText` is the COM property that does.
            $decl = (($c.DeclarationText -split "`n") | Where-Object { $_.Trim() } | Select-Object -First 3) -join " | "
            # The object's IDENTITY is the `Id` GUID in its .TcDUT file; the tree item exposes the path, not the Id.
            # Same Id before and after an edit = the same object was updated, not deleted and re-created.
            $x = [xml]$c.ProduceXml()
            $file = ($x.TreeItem.VSProperties.VSProperty | Where-Object { $_.Name -eq "FullPath" }).Value
            $id = if ($file -and (Test-Path $file)) { ([xml](Get-Content $file -Raw)).TcPlcObject.DUT.Id } else { "<no file: $file>" }
            "{0,-12} {1} ({2,-6}) {3} in '{4}'  decl: {5}" -f $c.Name, $t, $codes[$t], $id, $path.TrimStart('/'), $decl
        }
    }
}
Walk $root ""
