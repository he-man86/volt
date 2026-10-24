using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Threading;
using Volt.Contracts;
using Volt.Engine.Host;
using Volt.Engine.Ide;
using Volt.Engine.Sync;
using Volt.Wire;

namespace Volt.Ide.Twincat;

/// <summary>
/// How a TwinCAT worker comes to serve one XAE window. Two starts:
/// <list type="bullet">
/// <item><see cref="RunSupervised"/> — the connector names the window (<c>--xae-pid</c>). A pipe name another bridge
///   holds ends the process with exit 3 and the reason in the log; the connector logs the exit and restarts.</item>
/// <item><see cref="RunDoubleClick"/> — a person ran the exe. It scans the XAE windows and serves the first whose pipe
///   name it can claim, names the others, and while every window is served (or none is open) says so and keeps
///   scanning, with no deadline: closing the window stops it. The console window is this bridge's whole user
///   interface, so the log at Info and above is teed to it, and every exit the person did not ask for prints its
///   reason and waits for Enter.</item>
/// </list>
/// Both CLAIM the pipe name before they attach (<see cref="PipeServer.TakeName"/>): a window another bridge serves is
/// never bound or attached to. Every part that touches the machine is in <see cref="Parts"/>.
/// </summary>
internal sealed class WorkerStart
{
    /// <summary>An XAE window attached to: the host to serve, and the detach that ends its STA loop.</summary>
    internal sealed record Attached(HostLink Link, Action Detach);

    /// <summary>The wait for a requested stop; disposing it says the teardown is done.</summary>
    internal interface IStop : IDisposable
    {
        void Wait();
    }

    internal sealed class Parts
    {
        /// <summary>The XAE window pids, in ROT order.</summary>
        public required Func<IReadOnlyList<int>> Pids { get; init; }
        public required Func<int, string> PipeName { get; init; }
        /// <summary>Claims a pipe name; throws <see cref="PipeNameTakenException"/> when another bridge holds it.</summary>
        public required Func<string, PipeNameClaim> Claim { get; init; }
        /// <summary>An XAE window's caption ("" when it has none).</summary>
        public required Func<int, string> Caption { get; init; }
        public required Func<int, Attached> Attach { get; init; }
        public required TextWriter Console { get; init; }
        public required Action WaitForEnter { get; init; }
        /// <summary>The wait between two scans.</summary>
        public required Action<TimeSpan> Wait { get; init; }
        public required Func<IStop> Stop { get; init; }
        public required Action<VoltLogLevel, string> Log { get; init; }
    }

    private static readonly TimeSpan ScanEvery = TimeSpan.FromSeconds(2);
    private const string Served = "already served by another Volt bridge";

    private readonly Parts _p;

    public WorkerStart(Parts parts) => _p = parts;

    public int RunSupervised(int pid)
    {
        var pipe = _p.PipeName(pid);
        try { return Serve(pid, _p.Claim(pipe)); }
        catch (Exception ex)
        {
            _p.Log(VoltLogLevel.Error, $"twincat bridge FAILED to start on pipe {pipe} (xae pid {pid}): {ex.Message}");
            return 3;
        }
    }

    public int RunDoubleClick()
    {
        // The log, on the console too: the served solution and its changes, an XAE the worker cannot read, every relay
        // state, in the words the log uses. Not under --xae-pid: the connector writes that worker's stdout into the log.
        VoltLog.TeeTo(_p.Console);
        try { return ScanAndServe(); }
        finally { VoltLog.TeeTo(null); }
    }

    private int ScanAndServe()
    {
        try
        {
            _p.Log(VoltLogLevel.Info, "no --xae-pid given; looking for a TwinCAT XAE window");
            string? shown = null;
            while (true)
            {
                var pids = _p.Pids();
                var taken = new List<int>();
                foreach (var pid in pids)
                {
                    PipeNameClaim claim;
                    try { claim = _p.Claim(_p.PipeName(pid)); }
                    catch (PipeNameTakenException) { taken.Add(pid); continue; }
                    Announce(pid, pids, taken);
                    return Serve(pid, claim);
                }

                var state = string.Join(",", pids);
                if (state != shown)
                {
                    shown = state;
                    if (pids.Count == 0)
                        _p.Console.WriteLine("Looking for a TwinCAT XAE window... (close this window to stop the bridge)");
                    else
                    {
                        _p.Console.WriteLine($"Every open XAE window is {Served}:");
                        foreach (var pid in pids) _p.Console.WriteLine("  " + Window(pid));
                        _p.Console.WriteLine("Waiting for one of them to become free... (close this window to stop the bridge)");
                    }
                }
                _p.Wait(ScanEvery);
            }
        }
        catch (Exception ex)
        {
            _p.Log(VoltLogLevel.Error, $"twincat bridge FAILED to start: {ex.Message}");
            _p.Console.WriteLine($"The bridge could not start: {ex.Message}");
            _p.Console.WriteLine("Press Enter to close this window.");
            _p.WaitForEnter();
            return 3;
        }
    }

    private void Announce(int pid, IReadOnlyList<int> pids, List<int> taken)
    {
        _p.Console.WriteLine($"Serving TwinCAT XAE {Window(pid)}.");
        var others = pids.Where(o => o != pid).ToList();
        if (others.Count == 0) return;
        _p.Console.WriteLine("Other open XAE windows:");
        foreach (var o in others) _p.Console.WriteLine("  " + Window(o) + (taken.Contains(o) ? $"  ({Served})" : ""));
        if (others.Any(o => !taken.Contains(o))) _p.Console.WriteLine("Run this bridge again to serve another one.");
    }

    private string Window(int pid) => _p.Caption(pid) is { Length: > 0 } caption ? $"pid {pid} ({caption})" : $"pid {pid}";

    private int Serve(int pid, PipeNameClaim claim)
    {
        using (claim)
        {
            var pipe = claim.PipeName;
            var attached = _p.Attach(pid);
            try
            {
                using var host = new BridgePipeHost(attached.Link, claim);
                host.Start();
                _p.Log(VoltLogLevel.Info, $"twincat bridge serving on pipe {pipe} (xae pid {pid}), bridge {BridgePipeHost.Release ?? "(release unreadable)"}");
                // Only what is true once the pipe is up, whatever the attach did: the attach's own lines say what it serves.
                _p.Console.WriteLine($"Pipe {pipe} is up. Close this window to stop the bridge.");

                using var stop = _p.Stop();
                // The relay tunnel, exactly as CODESYS starts it: the same Core helper, so the two vendors cannot drift.
                var tunnel = Volt.Relay.PipeHostTunnel.StartIfConfigured(
                    Volt.Relay.PipeHostTunnel.DirectoryOf(typeof(BridgePipeHost)),
                    pipe,
                    BeckhoffDriver.Row.Id,
                    BridgePipeHost.Release,   // the release health reports (design D3), never the assembly version
                    m => _p.Log(VoltLogLevel.Info, m),
                    m => _p.Log(VoltLogLevel.Error, m),
                    out _);
                stop.Wait();
                _p.Log(VoltLogLevel.Info, $"twincat bridge stopping (pipe {pipe})");
                tunnel?.Dispose();
                return 0;
            }
            finally { attached.Detach(); }
        }
    }

    // ── the machine ──────────────────────────────────────────────────────────────────────────────────────────────

    internal static Parts Production() => new()
    {
        Pids = ScanRot,
        PipeName = pid => PipeNames.Instance(BeckhoffDriver.Row.Id, pid),
        Claim = PipeServer.TakeName,
        Caption = CaptionOf,
        Attach = AttachSta,
        Console = System.Console.Out,
        WaitForEnter = () => System.Console.ReadLine(),
        Wait = Thread.Sleep,
        Stop = () => new WindowStop(),
        Log = VoltLog.Log,
    };

    /// <summary>The ROT is a COM call and must run on an STA thread, as every other one here.</summary>
    private static IReadOnlyList<int> ScanRot()
    {
        var found = new List<int>();
        var scan = new Thread(() =>
        {
            try { ComMessageFilter.Register(); found.AddRange(RotInstances.ListPidsByName()); }
            catch (Exception ex) { VoltLog.Warn("XAE scan failed: " + ex.Message); }
        });
        scan.SetApartmentState(ApartmentState.STA);
        scan.Start();
        scan.Join();
        return found;
    }

    /// <summary>The window title (user32, no COM): readable while that XAE is busy.</summary>
    private static string CaptionOf(int pid)
    {
        try { using var p = Process.GetProcessById(pid); return p.MainWindowTitle; }
        catch (Exception ex) when (ex is ArgumentException or InvalidOperationException) { return ""; }   // gone
    }

    /// <summary>Attach to the one XAE window by pid and serve what it has open — its first TwinCAT project, or the
    /// first one opened later (the health poll takes it up). Not attachable yet: stay degraded; the driver re-acquires
    /// the same pid on a content op or a recovery.</summary>
    private static Attached AttachSta(int pid)
    {
        var driver = new BeckhoffDriver();
        var link = HostLink.Of(driver);
        var cts = new CancellationTokenSource();
        var sta = new Thread(() =>
        {
            ComMessageFilter.Register(); // must run on the STA thread that makes the COM calls
            try { driver.Connect(pid); link.RefreshHealth(); }
            catch (Exception ex) { link.Session.MarkDegraded($"waiting for TwinCAT XAE pid {pid} ({ex.Message})"); }
            // Can XAE's Solution Explorer be read from here at all (DIALECT C2t)? Asked once, so health says it before
            // any op. A check that cannot RUN is no verdict: the first read decides then, with the same sentence.
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
        return new Attached(link, cts.Cancel);
    }

    /// <summary>The three ways a served worker stops: the connector kills it (no managed code runs; the relay sees
    /// 1006), Ctrl+C, and a person closing the window. The window close is CTRL_CLOSE_EVENT, which .NET surfaces as
    /// SIGHUP; Windows ends the process as soon as that handler RETURNS, so the handler waits for the teardown
    /// (<see cref="Dispose"/>) — the relay gets 1001 <c>bridge stopping</c>, bounded: the tunnel's close waits at most
    /// ~1 s, and the OS allows the handler ~5 s.</summary>
    private sealed class WindowStop : IStop
    {
        private readonly ManualResetEventSlim _done = new(false);
        private readonly ManualResetEventSlim _stopped = new(false);
        private readonly PosixSignalRegistration _windowClosing;

        public WindowStop()
        {
            System.Console.CancelKeyPress += (_, e) => { e.Cancel = true; _done.Set(); };
            _windowClosing = PosixSignalRegistration.Create(PosixSignal.SIGHUP,
                ctx => { ctx.Cancel = true; _done.Set(); _stopped.Wait(TimeSpan.FromSeconds(4)); });
        }

        public void Wait() => _done.Wait();

        public void Dispose()
        {
            _stopped.Set();
            _windowClosing.Dispose();
        }
    }
}
