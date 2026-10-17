/**
 * OPEN A POU IN TWINCAT'S OWN EDITOR — the last of the native writer's live checks (openspec twincat-inproc-host 2.3): a
 * body TwinCAT stores but its editor cannot load is a body the engineer cannot open. Through automation only:
 * `ItemOperations.OpenFile` on the POU's `.TcPOU` under this instance's fixture copy, the window's caption read, the
 * window closed WITHOUT saving. Refuses any XAE whose solution is not under the instance's copy (`fixture-ide.ts`).
 *
 * <p>An editor that cannot load the body answers by throwing or by never returning; the spawn's timeout turns the second
 * into a failure rather than a hung suite.</p>
 */
import { spawnSync } from "node:child_process"
import { compileTempEnv } from "./fixture-ide"

export type EditorResult = { opened: boolean; caption: string; kind?: string; error?: string }

export function openInTwinCatEditor(pipe: string, instance: string, pous: string[]): Record<string, EditorResult> {
	const pid = Number(pipe.split(".").pop())
	if (!Number.isInteger(pid)) throw new Error(`not a TwinCAT bridge pipe: ${pipe}`)
	const copy = instance ? `volt-ide-twincat-${instance}\\` : "volt-ide-twincat\\"
	const names = pous.map((p) => `'${p.replace(/'/g, "''")}'`).join(",")
	const ps = `
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName Microsoft.VisualBasic
Add-Type -TypeDefinition @"
using System; using System.Runtime.InteropServices; using System.Runtime.InteropServices.ComTypes;
public static class VoltRotEditor {
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
$dte = [VoltRotEditor]::Get("!TcXaeShell.DTE.15.0:${pid}")
if (-not $dte) { throw "XAE ${pid} has no DTE in the ROT" }
$sln = $dte.Solution.FullName
if ($sln -notlike "*${copy}*") { throw "not this instance's fixture copy: $sln" }
$root = Split-Path $sln
$out = @{}
foreach ($name in @(${names})) {
  $file = Get-ChildItem -Path $root -Recurse -Filter "$name.TcPOU" | Select-Object -First 1
  if (-not $file) { $out[$name] = @{ opened = $false; caption = ""; error = "no $name.TcPOU under $root" }; continue }
  try {
    $w = $dte.ItemOperations.OpenFile($file.FullName)
    # Late-bound through CallByName: PowerShell's COM adapter answers nothing for these on the shell's Window.
    $caption = [string][Microsoft.VisualBasic.Interaction]::CallByName($w, "Caption", [Microsoft.VisualBasic.CallType]::Get)
    $doc = [Microsoft.VisualBasic.Interaction]::CallByName($w, "Document", [Microsoft.VisualBasic.CallType]::Get)
    $kind = [string][Microsoft.VisualBasic.Interaction]::CallByName($w, "ObjectKind", [Microsoft.VisualBasic.CallType]::Get)
    # The PLC editor captions the window with the POU's name; a text editor would show the file name.
    $out[$name] = @{ opened = ($null -ne $doc -and $caption -eq $name); caption = $caption; kind = $kind }
    [Microsoft.VisualBasic.Interaction]::CallByName($w, "Close", [Microsoft.VisualBasic.CallType]::Method, 2) | Out-Null
  } catch { $out[$name] = @{ opened = $false; caption = ""; error = $_.Exception.Message } }
}
$out | ConvertTo-Json -Compress -Depth 4
`
	const r = spawnSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", ps], {
		encoding: "utf8",
		timeout: 60_000 + 15_000 * pous.length,
		env: compileTempEnv(),
	})
	if (r.status !== 0) throw new Error(`opening the TwinCAT editor failed: ${r.stderr || r.stdout || r.error}`)
	return JSON.parse(r.stdout.trim())
}
