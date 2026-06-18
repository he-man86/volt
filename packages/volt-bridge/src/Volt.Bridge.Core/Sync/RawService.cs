using System.Collections.Generic;
using Volt.Bridge.Core.Ide;
using Volt.Bridge.Core.Workspace;

namespace Volt.Bridge.Core.Sync;

/// <summary><c>/raw</c> (diagnostic): every POU's raw PLCopen XML — the exact bytes the IDE emits, for
/// corpus capture. Not part of pull/push. Keeps a per-item catch (the ONE outside the data path) so a
/// single unexportable POU can't abort a corpus sweep.</summary>
public static class RawService
{
    public static Dictionary<string, object?> Handle(IIdeDriver ide)
    {
        var bodies = new Dictionary<string, string>();
        foreach (var it in ide.WalkItems())
        {
            var kind = ItemKind.Map(it.KindCode);
            if (kind is not ("program" or "function" or "function_block")) continue;   // only POUs carry graphical bodies
            string? raw;
            try { raw = ide.ReadXml(it.Item); } catch { raw = null; }
            if (!string.IsNullOrEmpty(raw))
            {
                var key = string.IsNullOrEmpty(it.Folder) ? it.Name : $"{it.Folder}/{it.Name}";
                bodies[key] = raw!;
            }
        }
        return new Dictionary<string, object?> { ["count"] = bodies.Count, ["bodies"] = bodies };
    }
}
