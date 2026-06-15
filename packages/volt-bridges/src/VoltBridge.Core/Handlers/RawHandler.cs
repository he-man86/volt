using System.Collections.Generic;

namespace VoltBridge.Core.Handlers;

/// <summary>
/// Corpus capture for coverage work: walk every POU and return its raw PLCopenXML — the exact bytes
/// the IDE emits. Diagnostic only (the <c>/raw</c> route); not part of pull/push. The captured bodies
/// become round-trip fixtures so the VG pipeline is measured/extended against real data, never guesses.
/// </summary>
public static class RawHandler
{
    public static Dictionary<string, object?> Handle(IAdapter adapter)
    {
        var bodies = new Dictionary<string, string>();
        foreach (var visit in adapter.WalkAllItems())
        {
            var kind = adapter.MapItemType(visit.ItemType, visit.IsTopLevelCrud);
            if (kind is not ("program" or "function" or "function_block")) continue;   // only POUs carry graphical bodies
            string? raw;
            try { raw = adapter.ExportRawPou(visit.Item); } catch { raw = null; }
            if (!string.IsNullOrEmpty(raw))
            {
                var key = string.IsNullOrEmpty(visit.FolderPath) ? visit.Name : $"{visit.FolderPath}/{visit.Name}";
                bodies[key] = raw!;
            }
        }
        return new Dictionary<string, object?> { ["count"] = bodies.Count, ["bodies"] = bodies };
    }
}
