/**
 * WHAT THE ENGINEER DOES IN XAE, through automation on the served XAE only: type into a body without saving, and save.
 * Volt never saves the project (a push is an edit in the open IDE); a test that must show what a SAVE persists, or that a
 * push left the engineer's unsaved edit unsaved, acts as the engineer here. Refuses any XAE whose solution is not under
 * this instance's fixture copy (`fixture-ide.ts`), like `tc-reopen.ts`.
 */
import { spawnSync } from "node:child_process"
import { compileTempEnv } from "./fixture-ide"

function onServedXae(pipe: string, instance: string, body: string): string {
	const pid = Number(pipe.split(".").pop())
	if (!Number.isInteger(pid)) throw new Error(`not a TwinCAT bridge pipe: ${pipe}`)
	const copy = instance ? `volt-ide-twincat-${instance}\\` : "volt-ide-twincat\\"
	const ps = `
$ErrorActionPreference = "Stop"
Add-Type -TypeDefinition @"
using System; using System.Runtime.InteropServices; using System.Runtime.InteropServices.ComTypes;
public static class VoltRotEngineer {
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
$dte = [VoltRotEngineer]::Get("!TcXaeShell.DTE.15.0:${pid}")
if (-not $dte) { throw "XAE ${pid} has no DTE in the ROT" }
if ($dte.Solution.FullName -notlike "*${copy}*") { throw "not this instance's fixture copy: $($dte.Solution.FullName)" }
${body}
`
	const r = spawnSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", ps], { encoding: "utf8", timeout: 120_000, env: compileTempEnv() })
	if (r.status !== 0) throw new Error(`XAE automation failed (${r.status} ${r.error}): ${r.stderr || r.stdout}`)
	return r.stdout ?? ""
}

/** The engineer's File > Save All. */
export function engineerSaveAll(pipe: string, instance: string): void {
	onServedXae(pipe, instance, `$dte.ExecuteCommand("File.SaveAll")`)
}

/** The engineer types `body` as the implementation of the item at wire path `path`, and does not save. */
export function engineerSetBody(pipe: string, instance: string, path: string, body: string): void {
	const segs = path.split("/")
	if (segs[1] !== "PLC") throw new Error(`not a PLC item path: ${path}`)
	const tree = ["TIPC", ...segs.slice(2, -1), segs[segs.length - 1]!.replace(/\.[^.]+$/, "")].join("^")
	const text = body.replace(/'/g, "''")
	onServedXae(pipe, instance, `
$sm = $null
for ($i = 1; $i -le $dte.Solution.Projects.Count; $i++) { $p = $dte.Solution.Projects.Item($i); if ($p.Name -eq '${segs[0]!.replace(/'/g, "''")}') { $sm = $p.Object } }
if (-not $sm) { throw "no system project '${segs[0]}'" }
$item = $sm.LookupTreeItem('${tree.replace(/'/g, "''")}')
$item.ImplementationText = '${text}'
`)
}

/** Whether the XAE tree holds a node at wire path `path` (a folder: `<system>/PLC/<plc>/.../<folder>`). */
export function xaeHolds(pipe: string, instance: string, path: string): boolean {
	const segs = path.split("/")
	if (segs[1] !== "PLC") throw new Error(`not a PLC path: ${path}`)
	const tree = ["TIPC", ...segs.slice(2)].join("^").replace(/'/g, "''")
	const out = onServedXae(pipe, instance, `
$sm = $null
for ($i = 1; $i -le $dte.Solution.Projects.Count; $i++) { $p = $dte.Solution.Projects.Item($i); if ($p.Name -eq '${segs[0]!.replace(/'/g, "''")}') { $sm = $p.Object } }
try { $x = $sm.LookupTreeItem('${tree}'); "HELD " + $x.Name } catch { "ABSENT" }
`)
	return out.includes("HELD")
}
