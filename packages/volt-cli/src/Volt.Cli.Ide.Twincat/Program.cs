using System;
using System.Threading;
using System.Collections.Generic;
using System.Linq;
using Volt.Cli.Ide.Twincat;
using Volt.Wire;
using Volt.Contracts;
using Volt.Engine.Host;

// Per-XAE headless worker: the connector spawns one per running XAE window with `--xae-pid <pid>` (CODESYS-symmetric:
// one host per IDE, one pipe each). ExternalAttach — it does NOT crash if the XAE isn't attachable yet: it starts
// DEGRADED and the driver re-attaches to its window, so the worker is stable across a DTE re-registration.
VoltLog.Init(Vendors.Twincat);

// `--list-xae-pids`: one-shot XAE discovery for the connector's supervisor — print each running XAE window's
// process id (one per line) and exit. The COM ROT walk runs in THIS short-lived process so a hang dies with it and
// the always-on tray never holds a COM apartment (the isolation the supervisor design requires). Exit 0 = the
// enumeration ran AND EVERY live XAE answered (empty output = "no XAE open"); exit 1 = it FAILED **or came back
// PARTIAL**, so the connector can tell a real "no XAE" (reap workers) from a list it must not trust (leave the fleet
// alone) — see TwincatXaeProbe. A partial result used to exit 0 with the missing XAE silently dropped, which is a
// LIE in exactly the shape the reap policy consumes: a busy XAE — pinned by a `volt push` or a full `volt build` for
// tens of seconds, the normal case on a large project — vanished from the list and its healthy worker was reaped
// after ~36s, taking the pipe out from under the very push that was holding the IDE.
//
// COST, deliberately accepted and monotone in the reap direction only: TrayContext reads a non-zero probe as "leave
// the fleet as-is" BEFORE the spawn loop as well as the reap loop, so for as long as one XAE stays unreadable a
// NEWLY-OPENED XAE gets no worker and a CRASHED worker is not restarted — undebounced, from the first failed probe,
// where the reap it now prevents cost three. The narrower answer is exit 2 = "partial: do not reap, but DO spawn",
// which needs a third verdict in TwincatXaeProbe.ListPids (today `IReadOnlyList<int>?` — two states, it cannot carry
// one) plus the matching arm in TrayContext. Take that if the spawn stall is ever observed in the field; the symptom
// to watch for is XAE B opened during a long build in XAE A never getting `volt.bridge.twincat.<pidB>`.
// `--probe-inproc <pid>`: the IN-PROC SPIKE, read-only and out-of-process. It changes nothing.
//
// WHY: TwinCAT ships the same 3S stack CODESYS does - NWLObject.dll 3.5.13.0, NWLObject.plugin.dll 3.5.13.30,
// ScriptEngine.dll, IronPython 2.7.7 - so the typed graphical objects the CODESYS driver builds directly already
// exist inside TcXaeShell. Volt just has no way IN, and parses their SERIALIZATION (the <NWL><XmlArchive> in a
// .TcPOU) instead. That is not a vendor difference, it is an ACCESS difference, and it is the whole reason a
// wrong member set on TwinCAT silently corrupts where the same mistake on CODESYS throws.
//
// WHAT IT REPORTS, and why each line matters to whoever builds the in-proc host:
//   - bitness + CLR: TcXaeShell is 32-bit and runs the .NET FRAMEWORK clr.dll, so an in-proc host must be
//     x86/AnyCPU net4x - a sibling of Volt.Cli.Ide.Codesys (net48), never this worker (net8, x64).
//   - which 3S/PLC modules are loaded: the PLC plugin stack is DEMAND-loaded. A shell with only
//     "TwinCAT XAE Base" and "System Manager" up has no NWL objects live yet, which says the graphical editor
//     has not been opened - not that the objects are unreachable.
//
// DO NOT enumerate DTE.Commands here. It was tried: thousands of cross-process marshalled calls, and it hangs.
// `--probe-pou <name>`: READ-ONLY. Dump what ITcPlcImplementation / ITcPlcPou actually hand over for one POU.
//
// Volt uses ImplementationText and infers everything else. Beckhoff's own type library
// (TCatSysManagerLib) says there is more on the same objects, and none of it is currently touched:
//     ITcPlcImplementation : ImplementationText | ImplementationXml | Language
//     ITcPlcPou            : DocumentXml (GET AND SET) | ReturnType
// `Language` would replace sniffing DefaultViewMode out of the archive, and a settable `DocumentXml` is a
// ONE-CALL write of a whole POU with its children - the property the PLCopen import had and the per-child
// write path lost. This measures them instead of assuming, because the last time a TwinCAT shape was assumed
// it produced twenty files the IDE could not open.
foreach (var a in args)
    if (a == WorkerCli.ProbePou)
    {
        string? want = null;
        for (int i = 0; i < args.Length - 1; i++)
            if (args[i] == WorkerCli.ProbePou) want = args[i + 1];
        if (string.IsNullOrEmpty(want)) { Console.Error.WriteLine("probe-pou: give a POU name"); return 1; }

        int rc = 0;
        var t = new Thread(() =>
        {
            try
            {
                ComMessageFilter.Register();
                RotInstances.TryEnumeratePids(out var pids);
                if (pids.Count == 0) { Console.Error.WriteLine("probe-pou: no XAE"); rc = 1; return; }

                var om = new TcObjectModel();
                om.ConnectToPid(pids[0]);
                om.SelectProject(null);          // whatever the window is serving
                om.EnsureAttached();

                var node = FindNamed(om, om.PlcRoot(), want!, 0);
                if (node == null) { Console.Error.WriteLine($"probe-pou: '{want}' not found"); rc = 1; return; }

                Console.WriteLine($"pou            : {want}");
                Dump("Language", () => (string)((dynamic)node).Language);
                Dump("ReturnType", () => (string)((dynamic)node).ReturnType);
                Dump("ImplementationText", () => (string)((dynamic)node).ImplementationText);
                Dump("ImplementationXml", () => (string)((dynamic)node).ImplementationXml);
                Dump("DocumentXml", () => (string)((dynamic)node).DocumentXml);
            }
            catch (Exception ex) { Console.Error.WriteLine($"probe-pou: {ex.GetType().Name}: {ex.Message}"); rc = 1; }
        });
        t.SetApartmentState(ApartmentState.STA);
        t.Start();
        t.Join();
        return rc;

        static object? FindNamed(TcObjectModel om, object node, string name, int depth)
        {
            if (depth > 12) return null;
            if (string.Equals(om.GetName(node), name, StringComparison.OrdinalIgnoreCase)) return node;
            int n;
            try { n = om.ChildCount(node); } catch { return null; }
            for (int i = 1; i <= n; i++)
            {
                object child;
                try { child = om.ChildAt(node, i); } catch { continue; }
                var hit = FindNamed(om, child, name, depth + 1);
                if (hit != null) return hit;
            }
            return null;
        }

        static void Dump(string member, Func<string?> get)
        {
            string v;
            try { v = get() ?? "(null)"; }
            catch (Exception ex) { Console.WriteLine($"{member,-18} : UNAVAILABLE ({ex.GetType().Name})"); return; }
            var oneLine = v.Replace("\r", "").Replace("\n", " ");
            Console.WriteLine($"{member,-18} : {v.Length} chars | {(oneLine.Length > 150 ? oneLine.Substring(0, 150) + " ..." : oneLine)}");
        }
    }

foreach (var a in args)
    if (a == WorkerCli.ProbeInProc)
    {
        var pid = 0;
        for (int i = 0; i < args.Length - 1; i++)
            if (args[i] == WorkerCli.ProbeInProc) int.TryParse(args[i + 1], out pid);
        if (pid == 0)
        {
            var found = new List<int>();
            var scan = new Thread(() => { ComMessageFilter.Register(); RotInstances.TryEnumeratePids(out var all); found.AddRange(all); });
            scan.SetApartmentState(ApartmentState.STA);
            scan.Start();
            scan.Join();
            pid = found.Count > 0 ? found[0] : 0;
        }
        if (pid == 0) { Console.Error.WriteLine("probe-inproc: no XAE window found"); return 1; }

        try
        {
            using var proc = System.Diagnostics.Process.GetProcessById(pid);
            var mods = proc.Modules.Cast<System.Diagnostics.ProcessModule>().ToList();

            // A 64-bit reader sees only the wow64 stubs of a 32-bit process, so a tiny module count IS the
            // bitness answer rather than a failure - say so instead of reporting an empty stack.
            var wow64 = mods.Any(m => m.ModuleName.StartsWith("wow64", StringComparison.OrdinalIgnoreCase));
            if (wow64 && mods.Count < 20)
            {
                Console.WriteLine($"xae pid    : {pid}");
                Console.WriteLine("bitness    : 32-bit (WOW64) — and THIS probe is 64-bit, so it can only see the stubs.");
                Console.WriteLine("            : re-run the module half from 32-bit PowerShell:");
                Console.WriteLine("            : C:" + @"\Windows\SysWOW64\WindowsPowerShell1.0\powershell.exe" + " -NoProfile -Command \"(Get-Process -Id " + pid + ").Modules | Where-Object { $_.FileName -match 'TwinCAT|NWL|Script' } | Select -Expand ModuleName\"");
                return 0;
            }

            Console.WriteLine($"xae pid    : {pid}");
            Console.WriteLine($"modules    : {mods.Count}");
            Console.WriteLine($"clr        : {(mods.Any(m => m.ModuleName.Equals("clr.dll", StringComparison.OrdinalIgnoreCase)) ? ".NET Framework (clr.dll) — an in-proc host must be net4x" : mods.Any(m => m.ModuleName.StartsWith("coreclr", StringComparison.OrdinalIgnoreCase)) ? ".NET Core (coreclr.dll)" : "no managed runtime seen")}");

            foreach (var (label, rx) in new[]
            {
                ("nwl objects", "NWLObject"),
                ("script eng ", "ScriptEngine|IronPython"),
                ("plc stack  ", "Plc|CODESYS|3S"),
                ("xae base   ", "TwinCAT XAE|System Manager"),
            })
            {
                var hit = mods.Where(m => System.Text.RegularExpressions.Regex.IsMatch(m.ModuleName, rx, System.Text.RegularExpressions.RegexOptions.IgnoreCase))
                              .Select(m => m.ModuleName).Distinct().Take(6).ToList();
                Console.WriteLine($"{label}: {(hit.Count == 0 ? "(not loaded)" : string.Join(", ", hit))}");
            }
            return 0;
        }
        catch (Exception ex) { Console.Error.WriteLine($"probe-inproc: {ex.GetType().Name}: {ex.Message}"); return 1; }
    }

foreach (var a in args)
    if (a == WorkerCli.ListXaePids)
    {
        int rc = 0;
        var probe = new Thread(() =>
        {
            try
            {
                ComMessageFilter.Register();
                var complete = RotInstances.TryEnumeratePids(out var pids);
                foreach (var id in pids) Console.WriteLine(id); // print the readable half either way — it is correct, just partial
                if (!complete)
                {
                    Console.Error.WriteLine("list-xae-pids: a running XAE did not answer — enumeration INCOMPLETE, do not reap");
                    rc = 1;
                }
            }
            catch (Exception ex) { Console.Error.WriteLine($"list-xae-pids: {ex.Message}"); rc = 1; }
        });
        probe.SetApartmentState(ApartmentState.STA);
        probe.Start();
        probe.Join();
        return rc;
    }

// `--xae-pid <pid>`: the ONE XAE window this worker owns. REQUIRED — the worker serves `volt.bridge.twincat.<pid>`
// and attaches to that window by pid; there is no all-XAE fallback (the connector's supervisor always spawns per pid).
int xaePid = 0;
for (int i = 0; i + 1 < args.Length; i++)
    if (args[i] == WorkerCli.XaePid && int.TryParse(args[i + 1], out var p)) xaePid = p;
if (xaePid == 0)
{
    Console.Error.WriteLine("VoltBridgeTwincat requires --xae-pid <pid> (or --list-xae-pids).");
    return 2;
}
var pipe = PipeNames.TwincatInstance(xaePid);

var driver = new BeckhoffDriver();
var cts = new CancellationTokenSource();

var sta = new Thread(() =>
{
    ComMessageFilter.Register(); // must run on the STA thread that makes the COM calls
    // Attach to our one XAE window by pid. If it isn't attachable yet, stay degraded — the driver re-acquires the
    // same pid on a content op / recovery. No project is auto-bound (the user picks one via `select`).
    try { driver.Connect(xaePid); }
    catch (Exception ex) { driver.MarkDegraded($"waiting for TwinCAT XAE pid {xaePid} ({ex.Message})"); }
    driver.RunStaMessageLoop(cts.Token);
})
{ IsBackground = true };
sta.SetApartmentState(ApartmentState.STA);
sta.Start();

using var host = new BridgePipeHost(driver, pipe);
// The bind is synchronous (PipeServer.Start), so a name collision or an ACL denial faults HERE. Die with the reason
// in the log and a non-zero exit — the supervisor logs the exit and restarts — instead of printing a tidy "serving"
// line over a pipe nothing is listening on. CODESYS's PipeHost.Start has the symmetric catch arm.
try { host.Start(); }
catch (Exception ex)
{
    VoltLog.Error($"twincat bridge FAILED to start on pipe {pipe} (xae pid {xaePid}): {ex.Message}");
    cts.Cancel();
    return 3;
}
VoltLog.Info($"twincat bridge serving on pipe {pipe} (xae pid {xaePid})");

// Keep the process alive (the connector owns its lifecycle and kills it); tear down the STA loop on exit.
// CancelKeyPress is the ONE reachable shutdown path: ProcessExit fires only once the runtime is ALREADY shutting
// down, so it can never be what unblocks this Wait, and the connector's TerminateProcess raises no managed event.
var done = new ManualResetEventSlim(false);
Console.CancelKeyPress += (_, e) => { e.Cancel = true; done.Set(); };
done.Wait();
cts.Cancel();
return 0;
