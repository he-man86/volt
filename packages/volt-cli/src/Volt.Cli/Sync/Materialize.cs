using Volt.Contracts;

namespace Volt.Cli.Sync;

/// <summary>A materialized workspace file: a src-relative path + content (no leading "src/").</summary>
public sealed record MaterializedFile(string Path, string Content);

/// <summary>Item ⇄ file translation. One IDE item = one workspace file. The bridge already materialized graphical
/// bodies as network text, so this is pure path/content mapping.</summary>
public static class Materialize
{
    /// <summary>IDE item → src-relative workspace file(s). The wire name IS the item's PATH — its folder and its file
    /// name, extension included (openspec <c>multi-application-tree</c>) — so the file is written at exactly that path.</summary>
    public static IReadOnlyList<MaterializedFile> MaterializeItem(FetchedItem item)
    {
        // Every extension derives from ItemKind.FileExtensions and none is empty (a folder is a path SEGMENT, never
        // an item), so nothing here writes a folder marker.
        if (Extensions.FullNameFromPath(item.Name) is null)
            // The CLI keeps no extension list (Extensions derives it), so a wire name it cannot file is the engine
            // minting a name its own table lacks — the fix belongs there, never in this layer.
            throw new InvalidOperationException(
                $"unrecognized extension in \"{item.Name}\" — the bridge minted a wire name missing from ItemKind.FileExtensions (Volt.Engine)");
        return new[] { new MaterializedFile(item.Name, item.SourceText) };
    }

    /// <summary>A src-relative workspace path → the bridge wire name of its item, which IS that path; null if the file
    /// is untracked (no extension names an item).</summary>
    public static string? PathToItem(string relPath) =>
        Extensions.FullNameFromPath(relPath) is null ? null : relPath;
}
