using System;
using System.Collections.Generic;
using System.Diagnostics;
using Volt.Engine.Diagnostics;
using Volt.Engine.Ide;
using Volt.Engine.Wire;
using Volt.Engine.Workspace;

using Volt.Cli.Transport;

namespace Volt.Engine.Sync;

/// <summary><c>refs</c>: the project snapshot — the aggregate versions (<c>projectVersion</c>,
/// <c>structureVersion</c>) plus the per-item version map and the folder map, for every tracked item.
/// It comes from the ONE walk (<c>ProjectSnapshot</c>) the <c>push</c> receipt also uses, so the two can
/// never drift. No source bodies — that is <c>fetch</c>.</summary>
public static class RefsService
{
    public static RefsResponse Handle(IIdeDriver ide, Action<ProgressFrame>? onProgress = null)
    {
        if (!ide.IsConnected) throw BridgeException.PlcDisconnected();

        var sw = Stopwatch.StartNew();
        var snap = ProjectSnapshot.Walk(ide, onProgress, Ops.Refs);

        var hit = new List<string>();
        if (snap.Unmapped > 0) hit.Add($"{snap.Unmapped} unmapped-kind");
        if (snap.Unreadable > 0) hit.Add($"{snap.Unreadable} unreadable");
        VoltLog.Debug($"refs: {snap.FullVersions.Count} items{(hit.Count > 0 ? $" (skipped: {string.Join(", ", hit)})" : "")} ({sw.ElapsedMilliseconds}ms)");

        return new RefsResponse
        {
            ProjectVersion = snap.ProjectVersion,
            StructureVersion = snap.StructureVersion,
            Items = snap.FullVersions,
            Folders = snap.Folders,
        };
    }
}
