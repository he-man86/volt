using VoltBridge.Core;
using VoltBridge.Core.Models;

namespace VoltBridge.Core.Handlers;

public static class FetchHandler
{
    public static FetchResponse Handle(IAdapter adapter, FetchRequest request)
    {
        if (!adapter.IsConnected) throw BridgeException.PlcDisconnected();

        var knownItems = request.KnownItems ?? new Dictionary<string, string>();
        var onlyItems = request.OnlyItems != null && request.OnlyItems.Count > 0
            ? new HashSet<string>(request.OnlyItems) : null;

        var items = adapter.WalkAllItems(onlyItems);
        var versions = new Dictionary<string, string>();
        var changed = new List<FetchedItem>();

        foreach (var visit in items)
        {
            if (onlyItems != null && !onlyItems.Contains(visit.Name)) continue;

            var kind = adapter.MapItemType(visit.ItemType, visit.IsTopLevelCrud);
            if (kind == null) continue;

            var folder = visit.FolderPath ?? "";
            // Materialize ONCE: the version is a hash of this exact text, and (if changed) it IS the
            // shipped source — so version and content can never diverge.
            var (version, mat) = SourceAssembler.VersionedMaterialize(adapter, visit.Name, kind, (object)visit.Item, folder);
            versions[visit.Name] = version;

            if (knownItems.TryGetValue(visit.Name, out var known) && known == version)
                continue;

            changed.Add(new FetchedItem
            {
                Name = visit.Name,
                Kind = kind,
                Folder = folder,
                Version = version,
                SourceText = mat.Text,
                Language = mat.Language,   // ST/FBD/LD/CFC/SFC → drives the CLI's file extension
            });
        }

        var removed = knownItems.Keys.Where(k => !versions.ContainsKey(k)).ToList();

        return new FetchResponse
        {
            ProjectVersion = adapter.ComputeProjectVersion(versions),
            StructureVersion = adapter.ComputeStructureVersion(versions),
            Changed = changed,
            Removed = removed,
            Items = versions,
        };
    }
}
