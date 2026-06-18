using System.Collections.Generic;
using Volt.Bridge.Core.Ide;
using Volt.Bridge.Core.Wire;
using Volt.Bridge.Core.Workspace;

namespace Volt.Bridge.Core.Sync;

/// <summary><c>/refs</c>: every item's content version (no source bodies) + the aggregate
/// project/structure versions, for cheap change detection on the client.
///
/// The aggregate versions (projectVersion, structureVersion) are computed from BARE-name keys
/// (it.Name) — the same keys PushService uses for conflict detection. The wire Items map uses
/// FULL-name keys (mat.FullName) so the client can derive the file extension from the key alone.</summary>
public static class RefsService
{
    public static RefsResponse Handle(IIdeDriver ide)
    {
        if (!ide.IsConnected) throw BridgeException.PlcDisconnected();

        var versions = new Dictionary<string, string>();
        var fullVersions = new Dictionary<string, string>();
        var folders = new Dictionary<string, string>();

        foreach (var it in ide.WalkItems())
        {
            var kind = ItemKind.Map(it.KindCode);
            if (kind == null) continue;

            var (version, mat) = Versioning.Materialize(ide, it.Name, kind, it.Item, it.Folder);
            versions[it.Name] = version;
            fullVersions[mat.FullName] = version;
            folders[mat.FullName] = it.Folder;
        }

        return new RefsResponse
        {
            ProjectVersion = Hasher.ComputeProjectVersion(versions),
            StructureVersion = Hasher.ComputeStructureVersion(versions),
            Items = fullVersions,
            Folders = folders,
        };
    }
}
