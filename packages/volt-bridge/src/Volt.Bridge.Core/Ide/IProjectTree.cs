using System.Collections.Generic;

namespace Volt.Bridge.Core.Ide;

/// <summary>Navigate and mutate the project tree. Pure structure — no source text (see
/// <see cref="ICodeStore"/>). Accessors return sentinels for genuine leaves (child count 0) and throw
/// only on real IDE failure; there is no silent fallback that would drop an item from a walk.</summary>
public interface IProjectTree
{
    /// <summary>Every tracked item in the project, depth-first, with folder paths resolved.</summary>
    IReadOnlyList<ProjectItem> WalkItems();

    /// <summary>The default parent for new top-level items (CODESYS Application / TwinCAT PLC project).</summary>
    ItemRef GetPlcProjectRoot();

    /// <summary>The item with this name, or null if absent.</summary>
    ItemRef? Lookup(string name);

    int ChildCount(ItemRef item);
    ItemRef ChildAt(ItemRef parent, int index1Based);
    ItemRef Parent(ItemRef item);
    string Name(ItemRef item);
    /// <summary>The item's vendor-neutral kind code (see <c>ItemKind</c>).</summary>
    int KindCode(ItemRef item);

    ItemRef CreateChild(ItemRef parent, string name, int kindCode, string? language = null);
    void Delete(ItemRef parent, string name);
    void Rename(ItemRef item, string newName);
}
