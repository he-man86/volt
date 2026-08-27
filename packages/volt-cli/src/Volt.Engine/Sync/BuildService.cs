using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;

using Volt.Contracts;
using Volt.Engine.Ide;

namespace Volt.Engine.Sync;

/// <summary><c>build</c>: compile the project and return success + typed diagnostics. A failed build is
/// reported as <c>success:false</c> + diagnostics, not an error frame — the client wants the diagnostics.</summary>
public static class BuildService
{
    public static BuildResponse Handle(IIdeDriver ide, BuildRequest request, Action<ProgressFrame>? onProgress = null)
    {
        // Guard OUTSIDE the try/catch below — else WRONG_PROJECT/PLC_DISCONNECTED would be swallowed into a fake
        // "build failed" diagnostic instead of surfacing as a proper error frame.
        OpGuard.RequireBoundProject(ide, request.ExpectedPlatform, request.ExpectedProjectName);

        var sw = Stopwatch.StartNew();
        try
        {
            // A build is opaque to the bridge (one IDE call), so progress is indeterminate — a phase, no fraction.
            onProgress?.Invoke(new ProgressFrame { Operation = Ops.Build, Phase = "building" });
            ide.FlushPendingWrites();
            // [UNMEASURED: whether either vendor can be asked for a FULL/clean build through the surface Volt
            //  uses. `request.BuildType` is set by `volt build --full`, reaches here, and is read only by the two
            //  log lines below — `IIdeSession.Build()` takes no argument, so --full performs an INCREMENTAL build
            //  on both vendors while `volt --help` advertises it. Wiring it means a driver-contract change plus
            //  the vendor call for each (CODESYS clean+generate, TwinCAT rebuild), and neither has been measured
            //  through the scripting/COM surface Volt actually holds. Until then the CLI says what it did rather
            //  than implying more.]
            var success = ide.Build();
            sw.Stop();
            var diagnostics = ide.GetBuildDiagnostics().ToList();
            var errors = diagnostics.Count(d => d.Severity == Severity.Error);
            var warnings = diagnostics.Count(d => d.Severity == Severity.Warning);
            VoltLog.Debug($"build {request.BuildType} {(success ? "succeeded" : "failed")} ({sw.ElapsedMilliseconds}ms){(errors > 0 || warnings > 0 ? $" — {errors} errors, {warnings} warnings" : "")}");
            return new BuildResponse
            {
                Success = success,
                Duration = sw.ElapsedMilliseconds,
                Diagnostics = diagnostics,
            };
        }
        catch (Exception ex)
        {
            sw.Stop();
            VoltLog.Error($"build {request.BuildType} failed ({sw.ElapsedMilliseconds}ms): {ex.Message}");
            return new BuildResponse
            {
                Success = false,
                Duration = sw.ElapsedMilliseconds,
                Diagnostics = new List<BridgeDiagnostic> { new() { Severity = Severity.Error, Message = "Build failed: " + ex.Message } },
            };
        }
    }
}
