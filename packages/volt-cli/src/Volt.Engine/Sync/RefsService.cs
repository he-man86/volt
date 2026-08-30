using System;
using System.Collections.Generic;
using System.Diagnostics;

using Volt.Contracts;
using Volt.Engine.Ide;
using Volt.Engine.Item;

namespace Volt.Engine.Sync;

/// <summary><c>refs</c>: the project snapshot — the aggregate versions (<c>projectVersion</c>,
/// <c>structureVersion</c>) plus the per-item version map and the folder map, for every tracked item.
/// It comes from the ONE walk (<c>ProjectSnapshot</c>) the <c>push</c> receipt also uses, so the two can
/// never drift. No source bodies — that is <c>fetch</c>.</summary>
public static class RefsService
{
    public static RefsResponse Handle(IIdeDriver ide, RefsRequest? req = null, Action<ProgressFrame>? onProgress = null)
    {
        // Connected + right-project guard, the same one every other project-touching op runs — atomic with the walk.
        // `req` (and each of its fields) is optional: a body-less refs checks only connected, exactly as before, so
        // discovery and older clients are unaffected. A BOUND caller no longer has to answer "is the bridge on my
        // project?" for itself from the throttled health cache — refs was the last op that made it do that.
        OpGuard.RequireBoundProject(ide, req?.ExpectedPlatform, req?.ExpectedProjectName);

        var sw = Stopwatch.StartNew();
        var snap = ProjectSnapshot.Walk(ide, onProgress, Ops.Refs);

        var hit = new List<string>();
        if (snap.Unmapped > 0) hit.Add($"{snap.Unmapped} unmapped-kind");
        if (snap.Unreadable.Count > 0) hit.Add($"{snap.Unreadable.Count} unreadable: {string.Join(", ", snap.Unreadable)}");
        VoltLog.Debug($"refs: {snap.FullVersions.Count} items{(hit.Count > 0 ? $" (skipped: {string.Join(", ", hit)})" : "")} ({sw.ElapsedMilliseconds}ms)");

        return new RefsResponse
        {
            ProjectVersion = snap.ProjectVersion,
            StructureVersion = snap.StructureVersion,
            Items = snap.FullVersions,
            Folders = snap.Folders,
            // The items the walk found and could not materialize. They are tracked in the version hash above but
            // deliberately absent from `Items` — naming them here is the only way a client can tell the
            // difference between "this project has no such POU" and "Volt could not read it".
            Unreadable = snap.Unreadable,
        };
    }
}
