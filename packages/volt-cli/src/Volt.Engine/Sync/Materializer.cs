using System;
using Volt.Engine.Item;
using Volt.Engine.Ide;
using Volt.Engine.Library;
using Volt.Engine.Format.St;

namespace Volt.Engine.Sync;

public static class Materializer
{
    public static WorkspaceItem Materialize(IIdeDriver ide, string name, string kind, ItemRef item)
    {
        if (ItemKind.IsSourceKind(kind))
        {
            var build = BuildSource(ide, item, kind);
            var text = StWriter.Write(build);
            var resolvedKind = build.Kind;
            return new WorkspaceItem(text, FullWireName(name, ItemKind.ExtFor(resolvedKind)));
        }
        return new WorkspaceItem(ide.ReadManifest(item, kind),
            FullWireName(name, ItemKind.ExtFor(kind)));
    }

    private static string FullWireName(string bareName, string ext) =>
        IsVerbatimKind(bareName, ext) ? bareName : $"{bareName}.{ext}";

    private static bool IsVerbatimKind(string name, string ext) =>
        name.EndsWith("." + ext, StringComparison.OrdinalIgnoreCase);

    public static string Bare(string wireName)
    {
        var dot = wireName.LastIndexOf('.');
        return dot > 0 ? wireName.Substring(0, dot) : wireName;
    }

    /// <summary>An item's content, straight from the driver. <b>The engine no longer knows how it was
    /// obtained.</b>
    /// <para>This method used to be the split that decided it: items with a body or children went through
    /// <c>ReadXml</c> and a PLCopen parse, declaration-only kinds (DUT, GVL) through the declaration aspect.
    /// That split was a VENDOR limit wearing an engine decision — TwinCAT's <c>PlcOpenExport</c> rejects a DUT
    /// or GVL outright (<c>E_FAIL</c> for every one of them, because the export is POU-shaped and a DUT has no
    /// POU to name), so PLCopen could not be the single read transport while TwinCAT was supported. A driver
    /// that knows its own IDE picks per kind without the engine having to encode one vendor's refusal.</para></summary>
    private static ItemContent BuildSource(IIdeDriver ide, ItemRef item, string kind) => ide.ReadContent(item);
}
