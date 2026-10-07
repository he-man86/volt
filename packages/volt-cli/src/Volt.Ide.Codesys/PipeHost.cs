using System;
using System.Diagnostics;
using System.Threading;
using Volt.Wire;
using Volt.Contracts;
using Volt.Engine.Host;

namespace Volt.Ide.Codesys;

/// <summary>
/// The entry point the CODESYS script command calls: <c>PipeHost.Start(projects, system, online)</c>. Builds the
/// REAL <see cref="CodesysDriver"/> and serves it over the NAMED PIPE (<see cref="BridgePipeHost"/>). All bridge
/// logic stays in Core; the IronPython side is only a launcher. (Cannot be unit-tested off a live CODESYS — validated by the black-box net
/// against a headless IDE.)
/// </summary>
public static class PipeHost
{
    private static BridgePipeHost? _host;
    private static Volt.Relay.RelayTunnel? _tunnel;
    private static CodesysDriver? _driver;
    private static string _pipeName = PipeNames.Codesys;
    private static readonly object _gate = new();

    public static bool IsRunning => _host is not null;

    public static string Start(object? projects, object? system, object? online) =>
        Start(projects, p => new CodesysDriver(p), logDir: null);

    /// <summary>The start over a given driver and log folder — the offline tests drive the real start sequence over a
    /// <see cref="CodesysDriver"/> on doubles and read its log (openspec ide-identity-report: the start log is the field
    /// evidence for 3.1/3.2). Production passes the real driver and the durable log folder.</summary>
    internal static string Start(object? projects, Func<object?, CodesysDriver> newDriver, string? logDir)
    {
        lock (_gate)
        {
            if (IsRunning) return $"Volt bridge already running on pipe {_pipeName}";

            // Each CODESYS process serves its OWN pipe so multiple instances coexist without colliding. VOLT_PIPE
            // overrides (the headless dev loop + e2e pin a fixed name); otherwise it's volt.bridge.codesys.<pid>.
            var overridePipe = Environment.GetEnvironmentVariable("VOLT_PIPE");
            _pipeName = string.IsNullOrEmpty(overridePipe)
                ? PipeNames.CodesysInstance(Process.GetCurrentProcess().Id)
                : overridePipe!;

            VoltLog.Init(Vendors.Codesys, logDir);
            // Info, and with the pid: every CODESYS process appends to the SAME daily codesys log, so this header is
            // what separates one session's start block from another's in a field log. And the file this session loaded
            // the bridge from (the staged copy, or the bundle itself when staging failed): the bridge is ONE assembly
            // with every dependency merged in (openspec codesys-bridge-single-assembly), so that is all of Volt's here.
            VoltLog.Info($"in-proc bridge starting on pipe {_pipeName} (CODESYS pid {Pid}) from {typeof(PipeHost).Assembly.Location}");

            _driver = newDriver(projects);
            // The identity health reports, as read — so the first OEM log is the evidence (DIALECT V1/V4): the exe's
            // own product name sits beside OEMCustomization's, to show whether the two part (design B2).
            VoltLog.Info(_driver.IdentityLine());
            _driver.Connect(); // snapshot on the primary thread (we are on it now)

            _host = new BridgePipeHost(_driver, _pipeName);
            try { _host.Start(); }
            catch (Exception ex)
            {
                VoltLog.Error($"in-proc bridge start failed: {ex.Message}");
                _host = null;
                _driver = null;
                return "Volt bridge FAILED to start: " + ex.Message;
            }

            // The tunnel, if this install has one. Started AFTER the pipe is up, because it is a pipe
            // CLIENT: every request it accepts becomes an ordinary local pipe call, so there is still one
            // entry point to the engine and every guard sits on it.
            //
            // No sidecar file means no tunnel, no socket, and a bridge that behaves exactly as it does
            // today. That is the default, and it is why this cannot regress a local install.
            StartTunnelIfConfigured();

            // An IDE lacking what the bridge needs: the pipe is up (so every client gets IDE_UNSUPPORTED with the reason
            // rather than no bridge at all), but it serves nothing, and this line — printed to the CODESYS message
            // window by start_volt_codesys.py — says so instead of "connected".
            if (_driver.Unsupported is { } reason)
            {
                var product = _driver.OemProduct is { } p ? $"{p}: " : "";
                VoltLog.Error($"CODESYS bridge on {_pipeName} serves nothing — {product}{reason}");
                return $"Volt: {product}{reason} The bridge on pipe {_pipeName} refuses every call (IDE_UNSUPPORTED).";
            }

            var where = _driver.IsConnected ? "connected to IDE" : "no project open";
            VoltLog.Info($"CODESYS bridge ready on {_pipeName} ({where})");
            var oem = _driver.OemProduct is { } o ? $"{o} on " : "";
            return $"Volt bridge started on pipe {_pipeName} ({where}, {oem}CODESYS {_driver.IdeVersion})";
        }
    }

    private static readonly int Pid = Process.GetCurrentProcess().Id;

    /// <summary>Start the relay tunnel when this install is configured for one.
    ///
    /// <para>Every failure here is logged and swallowed ON PURPOSE. The tunnel is an addition to a bridge
    /// that already works locally; taking the whole bridge down because a remote relay is unreachable, or
    /// because someone mistyped a URL, would trade a working local install for a broken one. A malformed
    /// sidecar is still loud — it is named in the log — but it is not fatal.</para></summary>
    private static void StartTunnelIfConfigured()
    {
        HookIdeExit();
        _tunnel = Volt.Relay.PipeHostTunnel.StartIfConfigured(
            Volt.Relay.PipeHostTunnel.DirectoryOf(typeof(PipeHost)),
            _pipeName,
            Vendors.Codesys,
            BridgePipeHost.Release,   // the release health reports (design D3), never the assembly version
            m => VoltLog.Info(m),
            m => VoltLog.Error(m));
    }

    private static int _exitHooked;

    /// <summary>The IDE exiting closes the relay socket with 1001 `bridge stopping`, as the stop script does (openspec
    /// bridge-close-frame) — otherwise the relay sees a 1006 it cannot tell from a platform drop. ProcessExit is the hook
    /// an in-proc plugin has; the tunnel's close is bounded at ~1 s, inside the CLR's budget for exit handlers, so a
    /// closing IDE is never held up. Only the tunnel: the pipe host and the driver go with the process. Lock-free on
    /// purpose — an exit must not wait on <see cref="_gate"/>. Subscribed once per process (it outlives a Stop/Start).</summary>
    private static void HookIdeExit()
    {
        if (Interlocked.Exchange(ref _exitHooked, 1) != 0) return;
        AppDomain.CurrentDomain.ProcessExit += (_, _) =>
        {
            var tunnel = Interlocked.Exchange(ref _tunnel, null);
            if (tunnel is null) return;
            try
            {
                VoltLog.Info($"CODESYS exiting (pid {Pid}) — closing the relay tunnel");
                tunnel.Dispose();
            }
            catch (Exception ex) { VoltLog.Warn("relay: close on exit failed: " + ex.Message); }
        };
    }

    public static string Stop()
    {
        lock (_gate)
        {
            if (_host is null) return "Volt bridge was not running";
            // Before the host: the tunnel's in-flight requests are pipe calls against it.
            try { Interlocked.Exchange(ref _tunnel, null)?.Dispose(); } catch (Exception ex) { VoltLog.Warn("relay: stop failed: " + ex.Message); }
            _host.Stop();
            // The in-proc detach. It clears the degraded flag and nothing else — there is nothing to release:
            // CodesysObjectModel registers NO change-event handlers on the singleton ObjectManager, contrary to what
            // this comment used to claim. Kept because this is the ONE production caller of IIdeSession.Disconnect():
            // the in-proc host is stopped by an IronPython script and must detach, while the TwinCAT worker dies with
            // its process — that asymmetric reachability IS the InIdeLoad/ExternalAttach lifecycle difference.
            _driver?.Disconnect();
            _host = null;
            _driver = null;
            return "Volt bridge stopped";
        }
    }
}
