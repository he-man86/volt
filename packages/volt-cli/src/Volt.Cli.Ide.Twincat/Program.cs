using System;
using System.Threading;
using Volt.Engine.Diagnostics;
using Volt.Engine.Wire;
using Volt.Cli.Ide.Twincat;
using Volt.Cli.Transport;

// Per-XAE headless worker: the connector spawns one per running XAE window with `--xae-pid <pid>` (CODESYS-symmetric:
// one host per IDE, one pipe each). ExternalAttach — it does NOT crash if the XAE isn't attachable yet: it starts
// DEGRADED and the driver re-attaches to its window, so the worker is stable across a DTE re-registration.
VoltLog.Init(Vendors.Twincat);

// `--list-xae-pids`: one-shot XAE discovery for the connector's supervisor — print each running XAE window's
// process id (one per line) and exit. The COM ROT walk runs in THIS short-lived process so a hang dies with it and
// the always-on tray never holds a COM apartment (the isolation the supervisor design requires). Exit 0 always
// (an empty ROT is "no XAE open", not an error); stderr-only diagnostics.
foreach (var a in args)
    if (a == "--list-xae-pids")
    {
        var probe = new Thread(() =>
        {
            try { ComMessageFilter.Register(); foreach (var (id, _) in RotInstances.EnumerateWithPids()) Console.WriteLine(id); }
            catch (Exception ex) { Console.Error.WriteLine($"list-xae-pids: {ex.Message}"); }
        });
        probe.SetApartmentState(ApartmentState.STA);
        probe.Start();
        probe.Join();
        return 0;
    }

// `--xae-pid <pid>`: the ONE XAE window this worker owns. REQUIRED — the worker serves `volt.bridge.twincat.<pid>`
// and attaches to that window by pid; there is no all-XAE fallback (the connector's supervisor always spawns per pid).
int xaePid = 0;
for (int i = 0; i + 1 < args.Length; i++)
    if (args[i] == "--xae-pid" && int.TryParse(args[i + 1], out var p)) xaePid = p;
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
host.Start();
VoltLog.Info($"twincat bridge serving on pipe {pipe} (xae pid {xaePid})");

// Keep the process alive (the connector owns its lifecycle and kills it); tear down the STA loop on exit.
var done = new ManualResetEventSlim(false);
Console.CancelKeyPress += (_, e) => { e.Cancel = true; done.Set(); };
AppDomain.CurrentDomain.ProcessExit += (_, _) => done.Set();
done.Wait();
cts.Cancel();
return 0;
