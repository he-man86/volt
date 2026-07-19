using System;
using System.Collections.Generic;
using System.Diagnostics;
using Volt.Engine.Diagnostics;
using Volt.Engine.Ide;
using Volt.Engine.Wire;
using Volt.Engine.Workspace;

namespace Volt.Engine.Sync;

public static class RefsService
{
    public static RefsResponse Handle(IIdeDriver ide, Action<ProgressFrame>? onProgress = null)
    {
        if (!ide.IsConnected) throw BridgeException.PlcDisconnected();

        var sw = Stopwatch.StartNew();
        // /refs IS the project snapshot — the same walk the /push receipt uses, so the two never drift.
        var snap = ProjectSnapshot.Walk(ide, onProgress, "refs");

        var hit = new List<string>();
        if (snap.Unmapped > 0) hit.Add($"{snap.Unmapped} unmapped-kind");
        if (snap.Unreadable > 0) hit.Add($"{snap.Unreadable} unreadable");
        VoltLog.Info($"refs: {snap.FullVersions.Count} items{(hit.Count > 0 ? $" (skipped: {string.Join(", ", hit)})" : "")} ({sw.ElapsedMilliseconds}ms)");

        return new RefsResponse
        {
            ProjectVersion = snap.ProjectVersion,
            StructureVersion = snap.StructureVersion,
            Items = snap.FullVersions,
            Folders = snap.Folders,
        };
    }
}
