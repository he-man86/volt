/**
 * XAE LOADS THE PROJECT AGAIN — the one TwinCAT state the refusal matrix's UNREADABLE row needs (DIALECT C2i): a POU
 * written broken reads like any POU in the load that wrote it, and is `unreadable` once XAE has loaded it from disk.
 *
 * <p>Through automation only, never an on-disk edit under an open XAE (that raises a modal "modified outside" prompt,
 * and a modal blocks every COM call): save all, close the solution, reopen it through the same DTE, then `connect` —
 * the worker's held PLC node answers E_FAIL after a reopen until it is acquired anew (DIALECT C2i). Refuses any XAE
 * whose solution is not under this instance's fixture copy (`fixture-ide.ts`).</p>
 *
 * <p>Reopened is READY when every PLC project is back with the children it had before the close: the tree's shape
 * (each system project's PLC projects, and each one's child count) is read before the close and polled for after the
 * open (120 s at most).</p>
 */
import { spawnSync } from "node:child_process"
import { compileTempEnv } from "./fixture-ide"

export function reopenTwinCatSolution(pipe: string, instance: string): void {
	const pid = Number(pipe.split(".").pop())
	if (!Number.isInteger(pid)) throw new Error(`not a TwinCAT bridge pipe: ${pipe}`)
	const copy = instance ? `volt-ide-twincat-${instance}\\` : "volt-ide-twincat\\"
	const ps = `
$ErrorActionPreference = "Stop"
Add-Type -TypeDefinition @"
using System; using System.Runtime.InteropServices; using System.Runtime.InteropServices.ComTypes;
public static class VoltRotReopen {
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
$dte = [VoltRotReopen]::Get("!TcXaeShell.DTE.15.0:${pid}")
if (-not $dte) { throw "XAE ${pid} has no DTE in the ROT" }
$sln = $dte.Solution.FullName
if ($sln -notlike "*${copy}*") { throw "not this instance's fixture copy: $sln" }
function Shape($d) {
  $parts = @()
  for ($i = 1; $i -le $d.Solution.Projects.Count; $i++) {
    $p = $d.Solution.Projects.Item($i)
    try { $tipc = $p.Object.LookupTreeItem("TIPC") } catch { continue }
    for ($j = 1; $j -le $tipc.ChildCount; $j++) { $plc = $tipc.Child($j); $parts += "$($p.Name)/$($plc.Name)=$($plc.NestedProject.ChildCount)" }
  }
  ($parts | Sort-Object) -join ";"
}
$before = Shape $dte
if (-not $before) { throw "the solution holds no PLC project to reopen" }
$dte.ExecuteCommand("File.SaveAll")
$dte.Solution.Close($true)
$dte.Solution.Open($sln)
$t0 = Get-Date
$now = $null
while (((Get-Date) - $t0).TotalSeconds -lt 120) { try { $now = Shape $dte; if ($now -eq $before) { break } } catch {}; Start-Sleep -Milliseconds 500 }
if ($now -ne $before) { throw "the solution did not reopen within 120 s: its PLC projects are '$now', and were '$before'" }
`
	const r = spawnSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", ps], { encoding: "utf8", timeout: 240_000, env: compileTempEnv() })
	if (r.status !== 0) throw new Error(`reopening the TwinCAT solution failed: ${r.stderr || r.stdout}`)
}
