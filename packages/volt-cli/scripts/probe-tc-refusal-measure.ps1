# Probe: three TwinCAT vendor facts the bridge refuses on without having measured them (openspec
# bridge-refusal-review 3.1, 3.3/3.4, 3.9). Each phase asks the IDE directly, through the COM calls TcObjectModel makes,
# on a FIXTURE COPY, and logs what came back.
#
#   names    (3.1) CreateChild with every non-identifier name SHAPE - non-ASCII letters, a leading digit, every
#                  ASCII punctuation mark a member line can carry, Unicode spaces, backtick-quoted names - as a POU
#                  (604) and as METHOD (609) / ACTION (608) / PROPERTY (611) of an FB. Created (read back the NAME),
#                  or refused (the COM message)? `StReader.IsIdentifier` refuses all of these before the IDE is asked.
#   language (3.3/3.4) An existing body changing language in place: ST text assigned to an FBD POU's
#                  ImplementationText, and an FBD POU's NWL archive assigned to an ST POU's. Read back the
#                  implementation (still an archive? the text?) and BUILD, so "taken" means the compiler took it.
#   priority (3.9) `TcTaskSchedule.SysTaskPatch` parses `Priority:` as a whole number only to keep its XML patch
#                  well-formed. With the value XML-ESCAPED instead, would TwinCAT's own ConsumeXml + the read-back
#                  decide? Each value is written to the system task, read back (TaskDef and every Context copy) and
#                  the original restored.
#
#   powershell -File scripts/ide.ps1 up -Vendor twincat -Instance bridge-refusal-review -Fixture 14 -Wait
#   powershell -File scripts/probe-tc-refusal-measure.ps1 -Phase names|language|priority
#
# The DTE is taken from the Running Object Table by THIS instance's XAE pid (several XAE windows may be open), never by
# GetActiveObject. Writes go straight through COM; everything the probe creates is deleted again. ASCII only.
param([Parameter(Mandatory)] [ValidateSet("names", "language", "priority")] [string]$Phase,
      [string]$Instance = "bridge-refusal-review",
      [string]$Log = "")
$ErrorActionPreference = "Stop"
if (-not $Log) { $Log = Join-Path $PSScriptRoot "tc-refusal-measure-$Phase.log" }
Set-Content -Path $Log -Value "probe-tc-refusal-measure.ps1 -Phase $Phase - $(Get-Date -Format 'yyyy-MM-dd HH:mm')" -Encoding UTF8
function Out([string]$s) { Add-Content -Path $Log -Value $s -Encoding UTF8; Write-Host $s }

Add-Type -TypeDefinition @"
using System; using System.Runtime.InteropServices; using System.Runtime.InteropServices.ComTypes;
public static class VoltRot2 {
  [DllImport("ole32.dll")] static extern int GetRunningObjectTable(int r, out IRunningObjectTable t);
  [DllImport("ole32.dll")] static extern int CreateBindCtx(int r, out IBindCtx c);
  public static object Get(string name) {
    IRunningObjectTable rot; GetRunningObjectTable(0, out rot); IEnumMoniker e; rot.EnumRunning(out e);
    var m = new IMoniker[1];
    while (e.Next(1, m, IntPtr.Zero) == 0) { IBindCtx c; CreateBindCtx(0, out c); string n; m[0].GetDisplayName(c, null, out n);
      if (n == name) { object o; rot.GetObject(m[0], out o); return o; } }
    return null; }
}
"@
$mine = @(Get-CimInstance Win32_Process -Filter "Name='TcXaeShell.exe'" | Where-Object { $_.CommandLine -like "*volt-ide-twincat-$Instance*" })
if ($mine.Count -ne 1) { throw "expected exactly one TcXaeShell on the $Instance copy, found $($mine.Count)" }
$dte = [VoltRot2]::Get("!TcXaeShell.DTE.15.0:$($mine[0].ProcessId)")
if (-not $dte) { throw "XAE $($mine[0].ProcessId) has no DTE in the ROT" }
if ($dte.Solution.FullName -notlike "*volt-ide-twincat-$Instance*") { throw "not the $Instance fixture copy: $($dte.Solution.FullName)" }
Out "XAE pid $($mine[0].ProcessId): $($dte.Solution.FullName)"
$sm = $dte.Solution.Projects.Item(1).Object
$plc = $sm.LookupTreeItem("TIPC").Child(1)
$root = $plc.NestedProject
# RE-RESOLVED on every use: a TwinCAT tree item is invalidated by a mutation under it (the first run created three
# FBs through one handle, after which every CreateChild on it answered "Cannot create child on this Node!").
function PlcRoot { return ,$sm.LookupTreeItem("TIPC").Child(1).NestedProject }
$M = [Type]::Missing

function Child($node, [string]$name) {
    for ($i = 1; $i -le $node.ChildCount; $i++) { $c = $node.Child($i); if ($c.Name -eq $name) { return ,$c } }
    return $null
}
# An if-EXPRESSION hands back the one-element array `return ,$x` makes, and a method called on that array is not the
# item's method: CreateChild through it answered "Cannot create child on this Node!" for every POU (measured on the
# first runs - the same call on the item itself succeeds). Unwrapped here.
function Single($x) { if ($x -is [object[]]) { return ,$x[0] } return ,$x }
function Esc([string]$s) {
    -join ($s.ToCharArray() | ForEach-Object { if ([int]$_ -lt 32 -or [int]$_ -gt 126) { '\u{0:x4}' -f [int]$_ } else { $_ } })
}
function FirstLine([string]$s) { ($s -split "`r?`n" | Where-Object { $_.Trim() } | Select-Object -First 1) }
# THE BRIDGE'S OWN BUILD (the `build` op over this instance's pipe): what Volt reports for the project, diagnostics with
# their messages. SolutionBuild.Build(true) through this DTE returns LastBuildInfo but leaves every Output pane empty
# out of process (measured on the first runs), so it could say THAT a build failed and never WHY.
function Build([string]$match) {
    $pipe = "volt.bridge.twincat.$($mine[0].ProcessId)"
    $cli = (Resolve-Path (Join-Path $PSScriptRoot "../test/e2e/lib/pipe.ts")).Path -replace "\\", "/"
    $js = "import { callOn } from '$cli'; const r: any = await Promise.race([callOn('$pipe', 'build', {}), " +
          "new Promise((_, j) => setTimeout(() => j(new Error('build timed out after 600 s')), 600000))]); " +
          "const d = (r.diagnostics ?? []).filter((x: any) => /$match/.test(JSON.stringify(x))); " +
          "console.log('build: success=' + r.success + ', ' + (r.diagnostics ?? []).length + ' diagnostic(s), ' + d.length + ' naming /$match/'); " +
          "for (const x of d) console.log('  ' + JSON.stringify(x));"
    $outp = & bun -e $js 2>&1
    $outp | ForEach-Object { Out "   $_" }
}

switch ($Phase) {
    "names" {
        $u = { param([int[]]$cps) -join ($cps | ForEach-Object { [char]$_ }) }
        $names = [ordered]@{
            "control Run" = "Run"; "control _lead" = "_lead"; "control Trail_" = "Trail_"
            "latin-1 Foo-umlaut" = "F" + (& $u 0xf6, 0xf6) + "bar"; "latin-1 capital U-umlaut" = (& $u 0xdc) + "nit"
            "cyrillic" = (& $u 0x41f, 0x440, 0x438); "greek" = (& $u 0x3b1, 0x3b2); "cjk" = (& $u 0x540d, 0x524d)
            "arabic-indic digit" = "a" + (& $u 0x663)
            "leading digit" = "2Fast"; "hyphen" = "My-Name"; "dot" = "a.b"; "dollar" = 'a$b'; "hash" = "a#b"; "at" = "@ab"
            "plus" = "a+b"; "slash" = "a/b"; "backslash" = "a\b"; "quote" = "a'b"; "dquote" = 'a"b'; "percent" = "a%b"
            "ampersand" = "a&b"; "paren" = "a(b"; "bracket" = "a[b"; "brace" = "a{b"; "semicolon" = "a;b"; "comma" = "a,b"
            "equals" = "a=b"; "star" = "a*b"; "bang" = "a!b"; "question" = "a?b"; "caret" = "a^b"; "tilde" = "a~b"
            "pipe" = "a|b"; "lt" = "a<b"; "no-break space" = "a" + (& $u 0xa0) + "b"; "zero-width space" = "a" + (& $u 0x200b) + "b"
            "lone underscore" = "_"; "double underscore" = "a__b"
            "backtick ab" = '`ab`'; "backtick a-b" = '`a-b`'; "backtick 2Fast" = '`2Fast`'; "backtick a b" = '`a b`'
            "backtick INT" = '`INT`'; "backtick unbalanced" = '`ab'; "backtick inside" = 'a`b'
        }
        $fbs = @{}
        foreach ($k in @("method", "action", "property")) {
            $n = "VltIdFb_$k"
            $old = Child (PlcRoot) $n; if ($old) { (PlcRoot).DeleteChild($n) }
            $fb = (PlcRoot).CreateChild($n, 604, "", "ST")
            $fb.DeclarationText = "FUNCTION_BLOCK $n`nVAR`nEND_VAR`n"
            $fbs[$k] = $n
        }
        # And an INTERFACE per interface-member kind (vInfo: null for the interface, the TYPE for its members, as
        # TcObjectModel.CreateChild passes them).
        foreach ($k in @("itf_method", "itf_property")) {
            $n = "VltIdItf_$k"
            $old = Child (PlcRoot) $n; if ($old) { (PlcRoot).DeleteChild($n) }
            [void](PlcRoot).CreateChild($n, 618, "", $null)
            $fbs[$k] = $n
        }
        $kinds = [ordered]@{ pou = 604; method = 609; action = 608; property = 611; itf_method = 610; itf_property = 612 }
        foreach ($label in $names.Keys) {
            $name = $names[$label]
            Out "== $label   ($(Esc $name))"
            foreach ($kind in $kinds.Keys) {
                $parentName = if ($kind -eq "pou") { $null } else { $fbs[$kind] }
                $parent = Single $(if ($parentName) { Child (PlcRoot) $parentName } else { PlcRoot })
                try {
                    $vinfo = if ($kind -like "itf_*") { "INT" } else { "ST" }
                    $c = $parent.CreateChild($name, $kinds[$kind], "", $vinfo)
                    $got = [string]$c.Name
                    Out ("   {0,-12} CREATED as {1}{2}" -f $kind, (Esc $got), $(if ($got -ceq $name) { "" } else { "   <-- NOT the name asked" }))
                    # Re-looked-up: a TwinCAT tree item is invalidated by a mutation under it.
                    $p2 = Single $(if ($parentName) { Child (PlcRoot) $parentName } else { PlcRoot })
                    try { $p2.DeleteChild($got) } catch { Out ("   {0,-12} delete failed: {1}" -f $kind, $_.Exception.Message) }
                } catch {
                    Out ("   {0,-12} REFUSED: {1}" -f $kind, (Esc (FirstLine $_.Exception.Message)))
                }
            }
        }
        foreach ($k in $fbs.Keys) { try { (PlcRoot).DeleteChild($fbs[$k]) } catch {} }
    }
    "language" {
        $decl = "PROGRAM {0}`nVAR`n`ta : BOOL := TRUE;`n`tq : BOOL;`nEND_VAR`n"
        foreach ($n in @("VltLc_Fbd", "VltLc_St", "VltLc_Donor")) { $old = Child (PlcRoot) $n; if ($old) { (PlcRoot).DeleteChild($n) } }
        $fbd = (PlcRoot).CreateChild("VltLc_Fbd", 604, "", "FBD"); $fbd.DeclarationText = ($decl -f "VltLc_Fbd")
        $donor = (PlcRoot).CreateChild("VltLc_Donor", 604, "", "FBD"); $donor.DeclarationText = ($decl -f "VltLc_Donor")
        $st = (PlcRoot).CreateChild("VltLc_St", 604, "", "ST"); $st.DeclarationText = ($decl -f "VltLc_St"); $st.ImplementationText = "q := a;`n"
        Out "--- baseline: the fixture with the three new POUs, nothing changed yet ---"
        Build "VltLc_"
        $archive = [string](Child (PlcRoot) "VltLc_Donor").ImplementationText
        Out "FBD POU as created: implementation starts '$((Esc $archive).Substring(0, [Math]::Min(80, $archive.Length)))'"

        Out ""
        Out "--- 3.3: ST text assigned to the FBD POU's ImplementationText ---"
        try { (Child (PlcRoot) "VltLc_Fbd").ImplementationText = "q := NOT a;`n"; Out "   assignment: taken" }
        catch { Out "   assignment: REFUSED: $(Esc (FirstLine $_.Exception.Message))" }
        $back = [string](Child (PlcRoot) "VltLc_Fbd").ImplementationText
        Out "   read back: '$(Esc ($back.Substring(0, [Math]::Min(120, $back.Length))))'"

        Out ""
        Out "--- 3.4: the donor's NWL archive assigned to the ST POU's ImplementationText ---"
        try { (Child (PlcRoot) "VltLc_St").ImplementationText = $archive; Out "   assignment: taken" }
        catch { Out "   assignment: REFUSED: $(Esc (FirstLine $_.Exception.Message))" }
        $back = [string](Child (PlcRoot) "VltLc_St").ImplementationText
        Out "   read back: '$(Esc ($back.Substring(0, [Math]::Min(120, $back.Length))))'"
        $same = ($back -replace "`r", "") -eq ($archive -replace "`r", "")
        Out "   read back equals the archive (line ends normalized): $same"

        Out ""
        Out "--- build (the PLC task calls nothing of these; MAIN gets the calls) ---"
        $mainItem = Child (PlcRoot) "PLC_PRG"
        if ($mainItem) {
            $was = [string]$mainItem.ImplementationText
            $mainItem.ImplementationText = "VltLc_Fbd();`nVltLc_St();`n"
            Build "VltLc_"
            (Child (PlcRoot) "PLC_PRG").ImplementationText = $was
        } else { Out "   no PLC_PRG found - build skipped" }
        foreach ($n in @("VltLc_Fbd", "VltLc_St", "VltLc_Donor")) { try { (PlcRoot).DeleteChild($n) } catch {} }
    }
    "priority" {
        $task = $null
        for ($i = 1; $i -le (PlcRoot).ChildCount; $i++) { $c = (PlcRoot).Child($i); if ($c.ItemType -eq 621) { $task = $c; break } }
        if (-not $task) { throw "no PLC task (621) under $((PlcRoot).Name)" }
        $linked = ([xml]$task.ProduceXml()).TreeItem.PlcTaskDef.LinkedTask
        function Sched {
            $doc = [xml]$sm.LookupTreeItem($linked).ProduceXml()
            $d = $doc.TreeItem.TaskDef
            $ctx = @($doc.SelectNodes("//Context") | ForEach-Object { "ctx '$($_.Name)' prio=$($_.Priority)" })
            return "TaskDef Priority='$($d.Priority)' CycleTime=$($d.CycleTime); $($ctx -join '; ')"
        }
        $orig = ([xml]$sm.LookupTreeItem($linked).ProduceXml()).TreeItem.TaskDef.Priority
        Out "system task $linked, as found: $(Sched)"
        $values = @("abc", "-1", "0", "1.5", " 7 ", "+3", "0x10", "99999999999", "2147483648", "<5>", "&", "", "31", "32", "255", "256", "65535", "65536", "007")
        foreach ($v in $values) {
            $escaped = [System.Security.SecurityElement]::Escape($v)
            try {
                $sm.LookupTreeItem($linked).ConsumeXml("<TreeItem><TaskDef><Priority>$escaped</Priority></TaskDef></TreeItem>")
                Out ("   Priority '{0}' (sent '{1}'): taken -> {2}" -f $v, $escaped, (Sched))
            } catch {
                Out ("   Priority '{0}' (sent '{1}'): REFUSED: {2} -> {3}" -f $v, $escaped, (Esc (FirstLine $_.Exception.Message)), (Sched))
            }
            $sm.LookupTreeItem($linked).ConsumeXml("<TreeItem><TaskDef><Priority>$orig</Priority></TaskDef></TreeItem>")
        }
        Out "restored: $(Sched)"
    }
}
Out "done"
