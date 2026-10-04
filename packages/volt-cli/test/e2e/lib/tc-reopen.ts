/**
 * XAE LOADS THE PROJECT AGAIN — the one TwinCAT state the refusal matrix's UNREADABLE row needs (DIALECT C2i): a POU
 * written broken reads like any POU in the load that wrote it, and is `unreadable` once XAE has loaded it from disk.
 *
 * <p>Through automation only, never an on-disk edit under an open XAE (that raises a modal "modified outside" prompt,
 * and a modal blocks every COM call): save all, close the solution, reopen it through the same DTE, then `connect` —
 * the worker's held PLC node answers E_FAIL after a reopen until it is acquired anew (DIALECT C2i). Refuses any XAE
 * whose solution is not under this instance's fixture copy (`fixture-ide.ts`).</p>
 */
import { spawnSync } from "node:child_process"

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
$dte.ExecuteCommand("File.SaveAll")
$dte.Solution.Close($true)
$dte.Solution.Open($sln)
$t0 = Get-Date
while (((Get-Date) - $t0).TotalSeconds -lt 120) { try { if ($dte.Solution.Projects.Count -ge 1) { break } } catch {}; Start-Sleep 2 }
if ($dte.Solution.Projects.Count -lt 1) { throw "the solution did not reopen within 120 s" }
Start-Sleep 10
`
	const r = spawnSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", ps], { encoding: "utf8", timeout: 240_000 })
	if (r.status !== 0) throw new Error(`reopening the TwinCAT solution failed: ${r.stderr || r.stdout}`)
}
