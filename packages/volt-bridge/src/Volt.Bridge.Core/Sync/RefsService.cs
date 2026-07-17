using System;
using System.Collections.Generic;
using System.Diagnostics;
using Volt.Bridge.Core.Diagnostics;
using Volt.Bridge.Core.Ide;
using Volt.Bridge.Core.Wire;
using Volt.Bridge.Core.Workspace;

namespace Volt.Bridge.Core.Sync;

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
        if (snap.Excluded > 0) hit.Add($"{snap.Excluded} exclude-from-build");
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
