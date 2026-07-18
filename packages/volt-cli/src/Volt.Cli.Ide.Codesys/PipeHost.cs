using System;
using Volt.Cli.Core.Diagnostics;
using Volt.Cli.Host;
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
    private static readonly object _gate = new();

    public static bool IsRunning => _host is not null;

    public static string Start(object? projects, object? system, object? online)
    {
        lock (_gate)
        {
            if (IsRunning) return $"Volt bridge already running on pipe {PipeNames.Codesys}";

            VoltLog.Init("codesys");
            VoltLog.Info($"in-proc bridge starting on pipe {PipeNames.Codesys}");

            _driver = new CodesysDriver(projects);
            _driver.Connect(); // snapshot on the primary thread (we are on it now)

            _host = new BridgePipeHost(_driver, PipeNames.Codesys);
            try { _host.Start(); }
            catch (Exception ex)
            {
                VoltLog.Error($"in-proc bridge start failed: {ex.Message}");
                _host = null;
                _driver = null;
                return "Volt bridge FAILED to start: " + ex.Message;
            }

            var where = _driver.IsConnected ? "connected to IDE" : "no IDE engine";
            return $"Volt bridge started on pipe {PipeNames.Codesys} ({where})";
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
