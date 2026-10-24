using System.Collections.Generic;
using Volt.Engine.Item;

namespace Volt.Engine.Ide;

/// <summary>
/// AN EXCLUDED FOLDER IN THE WALK, one answer for both vendors (DIALECT C39; openspec <c>bridge-one-to-one</c> §1.1): the
/// folder is a node in <c>unreadableNodes</c> with its reason, and every item under it is named in <c>unreadable</c> by
/// its kind — not built, so not pulled as a built one, and not read as deleted. The wire is the parity boundary, so the
/// two drivers word these entries through this one class.
/// </summary>
public static class ExcludedFolder
{
    /// <summary>The build property's member that excludes a node, as a reason names it.</summary>
    public const string ExcludeFromBuild = "ExcludeFromBuild";

    /// <summary>A container's build property, naming the members it holds off their default.</summary>
    public static string BuildProperty(IEnumerable<string> set) => $"its build property ({string.Join(", ", set)})";

    /// <summary>The reason a container that holds what no text spells is listed: <paramref name="what"/> is its quoted
    /// name, <paramref name="inside"/> whether what is under it is still walked (false for an excluded folder).</summary>
    public static string Reason(string what, IEnumerable<string> holds, bool inside) =>
        $"{what} holds {string.Join(" and ", holds)} — it is no item, and Volt's text has no line for it " +
        "(openspec bridge-one-to-one §1.1: refused by name in the pull report)" +
        (inside ? "." : "; the objects in an excluded folder are not built, so they are not pulled as built ones.");

    /// <summary>The entry of a folder excluded by its build property alone.</summary>
    public static UnreadableObject Folder(string name, string parentFolder) =>
        new(name, parentFolder, Reason($"'{name}'", new[] { BuildProperty(new[] { ExcludeFromBuild }) }, inside: false),
            ItemKind.Kinds.Folder, Volt.Contracts.BridgeErrorCodes.Unsupported);

    /// <summary>Name every item the walk found under the excluded folder <paramref name="folder"/> (its path) in
    /// <paramref name="into"/>, by its kind; an item of no wire kind is no file, and is not named.</summary>
    public static void NameItems(IEnumerable<ProjectItem> held, string folder, List<UnreadableObject> into)
    {
        foreach (var it in held)
            if (ItemKind.Map(it.KindCode) is { } kind)
                into.Add(new UnreadableObject(it.Name, it.Folder,
                    $"'{it.Name}' sits in the excluded folder '{folder}' — it is not built, so it is not pulled as a built one",
                    kind, Volt.Contracts.BridgeErrorCodes.Unsupported));
    }
}
