using VoltBridge.Core.Errors;
using VoltBridge.Core.Models;

namespace VoltBridge.Core.Handlers;

public static class HealthHandler
{
    public static HealthResponse Handle(IAdapter adapter)
    {
        var data = adapter.BuildHealthResponse();
        var json = System.Text.Json.JsonSerializer.Serialize(data);
        var doc = System.Text.Json.JsonDocument.Parse(json);
        var root = doc.RootElement;

        return new HealthResponse
        {
            Status = root.GetProperty("status").GetString() ?? "unavailable",
            Platform = root.GetProperty("platform").GetString() ?? "",
            PlatformVariant = root.TryGetProperty("platformVariant", out var pv) ? pv.GetString() : null,
            Connected = root.GetProperty("connected").GetBoolean(),
            IdeAlive = root.GetProperty("ideAlive").GetBoolean(),
            Degraded = root.GetProperty("degraded").GetBoolean(),
            DegradedReason = root.GetProperty("degradedReason").GetString(),
            IdeName = root.TryGetProperty("ideName", out var n) ? n.GetString() : null,
            IdeVersion = root.TryGetProperty("ideVersion", out var v) ? v.GetString() : null,
            Version = root.GetProperty("version").GetString() ?? "",
            ProjectName = root.TryGetProperty("projectName", out var pn) ? pn.GetString() : null,
            PlcProjectName = root.TryGetProperty("plcProjectName", out var ppn) ? ppn.GetString() : null,
            ProjectDirty = root.TryGetProperty("projectDirty", out var pd) ? pd.GetBoolean() : null,
        };
    }
}
