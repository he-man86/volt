using System;
using System.Net.Http;
using System.Text.Json;
using System.Threading.Tasks;

namespace Volt.Bridge.Connector
{
    /// <summary>At-a-glance bridge state, derived from the same /health the CLI and
    /// extension read. Distinguishes "worker not up" (Unreachable) from "IDE not ready"
    /// (Unavailable) so the tray can say the right thing.</summary>
    public enum BridgeStatus
    {
        Unknown,
        Connected,    // healthy
        Degraded,     // channel had recent errors but still serving
        Unavailable,  // bridge up, but no IDE/project
        Unreachable,  // nothing listening on the port
    }

    public static class HealthProbe
    {
        private static readonly HttpClient Http = new() { Timeout = TimeSpan.FromSeconds(2) };

        public static async Task<BridgeStatus> ProbeAsync(int port)
        {
            try
            {
                var json = await Http.GetStringAsync($"http://127.0.0.1:{port}/health").ConfigureAwait(false);
                using var doc = JsonDocument.Parse(json);
                var status = doc.RootElement.TryGetProperty("status", out var s) ? s.GetString() : null;
                return status switch
                {
                    "healthy" => BridgeStatus.Connected,
                    "degraded" => BridgeStatus.Degraded,
                    "unavailable" => BridgeStatus.Unavailable,
                    _ => BridgeStatus.Unknown,
                };
            }
            catch
            {
                return BridgeStatus.Unreachable;
            }
        }

        public static string Describe(BridgeStatus s) => s switch
        {
            BridgeStatus.Connected => "connected",
            BridgeStatus.Degraded => "degraded",
            BridgeStatus.Unavailable => "no project loaded",
            BridgeStatus.Unreachable => "not running",
            _ => "unknown",
        };
    }
}
