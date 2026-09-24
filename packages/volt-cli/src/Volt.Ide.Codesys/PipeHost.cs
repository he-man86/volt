using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;
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

    private static int _resolverInstalled;

    /// <summary>Resolve the bridge DLL's own dependencies (System.Text.Json 8.0.0.0 + its deps) from the folder it
    /// was loaded from. CODESYS loads us via <c>clr.AddReferenceToFileAndPath</c> (Assembly.LoadFile), which does NOT
    /// add that folder to the CLR probe path — so a dependency the host process can't already satisfy fails to load.
    /// This bit only: <c>health</c> serializes <see cref="HealthResponse"/>, whose [JsonPropertyName]/[JsonIgnore]
    /// attributes force an exact System.Text.Json 8.0.0.0 bind; without this handler that throws — and since `health`
    /// is ALSO how a client discovers this bridge's project (the flat row list; there is no separate `instances` op),
    /// the connector then has nothing to offer and can't attach. Install once.</summary>
    private static void EnsureDependencyResolver()
    {
        if (Interlocked.Exchange(ref _resolverInstalled, 1) != 0) return;
        var dir = Path.GetDirectoryName(typeof(PipeHost).Assembly.Location);
        if (string.IsNullOrEmpty(dir)) return;
        AppDomain.CurrentDomain.AssemblyResolve += (_, e) =>
        {
            // Fires only after the CLR's normal resolution failed; supply the .dll if we ship it beside us.
            var path = Path.Combine(dir, new AssemblyName(e.Name).Name + ".dll");
            if (!File.Exists(path)) return null;
            try { VoltLog.Info($"resolved dependency from bridge dir: {e.Name}"); } catch { }
            return Assembly.LoadFrom(path);
        };
    }

    public static string Start(object? projects, object? system, object? online)
    {
        EnsureDependencyResolver();
        lock (_gate)
        {
            if (IsRunning) return $"Volt bridge already running on pipe {_pipeName}";

            // Each CODESYS process serves its OWN pipe so multiple instances coexist without colliding. VOLT_PIPE
            // overrides (the headless dev loop + e2e pin a fixed name); otherwise it's volt.bridge.codesys.<pid>.
            var overridePipe = Environment.GetEnvironmentVariable("VOLT_PIPE");
            _pipeName = string.IsNullOrEmpty(overridePipe)
                ? PipeNames.CodesysInstance(Process.GetCurrentProcess().Id)
                : overridePipe!;

            VoltLog.Init(Vendors.Codesys);
            VoltLog.Debug($"in-proc bridge starting on pipe {_pipeName}");

            _driver = new CodesysDriver(projects);
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

            var where = _driver.IsConnected ? "connected to IDE" : "no IDE engine";
            VoltLog.Info($"CODESYS bridge ready on {_pipeName} ({where})");
            return $"Volt bridge started on pipe {_pipeName} ({where})";
        }
    }

    /// <summary>Start the relay tunnel when this install is configured for one.
    ///
    /// <para>Every failure here is logged and swallowed ON PURPOSE. The tunnel is an addition to a bridge
    /// that already works locally; taking the whole bridge down because a remote relay is unreachable, or
    /// because someone mistyped a URL, would trade a working local install for a broken one. A malformed
    /// sidecar is still loud — it is named in the log — but it is not fatal.</para></summary>
    private static void StartTunnelIfConfigured()
    {
        _tunnel = Volt.Relay.PipeHostTunnel.StartIfConfigured(
            Volt.Relay.PipeHostTunnel.DirectoryOf(typeof(PipeHost)),
            _pipeName,
            Vendors.Codesys,
            typeof(PipeHost).Assembly.GetName().Version?.ToString() ?? "0.0.0",
            m => VoltLog.Info(m),
            m => VoltLog.Error(m));
    }

    public static string Stop()
    {
        lock (_gate)
        {
            if (_host is null) return "Volt bridge was not running";
            // Before the host: the tunnel's in-flight requests are pipe calls against it.
            try { _tunnel?.Dispose(); } catch (Exception ex) { VoltLog.Warn("relay: stop failed: " + ex.Message); }
            _tunnel = null;
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
