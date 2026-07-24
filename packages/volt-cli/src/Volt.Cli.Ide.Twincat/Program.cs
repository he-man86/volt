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

var driver = new BeckhoffDriver();
var cts = new CancellationTokenSource();

var sta = new Thread(() =>
{
    ComMessageFilter.Register(); // must run on the STA thread that makes the COM calls
    try { driver.Connect(); }
    catch (NoProjectSelectedException ex) { driver.MarkDegraded(ex.Message); }
    catch (Exception ex) { driver.MarkDegraded($"waiting for TwinCAT XAE ({ex.Message})"); }
    driver.RunStaMessageLoop(cts.Token);
})
{ IsBackground = true };
sta.SetApartmentState(ApartmentState.STA);
sta.Start();

using var host = new BridgePipeHost(driver, PipeNames.Twincat);
host.Start();
VoltLog.Info($"twincat bridge serving on pipe {PipeNames.Twincat}");

// Keep the process alive (the connector owns its lifecycle and kills it); tear down the STA loop on exit.
var done = new ManualResetEventSlim(false);
Console.CancelKeyPress += (_, e) => { e.Cancel = true; done.Set(); };
AppDomain.CurrentDomain.ProcessExit += (_, _) => done.Set();
done.Wait();
cts.Cancel();
