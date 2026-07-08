using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using Volt.Bridge.Core.Ide;
using Volt.Bridge.Core.Wire;

namespace Volt.Bridge.Core.Sync;

/// <summary><c>/build</c>: compile the project and return success + typed diagnostics. A thrown build
/// is reported as a failed BuildResponse (the client wants the diagnostics, not a 500).</summary>
public static class BuildService
{
    public static BuildResponse Handle(IIdeDriver ide, BuildRequest request, Action<ProgressFrame>? onProgress = null)
    {
        if (!ide.IsConnected) throw BridgeException.PlcDisconnected();

        var sw = Stopwatch.StartNew();
        try
        {
            // A build is opaque to the bridge (one IDE call), so progress is indeterminate — a phase, no fraction.
            onProgress?.Invoke(new ProgressFrame { Operation = "build", Phase = "building" });
            ide.FlushPendingWrites();
            var success = ide.Build();
            sw.Stop();
            return new BuildResponse
            {
                Success = success,
                Duration = sw.ElapsedMilliseconds,
                Diagnostics = ide.GetBuildDiagnostics().ToList(),
            };
        }
        catch (Exception ex)
        {
            sw.Stop();
            return new BuildResponse
            {
                Success = false,
                Duration = sw.ElapsedMilliseconds,
                Diagnostics = new List<BridgeDiagnostic> { new() { Severity = "error", Message = "Build failed: " + ex.Message } },
            };
        }
    }
}
