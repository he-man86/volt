using System;
using Volt.Bridge.Core.Wire;

namespace Volt.Bridge.Codesys;

/// <summary>Entry point the CODESYS script command calls: <c>Host.Start(projects, system, online)</c>.
/// Builds the <see cref="CodesysDriver"/> and serves it through the shared <see cref="BridgeHttpServer"/>
/// — the same host the TwinCAT bridge uses. All bridge logic is in C#; the IronPython side is only a
/// launcher.</summary>
public static class Host
{
    /// <summary>Bridge port — 8556 by default, overridable via VOLT_BRIDGE_PORT (e.g. to run a headless
    /// dev instance alongside a live IDE that already holds 8556).</summary>
    public static int Port =>
        int.TryParse(Environment.GetEnvironmentVariable("VOLT_BRIDGE_PORT"), out var p) ? p : 8556;

    private static BridgeHttpServer? _server;
    private static CodesysDriver? _driver;
    private static readonly object _gate = new();

    public static bool IsRunning => _server?.IsRunning == true;

    public static string Start(object? projects, object? system, object? online)
    {
        lock (_gate)
        {
            if (IsRunning) return $"Volt bridge already running on http://127.0.0.1:{Port}";

            _driver = new CodesysDriver(projects);
            _driver.Connect();   // snapshot on the primary thread (we are on it now)

            _server = new BridgeHttpServer(_driver, Port);
            try { _server.Start(); }
            catch (Exception ex) { _server = null; _driver = null; return "Volt bridge FAILED to start: " + ex.Message; }

            var where = _driver.IsConnected ? "connected to IDE" : "no IDE engine";
            return $"Volt bridge started on http://127.0.0.1:{Port} ({where})";
        }
    }

    public static string Stop()
    {
        lock (_gate)
        {
            if (_server == null || !_server.IsRunning) return "Volt bridge was not running";
            _server.Stop();
            _server = null;
            _driver = null;
            return "Volt bridge stopped";
        }
    }
}
