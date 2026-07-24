using System;
using System.Text.Json;
using System.Threading.Tasks;
using Volt.Cli.Transport;

namespace Volt.Cli.Connector
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
        public static async Task<BridgeHealth> ProbeAsync(string vendor)
        {
            try
            {
                // The `health` op over the vendor's named pipe. Connect is blocking, so off the UI thread; a short
                // timeout maps "nothing listening" → Unreachable.
                var root = await Task.Run(() =>
                    new PipeClient(PipeNames.ForVendor(vendor)).Call(Ops.Health, connectTimeoutMs: 2000)).ConfigureAwait(false);
                return FromWire(root);
            }
            catch
            {
                return new BridgeHealth { Status = BridgeStatus.Unreachable };
            }
        }

        /// <summary>Map a `health` wire response to <see cref="BridgeHealth"/>. `health` is a FLAT array of project
        /// rows; the bridge's connection state is the ONE serving row (at most one per bridge). No serving row → the
        /// bridge is up but nothing is connected (Unavailable). Shared by the tray probe and the pipe-backed source so
        /// the status vocabulary is defined once.</summary>
        public static BridgeHealth FromWire(JsonElement root)
        {
            JsonElement? servingRow = null;
            if (root.TryGetProperty("projects", out var projects) && projects.ValueKind == JsonValueKind.Array)
                foreach (var p in projects.EnumerateArray())
                    if (p.TryGetProperty("serving", out var sv) && sv.ValueKind == JsonValueKind.True) { servingRow = p; break; }

            if (servingRow is not { } row)
                return new BridgeHealth { Status = BridgeStatus.Unavailable }; // up, but nothing served

            return new BridgeHealth
            {
                // A serving row means connected; its status word only distinguishes clean vs degraded.
                Status = row.TryGetProperty("status", out var s) && s.GetString() == HealthStatus.Degraded
                    ? BridgeStatus.Degraded
                    : BridgeStatus.Connected,
                ProjectName = TryString(row, "project"),
                ProjectDirty = row.TryGetProperty("dirty", out var d) && d.GetBoolean(),
            };
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
