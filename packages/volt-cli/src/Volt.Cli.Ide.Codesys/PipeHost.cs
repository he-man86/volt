using System;
using System.Diagnostics;
using Volt.Engine.Diagnostics;
using Volt.Engine.Wire;
using Volt.Cli.Transport;

namespace Volt.Cli.Ide.Codesys;

/// <summary>
/// The entry point the CODESYS script command calls: <c>PipeHost.Start(projects, system, online)</c>. Builds the
/// REAL <see cref="CodesysDriver"/> and serves it over the NAMED PIPE (<see cref="BridgePipeHost"/>) — the pipe
/// replacement for the backup's <c>Host.cs</c> + <c>BridgeHttpServer</c>. All bridge logic stays in Core; the
/// IronPython side is only a launcher. (Cannot be unit-tested off a live CODESYS — validated by the black-box net
/// against a headless IDE.)
/// </summary>
public static class PipeHost
{
    private static BridgePipeHost? _host;
    private static CodesysDriver? _driver;
    private static string _pipeName = PipeNames.Codesys;
    private static readonly object _gate = new();

    public static bool IsRunning => _host is not null;

    public static string Start(object? projects, object? system, object? online)
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

            VoltLog.Init("codesys");
            VoltLog.Info($"in-proc bridge starting on pipe {_pipeName}");

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

            var where = _driver.IsConnected ? "connected to IDE" : "no IDE engine";
            return $"Volt bridge started on pipe {_pipeName} ({where})";
        }
    }

    public static string Stop()
    {
        lock (_gate)
        {
            if (_host is null) return "Volt bridge was not running";
            _host.Stop();
            _driver?.Disconnect(); // drop change-event handlers from the singleton ObjectManager (no leak on restart)
            _host = null;
            _driver = null;
            return "Volt bridge stopped";
        }
    }
}
