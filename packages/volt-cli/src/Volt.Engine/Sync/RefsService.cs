using System;
using System.Collections.Generic;
using System.Diagnostics;

using Volt.Contracts;
using Volt.Engine.Ide;
using Volt.Engine.Item;

namespace Volt.Engine.Sync;

/// <summary><c>refs</c>: the project snapshot — the aggregate <c>projectVersion</c> plus the per-item version
/// map (keyed by each item's path) and the applications, for every tracked item.
/// It comes from the ONE walk (<c>ProjectSnapshot</c>) the <c>push</c> receipt also uses, so the two can
/// never drift. No source bodies — that is <c>fetch</c>.</summary>
public static class RefsService
{
    public static RefsResponse Handle(IIdeDriver ide, RefsRequest? req = null, Action<ProgressFrame>? onProgress = null)
    {
        // Connected + right-project guard, the same one every other project-touching op runs — atomic with the walk.
        // `req` (and each of its fields) is optional: a body-less refs checks only connected (discovery). A BOUND
        // caller gets "is the bridge on my project?" answered here, not from the throttled health cache.
        var bound = OpGuard.RequireBoundProject(ide, req?.ExpectedPlatform, req?.ExpectedProjectName);

        var sw = Stopwatch.StartNew();
        var snap = ProjectSnapshot.Walk(ide, onProgress, Ops.Refs);

        var hit = new List<string>();
        if (snap.Unmapped > 0) hit.Add($"{snap.Unmapped} unmapped-kind");
        if (snap.Unreadable.Count > 0) hit.Add($"{snap.Unreadable.Count} unreadable: {string.Join(", ", snap.Unreadable)}");
        VoltLog.Debug($"refs: {snap.FullVersions.Count} items{(hit.Count > 0 ? $" (skipped: {string.Join(", ", hit)})" : "")} ({sw.ElapsedMilliseconds}ms)");

        return new RefsResponse
        {
            ProjectVersion = snap.ProjectVersion,
            UnwalkedFolders = snap.UnwalkedFolders,
            Items = snap.FullVersions,
            Applications = snap.Applications,
            // The items the walk found and could not materialize. They are tracked in the version hash above but
            // deliberately absent from `Items` — naming them here is the only way a client can tell the
            // difference between "this project has no such POU" and "Volt could not read it".
            Unreadable = snap.Unreadable,
            // What of the client's baseline is gone — by the rule `fetch` uses (`Removal`), so `volt status` and
            // `volt pull` read one answer. A refs sent no baseline (discovery, an older client) reports none.
            Removed = req?.KnownItems is { } known
                ? Removal.Removed(known.Keys, snap.FullVersions.Keys, snap.UnreadableKinds, snap.UnwalkedFolders, snap.Applications, req.KnownApplications)
                : new List<string>(),
            // THE PROJECT THIS WALK IS OF, atomic with the walk, as `fetch` echoes it: a caller that asked WITHOUT a
            // binding (discovery, the e2e harness) learns what the version map is a map OF.
            Platform = bound.Vendor,
            ProjectName = bound.ProjectName,
        };
    }
}
