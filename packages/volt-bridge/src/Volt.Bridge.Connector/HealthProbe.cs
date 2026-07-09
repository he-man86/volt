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

    public sealed class BridgeHealth
    {
        public BridgeStatus Status { get; init; }
        public string? ProjectName { get; init; }
        public bool ProjectDirty { get; init; }
    }

    public static class HealthProbe
    {
        private static readonly HttpClient Http = new() { Timeout = TimeSpan.FromSeconds(2) };

        public static async Task<BridgeHealth> ProbeAsync(int port)
        {
            try
            {
                var json = await Http.GetStringAsync($"http://127.0.0.1:{port}/health").ConfigureAwait(false);
                using var doc = JsonDocument.Parse(json);
                var root = doc.RootElement;
                return new BridgeHealth
                {
                    Status = root.TryGetProperty("status", out var s) ? s.GetString() switch
                    {
                        "healthy" => BridgeStatus.Connected,
                        "degraded" => BridgeStatus.Degraded,
                        "unavailable" => BridgeStatus.Unavailable,
                        _ => BridgeStatus.Unknown,
                    } : BridgeStatus.Unknown,
                    ProjectName = TryString(root, "projectName"),
                    ProjectDirty = root.TryGetProperty("projectDirty", out var d) && d.GetBoolean(),
                };
            }
            catch
            {
                return new BridgeHealth { Status = BridgeStatus.Unreachable };
            }
        }

        private static string? TryString(JsonElement el, string name) =>
            el.TryGetProperty(name, out var v) && v.ValueKind != JsonValueKind.Null ? v.GetString() : null;

        public static string Describe(BridgeHealth h)
        {
            var proj = h.ProjectName != null
                ? $" — {h.ProjectName}{(h.ProjectDirty ? " *" : "")}"
                : "";
            return h.Status switch
            {
                BridgeStatus.Connected => $"connected{proj}",
                BridgeStatus.Degraded => $"degraded{proj}",
                BridgeStatus.Unavailable => "no project loaded",
                BridgeStatus.Unreachable => "not running",
                _ => "unknown",
            };
        }
    }
}
