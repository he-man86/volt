using Volt.Contracts;
using Volt.Engine.Format.St;
using Volt.Engine.Item;

namespace Volt.Cli.Sync;

/// <summary>A materialized workspace file: a src-relative path + content (no leading "src/").</summary>
public sealed record MaterializedFile(string Path, string Content);

/// <summary>Item ⇄ file translation. One IDE item = one workspace file. The bridge already materialized graphical
/// bodies as network text, so this is pure path/content mapping.</summary>
public static class Materialize
{
    private static string JoinPath(params string[] parts) => string.Join("/", parts.Where(p => p.Length > 0));

    /// <summary>IDE item → src-relative workspace file(s).</summary>
    public static IReadOnlyList<MaterializedFile> MaterializeItem(FetchedItem item)
    {
        var folder = item.Folder ?? "";
        var name = FileNameFor(item); // includes extension
        // Every extension derives from ItemKind.FileExtensions and none is empty (a folder is a path SEGMENT, never
        // an item), so there is no folder-marker arm — legacy `.gitkeep` files are only READ back
        // (Extensions.FullNameFromPath / IsTrackedPath), never produced here.
        if (Extensions.DefFromName(name) is null)
            throw new InvalidOperationException($"unrecognized extension in \"{name}\" — add it to Extensions.cs");
        return new[] { new MaterializedFile(JoinPath(folder, name), item.SourceText) };
    }

    /// <summary>The filename an item is written under — its WIRE name for every kind but a DUT.
    ///
    /// <para>A DUT arrives as <c>X.dut</c> because that is the one wire kind both vendors have, and it is
    /// written as <c>X.struct</c>/<c>X.enum</c>/<c>X.union</c>/<c>X.alias</c> because that is what the
    /// declaration says it is and what an engineer expects to see in a diff. The subtype is read from the
    /// same text the IDE reads it from, so this invents nothing — it only stops throwing the answer away.
    /// <see cref="Extensions.FullNameFromPath"/> maps all four back, so the round trip is closed.</para></summary>
    private static string FileNameFor(FetchedItem item)
    {
        var dot = item.Name.LastIndexOf('.');
        if (dot < 0) return item.Name;
        var ext = item.Name.Substring(dot + 1);
        if (!ext.Equals(ItemKind.ExtFor(ItemKind.Kinds.Dut), StringComparison.OrdinalIgnoreCase)) return item.Name;
        return item.Name.Substring(0, dot + 1) + CodeHelper.DutSubtype(item.SourceText);
    }

    /// <summary>A src-relative workspace path → its bridge wire name + containing folder. null if untracked.</summary>
    public static (string Name, string Folder)? PathToItem(string relPath)
    {
        var name = Extensions.FullNameFromPath(relPath);
        if (name is null) return null;
        var slash = relPath.LastIndexOf('/');
        return (name, slash >= 0 ? relPath.Substring(0, slash) : "");
    }
}
