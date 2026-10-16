using System.Globalization;
using System;
using System.Threading;
using System.Collections.Generic;
using System.Linq;
using Volt.Ide.Twincat;
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

// `--xae-pid <pid>`: the ONE XAE window this worker owns. The worker serves `volt.bridge.twincat.<pid>` and
// attaches to that window by pid, so the connector's supervisor always spawns one per pid and passes it.
//
// WITHOUT it, this FINDS a window instead of refusing. That difference is the whole double-click story: a user
// who unzips the download and runs the exe passes no arguments, and this used to print one line to stderr and
// exit 2 — the console window flashing shut before anyone could read it, which reads as "the bridge is broken".
// Nobody hands a person a program that only works with an argument they were never told about.
//
// It WAITS rather than failing when no XAE is up yet, because the order a user does things in is not ours to
// choose: starting the bridge before opening the project is at least as natural as the reverse. The previous
// release worked this way and the lifecycle came with it — the console window IS the bridge, and closing it
// stops the process. CODESYS needs no equivalent: its bridge lives inside the IDE and goes when the IDE goes.
int xaePid = 0;
for (int i = 0; i + 1 < args.Length; i++)
    if (args[i] == WorkerCli.XaePid && int.TryParse(args[i + 1], NumberStyles.Integer, CultureInfo.InvariantCulture, out var p)) xaePid = p;
if (xaePid == 0)
{
    VoltLog.Info("no --xae-pid given; looking for a TwinCAT XAE window");
    Console.WriteLine("Looking for TwinCAT XAE... (close this window to stop the bridge)");
    // Enumerating the ROT is a COM call and must happen on an STA thread, the same as every other one here.
    var deadline = DateTime.UtcNow.AddMinutes(10);
    while (xaePid == 0)
    {
        var found = new List<int>();
        var scan = new Thread(() =>
        {
            try { ComMessageFilter.Register(); RotInstances.TryEnumeratePids(out var all); found.AddRange(all); }
            catch (Exception ex) { VoltLog.Warn("XAE scan failed: " + ex.Message); }
        });
        scan.SetApartmentState(ApartmentState.STA);
        scan.Start();
        scan.Join();

        if (found.Count > 0)
        {
            // The FIRST window, and say so when there is more than one. Serving several from one process is the
            // connector's job (it spawns a worker per pid); silently picking one of three and never mentioning
            // it is how "the bridge is connected to the wrong project" becomes a ten-minute mystery.
            xaePid = found[0];
            if (found.Count > 1)
                Console.WriteLine($"{found.Count} XAE windows are open; serving pid {xaePid}. Use the tray app to serve all of them.");
            break;
        }
        if (DateTime.UtcNow > deadline)
        {
            Console.WriteLine("No TwinCAT XAE window appeared. Open your project in XAE, then run this again.");
            return 2;
        }
        Thread.Sleep(2000);
    }
    Console.WriteLine($"Found TwinCAT XAE (pid {xaePid}).");
}
var pipe = PipeNames.TwincatInstance(xaePid);

var driver = new BeckhoffDriver();
var cts = new CancellationTokenSource();

var sta = new Thread(() =>
{
    ComMessageFilter.Register(); // must run on the STA thread that makes the COM calls
    // Attach to our one XAE window by pid and serve what it has open — its first TwinCAT project, or the first one
    // opened later (the health poll takes it up). A `select` by name serves another. If the window isn't attachable
    // yet, stay degraded — the driver re-acquires the same pid on a content op / recovery.
    try { driver.Connect(xaePid); }
    catch (Exception ex) { driver.MarkDegraded($"waiting for TwinCAT XAE pid {xaePid} ({ex.Message})"); }
    // Can XAE's Solution Explorer be read from here at all (DIALECT C2i)? Asked once, so health says it before any op.
    // A check that cannot RUN is no verdict: the first read decides then, with the same sentence.
    try
    {
        driver.CheckHierarchy();
        if (driver.Unsupported is { } why) VoltLog.Error($"twincat: {why}");
    }
    catch (Exception ex) { VoltLog.Warn($"twincat: the hierarchy start check did not run ({ex.GetType().Name}: {ex.Message}); the first read decides"); }
    driver.RunStaMessageLoop(cts.Token);
})
{ IsBackground = true };
sta.SetApartmentState(ApartmentState.STA);
sta.Start();

using var host = new BridgePipeHost(driver, pipe);
// The bind is synchronous (PipeServer.Start), so an ACL denial — or ANOTHER BRIDGE ALREADY SERVING THIS NAME —
// faults HERE. The second of those is new: a name collision did NOT fault until `PipeServer` started taking a
// named mutex for it, because a second server on a live pipe name is just another instance of the same pipe and
// Windows splits clients between them (see the long note there, and what it cost on 2026-09-20). Die with the reason
// in the log and a non-zero exit — the supervisor logs the exit and restarts — instead of printing a tidy "serving"
// line over a pipe nothing is listening on. CODESYS's PipeHost.Start has the symmetric catch arm.
try { host.Start(); }
catch (Exception ex)
{
    VoltLog.Error($"twincat bridge FAILED to start on pipe {pipe} (xae pid {xaePid}): {ex.Message}");
    cts.Cancel();
    return 3;
}
VoltLog.Info($"twincat bridge serving on pipe {pipe} (xae pid {xaePid}), bridge {BridgePipeHost.Release ?? "(release unreadable)"}");
// Said on the CONSOLE as well as in the log, because for a double-click launch this window is the entire user
// interface: it is how someone knows the bridge is up, and closing it is how they stop it. Closing a console
// window ends the process (after the close handler below says goodbye to the relay); there is no tray icon to hunt for.
Console.WriteLine($"Bridge connected to TwinCAT (pid {xaePid}). Close this window to stop it.");

// The relay tunnel, exactly as CODESYS starts it — same Core helper, so the two vendors cannot drift. This was
// MISSING here: a downloaded TwinCAT worker served its pipe perfectly and was simply absent from the relay, so
// the bridge worked on the machine it ran on and the web app could never reach it. Returns null (silently) when
// this install has no sidecar and no setup code, which is every dev build.
using var tunnel = Volt.Relay.PipeHostTunnel.StartIfConfigured(
    Volt.Relay.PipeHostTunnel.DirectoryOf(typeof(BridgePipeHost)),
    pipe,
    Vendors.Twincat,
    BridgePipeHost.Release,   // the release health reports (design D3), never the assembly version
    m => VoltLog.Info(m),
    m => VoltLog.Error(m));

// Keep the process alive; tear down the STA loop on exit. Three ways to stop: the connector, which kills the
// process it spawned (no managed code runs, so the relay sees 1006 — nothing can change that); Ctrl+C; and a
// person who closes the window. ProcessExit fires only once the runtime is ALREADY shutting down, so it can never
// be what unblocks this Wait.
// The window close is CTRL_CLOSE_EVENT, which .NET surfaces as SIGHUP. Windows ends the process as soon as that
// handler RETURNS, so the handler itself waits for the tunnel's close (openspec bridge-close-frame: the relay
// gets 1001 `bridge stopping`, not a 1006 it cannot tell from a platform drop). Bounded: the tunnel's close
// waits at most ~1 s, and the OS allows the handler ~5 s.
var done = new ManualResetEventSlim(false);
var stopped = new ManualResetEventSlim(false);
Console.CancelKeyPress += (_, e) => { e.Cancel = true; done.Set(); };
using var windowClosing = System.Runtime.InteropServices.PosixSignalRegistration.Create(
    System.Runtime.InteropServices.PosixSignal.SIGHUP,
    ctx => { ctx.Cancel = true; done.Set(); stopped.Wait(TimeSpan.FromSeconds(4)); });
done.Wait();
VoltLog.Info($"twincat bridge stopping (pipe {pipe})");
tunnel?.Dispose();
stopped.Set();
cts.Cancel();
return 0;
