using VoltBridge.Core;
using VoltBridge.Core.Errors;
using VoltBridge.Core.Models;

namespace VoltBridge.Core.Handlers;

public static class FetchHandler
{
    public static FetchResponse Handle(IAdapter adapter, FetchRequest request)
    {
        if (!adapter.IsConnected) throw ErrorResponse.PlcDisconnectedException();

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
            var version = adapter.ComputeItemVersion(visit.Item, folder);
            versions[visit.Name] = version;

            if (knownItems.TryGetValue(visit.Name, out var known) && known == version)
                continue;

            var item = new FetchedItem
            {
                Name = visit.Name,
                Kind = kind,
                Folder = folder,
                Version = version,
            };

            if (visit.IsTopLevelCrud)
            {
                try
                {
                    var buildResult = SourceAssembler.BuildSource(adapter, visit.Name, visit.Item);
                    item.SourceText = StAssembler.Assemble(buildResult);
                }
                catch { item.SourceText = ""; }
            }
            else
            {
                item.SourceText = "";
            }

            changed.Add(item);
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
