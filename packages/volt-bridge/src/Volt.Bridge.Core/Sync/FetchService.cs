using System.Collections.Generic;
using System.Linq;
using Volt.Bridge.Core.Ide;
using Volt.Bridge.Core.Wire;
using Volt.Bridge.Core.Workspace;

namespace Volt.Bridge.Core.Sync;

/// <summary><c>/fetch</c>: like <c>/refs</c>, but ships the materialized source for every item whose
/// version differs from the client's known version. Materialize ONCE per item — the version is a hash
/// of the exact text shipped, so version and content can never diverge.</summary>
public static class FetchService
{
    public static FetchResponse Handle(IIdeDriver ide, FetchRequest request)
    {
        if (!ide.IsConnected) throw BridgeException.PlcDisconnected();

        var knownItems = request.KnownItems ?? new Dictionary<string, string>();
        var onlyItems = request.OnlyItems != null && request.OnlyItems.Count > 0
            ? new HashSet<string>(request.OnlyItems) : null;

        var versions = new Dictionary<string, string>();
        var changed = new List<FetchedItem>();

        foreach (var it in ide.WalkItems())
        {
            if (onlyItems != null && !onlyItems.Contains(it.Name)) continue;

            var kind = ItemKind.Map(it.KindCode, it.IsTopLevelCrud);
            if (kind == null) continue;

            var (version, mat) = Versioning.Materialize(ide, it.Name, kind, it.Item, it.Folder);
            versions[it.Name] = version;

            if (knownItems.TryGetValue(it.Name, out var known) && known == version) continue;

            changed.Add(new FetchedItem
            {
                Name = it.Name,
                Kind = kind,
                Folder = it.Folder,
                Version = version,
                SourceText = mat.Text,
                Language = mat.Language,   // ST/FBD/LD/CFC/SFC → drives the CLI's file extension
            });
        }

        var removed = knownItems.Keys.Where(k => !versions.ContainsKey(k)).ToList();

        return new FetchResponse
        {
            ProjectVersion = Hasher.ComputeProjectVersion(versions),
            StructureVersion = Hasher.ComputeStructureVersion(versions),
            Changed = changed,
            Removed = removed,
            Items = versions,
        };
    }
}
