/**
 * The engineer's answer to XAE's "TcXaeShell Recovered Files" dialog after a crash: "Do Not Recover". Volt never saves
 * the project, so an XAE killed with unsaved work opens on that modal dialog when it is started again, and a modal
 * dialog blocks every COM call. Only the XAE opened on `sln` (this instance's fixture copy) is looked at, and only that
 * dialog's "&Do Not Recover" is clicked. Answers how many it clicked.
 */
import { spawnSync } from "node:child_process"
import { compileTempEnv } from "./fixture-ide"

export function declineRecovery(sln: string): number {
	const ps = `
$ErrorActionPreference = "Stop"
Add-Type -TypeDefinition @"
using System; using System.Text; using System.Runtime.InteropServices;
public static class VoltRecovery {
  public delegate bool CB(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumWindows(CB cb, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr p, CB cb, IntPtr l);
  [DllImport("user32.dll")] static extern int GetWindowThreadProcessId(IntPtr h, out int p);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern IntPtr SendMessage(IntPtr h, int m, IntPtr w, IntPtr l);
  static string Text(IntPtr h) { var s = new StringBuilder(512); GetWindowText(h, s, 512); return s.ToString(); }
  public static int Decline(int pid) {
    int n = 0;
    EnumWindows((h, l) => {
      int p; GetWindowThreadProcessId(h, out p);
      if (p == pid && IsWindowVisible(h) && Text(h) == "TcXaeShell Recovered Files")
        EnumChildWindows(h, (k, m) => { if (Text(k) == "&Do Not Recover") { SendMessage(k, 0x00F5, IntPtr.Zero, IntPtr.Zero); n++; } return true; }, IntPtr.Zero);
      return true; }, IntPtr.Zero);
    return n; }
}
"@
$n = 0
foreach ($x in @(Get-CimInstance Win32_Process -Filter "Name='TcXaeShell.exe'" | Where-Object { $_.CommandLine -like '*${sln.replace(/'/g, "''")}*' })) { $n += [VoltRecovery]::Decline([int]$x.ProcessId) }
$n
`
	const r = spawnSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", ps], { encoding: "utf8", timeout: 60_000, env: compileTempEnv() })
	if (r.status !== 0) throw new Error(`answering XAE's Recovered Files dialog failed (${r.status}): ${r.stderr || r.stdout}`)
	return Number((r.stdout ?? "").trim().split(/\r?\n/).pop() ?? 0)
}
