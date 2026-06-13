using System;
using VoltBridge.Core.Http;

namespace VoltBridge.Codesys
{
    /// <summary>
    /// Entry point the CODESYS script command calls: Host.Start(projects, system, online).
    /// Builds the real CodesysAdapter and serves it through the shared HttpBridgeServer
    /// (the same host the Beckhoff bridge uses). All bridge logic is in C#; the
    /// IronPython side is only a launcher.
    /// </summary>
    public static class Host
    {
        public const int Port = 8556;

        private static HttpBridgeServer? _server;
        private static CodesysAdapter? _adapter;
        private static readonly object _gate = new object();

        public static bool IsRunning => _server?.IsRunning == true;

        public static string Start(object? projects, object? system, object? online)
        {
            lock (_gate)
            {
                if (IsRunning)
                    return $"Volt bridge already running on http://127.0.0.1:{Port}";

                _adapter = new CodesysAdapter(projects, system, online);
                _adapter.Connect(); // snapshot on the primary thread (we are on it now)

                _server = new HttpBridgeServer(_adapter, Port);
                try { _server.Start(); }
                catch (Exception ex) { _server = null; _adapter = null; return "Volt bridge FAILED to start: " + ex.Message; }

                var where = _adapter.IsConnected ? "connected to IDE" : "no IDE engine";
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
                _adapter = null;
                return "Volt bridge stopped";
            }
        }
    }
}
