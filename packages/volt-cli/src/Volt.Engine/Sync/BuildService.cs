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
            // There is ONE kind of build, and `--full` is gone. This was an [UNMEASURED] marker — "can either
            // vendor be asked for a full/clean build through the surface Volt already holds?" — and measuring it
            // answered YES to the reachability and NO to the thing that made it worth having.
            //
            // Reachable, both: CODESYS `_3S.CoDeSys.ScriptDriverProjects.APEnvironment.CleanAllCommandTypeGuid`
            // dispatched via `CommandManager.ExecuteStandardCommand(guid, true)` — the guid resolves, the command
            // reports enabled, it executes. TwinCAT `EnvDTE.SolutionBuild.Clean(bool)` sits on the same object as
            // the `Build(bool)` already called.
            //
            // Useless, measured on live CODESYS 3.5.21.40: a cold build of the fixture takes ~2100ms and warm
            // builds ~30ms. After CleanAll executes, the next build still takes ~60ms — it does not recompile.
            // CODESYS's clean discards DOWNLOAD/online-change information, not the language model the build reads,
            // so it cannot surface a compile error a warm build missed. What it does do is invalidate the online
            // change data of the engineer's live project. A flag that costs a real side effect and buys no extra
            // diagnostic is worse than no flag, so the flag, its `buildType` wire field and the CLI option are
            // deleted rather than wired to it. Anyone reopening this: the missing capability is a REBUILD (drop
            // the language model), and no such command exists on the surface above — the only full compile
            // measured was the first one after the project loaded.
            var success = ide.Build();
            sw.Stop();
            var diagnostics = ide.GetBuildDiagnostics().ToList();
            var errors = diagnostics.Count(d => d.Severity == Severity.Error);
            var warnings = diagnostics.Count(d => d.Severity == Severity.Warning);
            VoltLog.Debug($"build {(success ? "succeeded" : "failed")} ({sw.ElapsedMilliseconds}ms){(errors > 0 || warnings > 0 ? $" — {errors} errors, {warnings} warnings" : "")}");
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
            VoltLog.Error($"build failed ({sw.ElapsedMilliseconds}ms): {ex.Message}");
            return new BuildResponse
            {
                Success = false,
                Duration = sw.ElapsedMilliseconds,
                Diagnostics = new List<BridgeDiagnostic> { new() { Severity = Severity.Error, Message = "Build failed: " + ex.Message } },
            };
        }
    }
}
