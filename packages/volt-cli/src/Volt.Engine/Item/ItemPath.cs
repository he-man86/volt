using System;
using System.Collections.Generic;

namespace Volt.Engine.Item;

/// <summary>
/// An item's PATH — its identity on the wire (openspec <c>multi-application-tree</c>): the folder the walk reports it in
/// and its file name, <c>&lt;folder&gt;/&lt;name&gt;.&lt;kind&gt;</c> (<c>Device/Plc Logic/Application/PLC_PRG.pou</c>).
/// Two <c>PLC_PRG.pou</c> in two applications are two paths, so two items, in every version map, in the workspace and in a
/// push. The folder is the path's own prefix, so the wire carries no separate folder map.
///
/// <para>The folder half is already encoded (<see cref="FolderPath"/>), and so is a file name the walk encoded itself (a
/// library reference's). The file name is joined as it is; only a <c>/</c> inside it is escaped, so the last <c>/</c> is
/// always the boundary between the two halves.</para>
/// </summary>
public static class ItemPath
{
    /// <summary>The path of the item <paramref name="fileName"/> (bare, or with its kind extension) in the encoded
    /// <paramref name="folder"/>.</summary>
    public static string Of(string folder, string fileName)
    {
        var file = fileName.Replace("/", "%2F");
        return string.IsNullOrEmpty(folder) ? file : folder + "/" + file;
    }

    /// <summary>The encoded folder of <paramref name="path"/> — <c>""</c> at the tree root.</summary>
    public static string FolderOf(string path)
    {
        var cut = path.LastIndexOf('/');
        return cut < 0 ? "" : path.Substring(0, cut);
    }

    /// <summary>The file name of <paramref name="path"/> — the last segment, with its kind extension when it has one.</summary>
    public static string FileOf(string path)
    {
        var cut = path.LastIndexOf('/');
        return (cut < 0 ? path : path.Substring(cut + 1)).Replace("%2F", "/");
    }

    /// <summary>The path with its kind extension dropped — <c>&lt;folder&gt;/&lt;bare name&gt;</c>, the key an item has
    /// below the vendor seam: the IDE names an object without its kind, and only inside the container it sits in.</summary>
    public static string BarePathOf(string path) => Of(FolderOf(path), BareOf(path));

    /// <summary>The bare name of <paramref name="path"/>'s item: its file name without the kind extension.</summary>
    public static string BareOf(string path)
    {
        var file = FileOf(path);
        var dot = file.LastIndexOf('.');
        return dot > 0 ? file.Substring(0, dot) : file;
    }

    /// <summary>The application <paramref name="path"/> belongs to: the root in <paramref name="applications"/> that is
    /// the longest prefix of it, on <c>/</c> boundaries — or null for an item under none (the CODESYS POU pool).</summary>
    public static string? ApplicationOf(string path, IEnumerable<string> applications)
    {
        string? best = null;
        foreach (var root in applications)
        {
            if (!IsUnder(path, root)) continue;
            if (best is null || root.Length > best.Length) best = root;
        }
        return best;
    }

    /// <summary>Is <paramref name="path"/> at or under the folder <paramref name="root"/>? Case-insensitive, as the IDE
    /// resolves a name. The root <c>""</c> holds everything.</summary>
    public static bool IsUnder(string path, string root) =>
        root.Length == 0
        || string.Equals(path, root, StringComparison.OrdinalIgnoreCase)
        || path.StartsWith(root + "/", StringComparison.OrdinalIgnoreCase);
}
