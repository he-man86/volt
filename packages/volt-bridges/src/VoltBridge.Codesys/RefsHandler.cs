using VoltBridge.Core.Errors;
using VoltBridge.Core.Models;

namespace VoltBridge.Codesys;

public static class RefsHandler
{
    public static RefsResponse Handle(Adapters.CodesysAdapter adapter)
    {
        if (!adapter.IsConnected) throw ErrorResponse.PlcDisconnectedException();

        var items = adapter.WalkAllItems();
        var itemVersions = new Dictionary<string, string>();
        var itemKinds = new Dictionary<string, string>();
        var itemFolders = new Dictionary<string, string>();

        foreach (var visit in items)
        {
            var kind = adapter.MapItemType(visit.ItemType, visit.IsTopLevelCrud);
            if (kind == null) continue;

            var folder = visit.FolderPath ?? "";
            var version = adapter.ComputeItemVersion(visit.Item, folder);

            itemVersions[visit.Name] = version;
            itemKinds[visit.Name] = kind;
            itemFolders[visit.Name] = folder;
        }

        return new RefsResponse
        {
            ProjectVersion = adapter.ComputeProjectVersion(itemVersions),
            StructureVersion = adapter.ComputeStructureVersion(itemVersions),
            Items = itemVersions,
            Kinds = itemKinds,
            Folders = itemFolders,
        };
    }
}
