using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;

using Volt.Contracts;
using Volt.Engine.Ide;
using Volt.Engine.Item;
using Volt.Engine.Seam;

namespace Volt.Engine.Sync;

/// <summary><c>build</c>: compile the project and return success + typed diagnostics. A failed build is
/// reported as <c>success:false</c> + diagnostics, not an error frame — the client wants the diagnostics.</summary>
public static class BuildService
{
    public static BuildResponse Handle(HostLink link, BuildRequest request, Action<ProgressFrame>? onProgress = null)
    {
        // Guard OUTSIDE the try/catch below — else WRONG_PROJECT/PLC_DISCONNECTED would be swallowed into a fake
        // "build failed" diagnostic instead of surfacing as a proper error frame.
        OpGuard.RequireBinding(link, Ops.Build, request.ExpectedPlatform, request.ExpectedProjectName);

        // ONE walk names the diagnostics, the driver's and the promotion's, and states the applications a named build is
        // checked against: made when first asked, never twice.
        HostWalk? walked = null;
        HostWalk Walk() => walked ??= link.Driver.Walk();
        // Also outside the try/catch: an unknown root is the caller's error, not a failed build.
        var applications = request.Applications is { } named ? Selected(named, Walk().Applications) : null;

        var sw = Stopwatch.StartNew();
        try
        {
            // A build is opaque to the bridge (one IDE call), so progress is indeterminate — a phase, no fraction.
            onProgress?.Invoke(new ProgressFrame { Operation = Ops.Build, Phase = "building" });
            // ONE kind of build. A clean (CODESYS CleanAll, TwinCAT SolutionBuild.Clean) is reachable but buys nothing:
            // measured on live CODESYS 3.5.21.40, the build after a clean does not recompile (~60 ms vs ~2100 ms cold) —
            // it discards online-change data, not the language model — so `--full` was deleted rather than wired to it.
            var success = link.Driver.Build(applications);
            sw.Stop();
            var diagnostics = link.Driver.GetBuildDiagnostics(Walk).ToList();
            // GUARDED, like `TreeNav.PruneEmptied` in PushService and for the same reason. This walks the live
            // tree and reads items, where a COM fault is an ordinary event — and it is pure DECORATION. Letting
            // one throw reach the catch below would turn a build that ran, compiled and produced real
            // diagnostics into `success:false` plus one fabricated "Build failed" line, discarding every
            // diagnostic the engineer actually needs. Nameless diagnostics beat no diagnostics.
            try { PromoteNames(link, Walk, diagnostics); }
            catch (Exception ex) { VoltLog.Warn($"build: could not name the diagnostics ({ex.Message}) — reporting them without item names"); }
            var errors = diagnostics.Count(d => d.Severity == Severity.Error);
            var warnings = diagnostics.Count(d => d.Severity == Severity.Warning);
            // Info, not Debug (openspec relay-outcome-ledger 2.1): the one record a default log keeps that a build ran,
            // for the CLI as for the relay, whose own terminal line carries the request id.
            VoltLog.Info($"build {(success ? "succeeded" : "failed")} ({sw.ElapsedMilliseconds}ms) — {errors} errors, {warnings} warnings");
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

    /// <summary>The applications a build names, in the IDE's spelling and the walk's order — the roots <c>refs</c>
    /// publishes, matched ignoring case as every path on this wire is. A root the project does not hold is refused by
    /// name, and so is an empty list (it would build nothing and report success), before anything is built.</summary>
    private static List<string> Selected(IReadOnlyCollection<string> named, IReadOnlyList<string> held)
    {
        if (named.Count == 0)
            throw new BridgeException(BridgeErrorCodes.BadRequest,
                "build: `applications` is empty — name at least one application root, or omit it to build every application");
        var unknown = named.Where(n => !held.Contains(n, StringComparer.OrdinalIgnoreCase)).ToList();
        if (unknown.Count > 0)
            throw new BridgeException(BridgeErrorCodes.BadRequest,
                $"build: the project holds no application {string.Join(", ", unknown.Select(u => $"'{u}'"))} — "
                + $"its applications are {string.Join(", ", held.Select(h => $"'{h}'"))}; nothing was built");
        return held.Where(h => named.Contains(h, StringComparer.OrdinalIgnoreCase)).ToList();
    }

    /// <summary>Turn each diagnostic's item into its wire PATH, or into null.
    ///
    /// <para>A driver answers with what its vendor gave it: the item's folder and bare name (<c>&lt;folder&gt;/&lt;bare&gt;</c>,
    /// the walk's folder — CODESYS resolves <c>IMessage.ObjectGuid</c> to a walked node), or the bare name alone (TwinCAT
    /// takes the stem of the file path in its output pane). Neither is a wire path, because a path ends in
    /// <c>name.kind</c> and the kind is the item's materialization's to state. So the promotion happens here, above the
    /// seam, through the same <c>Versioning.SafeVersion(...).Identity</c> every other map on this wire is keyed by. A
    /// folder-qualified name resolves in its folder alone, so the same message in two applications is two diagnostics,
    /// each on its own application's item (openspec multi-application-tree, design §6).</para>
    ///
    /// <para>AMBIGUITY RESOLVES TO NULL, not to a guess. IEC guarantees unique names within a kind, not across
    /// them: <c>CM_Carrier.pou</c> and <c>CM_Carrier.visualization</c> both exist in real projects, and a bare
    /// `CM_Carrier` from the vendor names one of them without saying which. Publishing either would point a
    /// client's editor at the wrong file. A diagnostic that carries a <see cref="BridgeDiagnostic.Member"/> is the
    /// exception that is not a guess: it is inside a method, property or action, and only an item whose kind HOLDS
    /// members (its kind's shape holds members) can be its parent - the visualization cannot, so the FB is the
    /// one.</para>
    ///
    /// <para>THE MEMBER GOES WITH THE NAME. <see cref="BridgeDiagnostic.Member"/> is the CHILD of the name, so a
    /// diagnostic whose name resolves to nothing - unknown, still ambiguous, unreadable, or a walk that threw -
    /// publishes no member either: <c>{name: null, member: "Execute"}</c> is a child of nothing, and no client can
    /// tell whose <c>Execute</c> it is.</para>
    ///
    /// <para>Costs a tree walk plus a read of the NAMED items only, and only when a diagnostic carried a name
    /// at all — a clean build walks nothing. The walk is the build's one (<paramref name="walk"/>): the driver that
    /// named the diagnostics from the tree — CODESYS turning `IMessage.ObjectGuid` into a bare name, TwinCAT placing a
    /// compiler file in its PLC project — walked it through the same call, so nothing is walked twice. The expensive
    /// part — materializing an item to learn its kind — happens here and only for the named ones.</para></summary>
    private static void PromoteNames(HostLink link, Func<HostWalk> walk, List<BridgeDiagnostic> diagnostics)
    {
        // CLEARED FIRST, assigned last. What the drivers put here is a BARE name, and the field's contract is
        // FULL or null — so between those two instants the only safe value is null. If the walk below throws
        // (the caller catches it: naming is decoration, not the build) the diagnostics keep the nulls rather
        // than escaping with the vendor's spelling still on them - and the member, a child of that name, with it.
        var bare = diagnostics.Select(d => (Name: d.Name, Member: d.Member)).ToList();
        foreach (var d in diagnostics) { d.Name = null; d.Member = null; }

        var wanted = new HashSet<string>(
            bare.Select(b => b.Name).Where(n => !string.IsNullOrEmpty(n)).Select(n => ItemPath.FileOf(n!)),
            StringComparer.OrdinalIgnoreCase);
        if (wanted.Count == 0) return;

        // null value = the name matched more than one item, so it names none of them. Each item is recorded under its
        // bare name AND under its folder + bare name, so a driver that names the folder is answered from it alone.
        // `holders` is the same map over the items that can hold a member, which is where a diagnostic carrying one is
        // looked up.
        var resolved = new Dictionary<string, string?>(StringComparer.OrdinalIgnoreCase);
        var holders = new Dictionary<string, string?>(StringComparer.OrdinalIgnoreCase);
        foreach (var pi in walk().Items)
        {
            if (!wanted.Contains(pi.Name)) continue;
            var kind = pi.Kind;
            // Only an item that MATERIALIZED has a path. `Identity` falls back to the BARE name for one that could not be
            // (`VersionedItem`) — and a failing build is exactly when that item is present, since an unreadable body is
            // the sort of thing a compiler complains about. Publishing that would break the one promise this field makes.
            var v = Versioning.SafeVersion(link, pi.Name, kind, pi.Item, pi.Folder);
            if (v.Materialized is null) continue;
            var identity = v.Identity;
            var barePath = ItemPath.Of(pi.Folder, pi.Name);
            Record(resolved, pi.Name, identity);
            Record(resolved, barePath, identity);
            if (link.Catalog.Kinds.Find(kind)?.Shape?.Members == true)
            {
                Record(holders, pi.Name, identity);
                Record(holders, barePath, identity);
            }
        }

        for (var i = 0; i < diagnostics.Count; i++)
        {
            if (bare[i].Name is not { } name) continue;
            var map = bare[i].Member is null ? resolved : holders;
            diagnostics[i].Name = map.TryGetValue(name, out var full) ? full : null;
            if (diagnostics[i].Name is null)
                VoltLog.Debug($"build: a diagnostic named '{name}', which resolves to no single readable item — "
                              + "reporting it without a name rather than pointing at the wrong file");
            else diagnostics[i].Member = bare[i].Member;
        }
    }

    private static void Record(Dictionary<string, string?> map, string bare, string identity)
    {
        if (map.TryGetValue(bare, out var seen))
        {
            if (!string.Equals(seen, identity, StringComparison.OrdinalIgnoreCase)) map[bare] = null;
        }
        else map[bare] = identity;
    }
}
