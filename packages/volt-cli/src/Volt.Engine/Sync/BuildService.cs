using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;

using Volt.Contracts;
using Volt.Engine.Ide;
using Volt.Engine.Item;

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
            // GUARDED, like `TreeNav.PruneEmptied` in PushService and for the same reason. This walks the live
            // tree and reads items, where a COM fault is an ordinary event — and it is pure DECORATION. Letting
            // one throw reach the catch below would turn a build that ran, compiled and produced real
            // diagnostics into `success:false` plus one fabricated "Build failed" line, discarding every
            // diagnostic the engineer actually needs. Nameless diagnostics beat no diagnostics.
            try { PromoteNames(ide, diagnostics); }
            catch (Exception ex) { VoltLog.Warn($"build: could not name the diagnostics ({ex.Message}) — reporting them without item names"); }
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
        // A CODED ERROR IS NOT A COMPILE DIAGNOSTIC. Everything else here is genuinely "the build failed and
        // this is why", but a BridgeException is the bridge refusing — a disconnected IDE, a vendor that
        // cannot do this — and dressing it as an error-severity diagnostic told the caller the PROJECT does
        // not compile. `success:false` with a fabricated diagnostic is indistinguishable from a real failure,
        // so a client cannot tell "your code is broken" from "the build could not be attempted".
        catch (Exception ex) when (ex is not ICodedError)
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

    /// <summary>Turn each diagnostic's BARE item name into the FULL wire name, or into null.
    ///
    /// <para>A driver answers with the name its vendor gave it, which is the bare one — CODESYS resolves
    /// <c>IMessage.ObjectGuid</c> to a node, TwinCAT takes the stem of the file path in its output pane. Neither
    /// can produce a wire name, because a wire name is <c>name.kind</c> and the kind of a POU is not in its
    /// vendor kind code: it comes from the DECLARATION (`PROGRAM`/`FUNCTION_BLOCK`/`FUNCTION`), which only
    /// materialization reads. So the promotion happens here, above the seam, through the same
    /// <c>Versioning.SafeVersion(...).Identity</c> every other map on this wire is keyed by.</para>
    ///
    /// <para>AMBIGUITY RESOLVES TO NULL, not to a guess. IEC guarantees unique names within a kind, not across
    /// them: <c>CM_Carrier.fb</c> and <c>CM_Carrier.visualization</c> both exist in real projects, and a bare
    /// `CM_Carrier` from the vendor names one of them without saying which. Publishing either would point a
    /// client's editor at the wrong file.</para>
    ///
    /// <para>Costs one walk plus a read of the NAMED items only, and only when a diagnostic carried a name at
    /// all — a clean build walks nothing.</para></summary>
    private static void PromoteNames(IIdeDriver ide, List<BridgeDiagnostic> diagnostics)
    {
        var wanted = new HashSet<string>(
            diagnostics.Select(d => d.Name).Where(n => !string.IsNullOrEmpty(n))!,
            StringComparer.OrdinalIgnoreCase);
        if (wanted.Count == 0) return;

        // CLEARED FIRST, assigned last. What the drivers put here is a BARE name, and the field's contract is
        // FULL or null — so between those two instants the only safe value is null. If the walk below throws
        // (the caller catches it: naming is decoration, not the build) the diagnostics keep the nulls rather
        // than escaping with the vendor's spelling still on them.
        var bare = diagnostics.Select(d => d.Name).ToList();
        foreach (var d in diagnostics) d.Name = null;

        // null value = the bare name matched more than one item, so it names none of them.
        var resolved = new Dictionary<string, string?>(StringComparer.OrdinalIgnoreCase);
        foreach (var pi in ide.WalkItems().Items)
        {
            if (!wanted.Contains(pi.Name)) continue;
            if (ItemKind.Map(pi.KindCode) is not { } kind) continue;
            // `.Materialized?.FullName`, NOT `.Identity`. Identity falls back to the BARE name for an item that
            // could not be materialized (`VersionedItem`: `materialized?.FullName ?? bareName`) — and a failing
            // build is exactly when that item is present, since an unreadable body is the sort of thing a
            // compiler complains about. Publishing the bare name there would break the one promise this field
            // makes.
            if (Versioning.SafeVersion(ide, pi.Name, kind, pi.Item, pi.Folder).Materialized?.FullName is not { } identity)
                continue;
            if (resolved.TryGetValue(pi.Name, out var seen))
            {
                if (!string.Equals(seen, identity, StringComparison.OrdinalIgnoreCase)) resolved[pi.Name] = null;
            }
            else resolved[pi.Name] = identity;
        }

        for (var i = 0; i < diagnostics.Count; i++)
        {
            if (bare[i] is not { } name) continue;
            diagnostics[i].Name = resolved.TryGetValue(name, out var full) ? full : null;
            if (diagnostics[i].Name is null)
                VoltLog.Debug($"build: a diagnostic named '{name}', which resolves to no single readable item — "
                              + "reporting it without a name rather than pointing at the wrong file");
        }
    }
}
