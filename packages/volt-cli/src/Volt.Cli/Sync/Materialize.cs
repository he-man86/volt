using Volt.Engine.Wire;

namespace Volt.Cli.Sync;

/// <summary>A materialized workspace file: a src-relative path + content (no leading "src/").</summary>
public sealed record MaterializedFile(string Path, string Content);

/// <summary>Item ⇄ file translation. One IDE item = one workspace file. The bridge already materialized graphical
/// bodies as VG, so this is pure path/content mapping.</summary>
public static class Materialize
{
    private static string JoinPath(params string[] parts) => string.Join("/", parts.Where(p => p.Length > 0));

    /// <summary>IDE item → src-relative workspace file(s).</summary>
    public static IReadOnlyList<MaterializedFile> MaterializeItem(FetchedItem item)
    {
        var folder = item.Folder ?? "";
        var name = item.Name; // includes extension
        // Every extension derives from ItemKind.FileExtensions and none is empty (a folder is a path SEGMENT, never
        // an item), so there is no folder-marker arm — legacy `.gitkeep` files are only READ back
        // (Extensions.FullNameFromPath / IsTrackedPath), never produced here.
        if (Extensions.DefFromName(name) is null)
            throw new InvalidOperationException($"unrecognized extension in \"{name}\" — add it to Extensions.cs");
        return new[] { new MaterializedFile(JoinPath(folder, name), item.SourceText) };
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
