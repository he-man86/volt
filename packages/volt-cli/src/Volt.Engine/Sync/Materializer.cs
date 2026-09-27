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
            return new WorkspaceItem(text, FullWireName(name, build.Kind, build.Declaration));
        }
        return new WorkspaceItem(ide.ReadManifest(item, kind), FullWireName(name, kind, declaration: null));
    }

    /// <summary>The name an item is known by ON THE WIRE — <c>name.ext</c> — from the BARE name the IDE holds.
    /// <b>The one place a full wire name is minted</b>: <c>VersionedItem.Identity</c>, and through it every
    /// <c>refs</c>/<c>fetch</c>/receipt map and every push gate, keys on what this returns.
    ///
    /// <para><b>A DUT is named by its SUBTYPE</b> — <c>X.struct</c> / <c>X.enum</c> / <c>X.union</c> /
    /// <c>X.alias</c> — read from its declaration (<see cref="CodeHelper.DutSubtype"/>), never from the tree code,
    /// which on TwinCAT lags an in-place change (DIALECT C2e). It used to travel as <c>X.dut</c> and be re-derived
    /// in the CLI to name the file, which put item-kind knowledge in the one layer whose job is git; a client now
    /// writes the wire name as the file name. A declaration that states no subtype throws here, and the caller
    /// (<c>Versioning.SafeVersion</c>) publishes the item as unreadable rather than under a guessed name.</para>
    ///
    /// <para>PRIVATE, and it stays that way: <see cref="Materialize"/> is the public path and every item goes
    /// through it, so a test has no reason to reach past it. Making this public to test it directly is what
    /// `NoTestOnlyCodeInSrcTests` exists to catch — and it did.</para></summary>
    private static string FullWireName(string bareName, string kind, string? declaration)
    {
        var ext = kind == ItemKind.Kinds.Dut
            ? CodeHelper.DutSubtype(declaration ?? throw new ArgumentException($"DUT '{bareName}' has no declaration to name it by"))
            : ItemKind.ExtFor(kind);
        return IsVerbatimKind(bareName, ext) ? bareName : $"{bareName}.{ext}";
    }

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
