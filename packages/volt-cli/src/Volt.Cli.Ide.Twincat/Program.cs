using System;
using System.Threading;
using Volt.Engine.Diagnostics;
using Volt.Engine.Wire;
using Volt.Cli.Ide.Twincat;
using Volt.Cli.Transport;

// Standalone headless worker (the connector spawns it at login, before any IDE). ExternalAttach: don't crash if
// TwinCAT isn't open yet — start DEGRADED and let the driver attach when the XAE appears, so the supervisor keeps
// one stable worker across IDE restarts. Pipe replacement for the backup's Program.cs + BridgeHttpServer.RunStandalone.
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

// `--xae-pid <pid>`: per-XAE worker — own the ONE XAE window with that process id and serve
// `volt.bridge.twincat.<pid>` (the connector spawns one per XAE, CODESYS-symmetric). Absent → the legacy single
// worker on `volt.bridge.twincat` that multiplexes every XAE by project name.
int xaePid = 0;
for (int i = 0; i + 1 < args.Length; i++)
    if (args[i] == "--xae-pid" && int.TryParse(args[i + 1], out var p)) xaePid = p;
var pipe = xaePid != 0 ? PipeNames.TwincatInstance(xaePid) : PipeNames.Twincat;

var driver = new BeckhoffDriver();
var cts = new CancellationTokenSource();

var sta = new Thread(() =>
{
    ComMessageFilter.Register(); // must run on the STA thread that makes the COM calls
    // Bind a DTE for the version if an IDE is already open; if not, stay degraded — the connector attaches via a
    // `select` once one appears. No project is auto-bound (the user picks one).
    try { if (xaePid != 0) driver.Connect(xaePid); else driver.Connect(); }
    catch (Exception ex) { driver.MarkDegraded($"waiting for TwinCAT XAE ({ex.Message})"); }
    driver.RunStaMessageLoop(cts.Token);
})
{ IsBackground = true };
sta.SetApartmentState(ApartmentState.STA);
sta.Start();

using var host = new BridgePipeHost(driver, pipe);
host.Start();
VoltLog.Info($"twincat bridge serving on pipe {pipe}{(xaePid != 0 ? $" (xae pid {xaePid})" : "")}");

// Keep the process alive (the connector owns its lifecycle and kills it); tear down the STA loop on exit.
var done = new ManualResetEventSlim(false);
Console.CancelKeyPress += (_, e) => { e.Cancel = true; done.Set(); };
AppDomain.CurrentDomain.ProcessExit += (_, _) => done.Set();
done.Wait();
cts.Cancel();
return 0;
