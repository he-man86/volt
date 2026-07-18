using Volt.Bridge.Core.Wire;

namespace Volt.Cli.Sync;

/// <summary>A materialized workspace file: a src-relative path + content (no leading "src/").</summary>
public sealed record MaterializedFile(string Path, string Content);

/// <summary>Item ⇄ file translation. One IDE item = one workspace file. The bridge already materialized graphical
/// bodies as VG, so this is pure path/content mapping. C# port of packages/volt-git/src/domain/materialize.ts.</summary>
public static class Materialize
{
    private static string JoinPath(params string[] parts) => string.Join("/", parts.Where(p => p.Length > 0));

    /// <summary>IDE item → src-relative workspace file(s). A folder item (extension "") becomes a `.gitkeep`.</summary>
    public static IReadOnlyList<MaterializedFile> MaterializeItem(FetchedItem item)
    {
        var folder = item.Folder ?? "";
        var name = item.Name; // includes extension
        var def = Extensions.DefFromName(name)
            ?? throw new InvalidOperationException($"unrecognized extension in \"{name}\" — add it to Extensions.cs");
        if (def.Ext.Length == 0)
            return new[] { new MaterializedFile(JoinPath(folder, name, Extensions.FolderMarker), "") };
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
