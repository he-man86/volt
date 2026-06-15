using VoltBridge.Core.Models;

namespace VoltBridge.Core.Handlers;

public static class BuildHandler
{
    public static BuildResponse Handle(IAdapter adapter, BuildRequest request)
    {
        if (!adapter.IsConnected) throw BridgeException.PlcDisconnected();

        var sw = System.Diagnostics.Stopwatch.StartNew();
        try
        {
            adapter.FlushPendingWrites();
            var success = adapter.Build();
            sw.Stop();

            var diag = adapter.GetBuildDiagnostics();
            return new BuildResponse
            {
                Success = success,
                Duration = sw.ElapsedMilliseconds,
                Diagnostics = diag.Select(d =>
                {
                    var dict = (Dictionary<string, object?>)d;
                    return new BridgeDiagnostic
                    {
                        Severity = dict.TryGetValue("severity", out var s) ? (string?)s ?? "info" : "info",
                        Message = dict.TryGetValue("message", out var m) ? (string?)m ?? "" : "",
                        Line = dict.TryGetValue("line", out var l) && l is int li ? li : 0,
                    };
                }).ToList(),
            };
        }
        catch (Exception ex)
        {
            sw.Stop();
            return new BuildResponse
            {
                Success = false,
                Duration = sw.ElapsedMilliseconds,
                Diagnostics = new List<BridgeDiagnostic>
                {
                    new() { Severity = "error", Message = "Build failed: " + ex.Message }
                },
            };
        }
    }
}
