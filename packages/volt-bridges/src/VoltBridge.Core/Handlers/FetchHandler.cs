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

            if (kind != null)
            {
                try
                {
                    var isSource = IsSourceKind(kind);
                    if (isSource)
                    {
                        var buildResult = SourceAssembler.BuildSource(adapter, visit.Name, visit.Item);
                        item.SourceText = StAssembler.Assemble(buildResult);
                    }
                    else
                    {
                        item.SourceText = adapter.ReadManifestText(visit.Item, kind);
                    }
                }
                catch { item.SourceText = ""; }
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

    private static bool IsSourceKind(string kind) => kind switch
    {
        "function_block" or "function" or "program" or "interface" or "gvl" or
        "structure" or "enumeration" or "union" or "alias" => true,
        _ => false,
    };
}
