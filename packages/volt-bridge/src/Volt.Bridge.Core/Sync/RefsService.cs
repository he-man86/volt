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
        var versions = new Dictionary<string, string>();
        var fullVersions = new Dictionary<string, string>();
        var folders = new Dictionary<string, string>();

        var walked = ide.WalkItems();
        var total = walked.Count;
        var done = 0;
        var unmapped = 0;    // KindCode the table doesn't map — dropped
        var unreadable = 0;  // exists + tracked, body unreadable (SafeVersion logs the why at Debug)
        onProgress?.Invoke(new ProgressFrame { Operation = "refs", Done = 0, Total = total, Phase = "reading" });

        foreach (var it in walked)
        {
            done++;
            if (onProgress != null && (done % 25 == 0 || done == total))
                onProgress(new ProgressFrame { Operation = "refs", Done = done, Total = total });

            var kind = ItemKind.Map(it.KindCode);
            if (kind == null) { unmapped++; continue; }
            if (ItemKind.IsContainerManager(it.KindCode)) continue;
            if (it.ExcludeFromBuild) continue;

            var version = Versioning.SafeVersion(ide, it.Name, kind, it.Item, it.Folder, out var mat);
            versions[it.Name] = version;
            if (mat != null)
            {
                fullVersions[mat.FullName] = version;
                folders[mat.FullName] = it.Folder;
            }
            else unreadable++;
        }

        var hit = new List<string>();
        if (unmapped > 0) hit.Add($"{unmapped} unmapped-kind");
        if (unreadable > 0) hit.Add($"{unreadable} unreadable");
        VoltLog.Info($"refs: {fullVersions.Count} items{(hit.Count > 0 ? $" (skipped: {string.Join(", ", hit)})" : "")} ({sw.ElapsedMilliseconds}ms)");

        return new RefsResponse
        {
            ProjectVersion = Hasher.ComputeProjectVersion(versions),
            StructureVersion = Hasher.ComputeStructureVersion(versions),
            Items = fullVersions,
            Folders = folders,
        };
    }
}
