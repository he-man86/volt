using System.Collections.Generic;

namespace Volt.Engine.Ide;

/// <summary>Navigate and mutate the project tree. Pure structure — no source text (see
/// <see cref="ICodeStore"/>). Accessors return sentinels for genuine leaves (child count 0) and throw
/// only on real IDE failure; there is no silent fallback that would drop an item from a walk.</summary>
public interface IProjectTree
{
    /// <summary>Every tracked item in the project, depth-first, with folder paths resolved.</summary>
    IReadOnlyList<ProjectItem> WalkItems();

    /// <summary>The default parent for new top-level items (CODESYS Application / TwinCAT PLC project).</summary>
    ItemRef GetPlcProjectRoot();

    /// <summary>The root the <see cref="WalkItems"/> folder paths are measured from — the whole tree's origin
    /// (CODESYS primary project; TwinCAT PLC project root). A non-empty push <c>toFolder</c> is the FULL path
    /// from here, exactly as the walk emits it, so push placement is symmetric with fetch.</summary>
    ItemRef GetTreeRoot();

    /// <summary>The item with this name, or null if absent.</summary>
    ItemRef? Lookup(string name);

    int ChildCount(ItemRef item);
    ItemRef ChildAt(ItemRef parent, int index1Based);
    /// <summary>The item's parent. Called only on an item the walk/lookup already found, and only rootward of it
    /// (<c>PushService</c>'s delete + move-recreate), so the contract has no no-parent case.
    /// <para>ARCH FOLLOW-UP: that is why it is non-nullable — and why both drivers launder a possibly-null native
    /// handle into <see cref="ItemRef.Native"/>, so a call ON the tree root dies as a NullReferenceException inside
    /// vendor reflection and reaches the client as INTERNAL_ERROR instead of a coded error. Make it honest
    /// (<c>ItemRef?</c> the caller refuses on, or a coded NOT_FOUND in each driver) and reject a null native in the
    /// <see cref="ItemRef"/> constructor so it cannot be laundered past the typed boundary.</para></summary>
    ItemRef Parent(ItemRef item);
    string Name(ItemRef item);
    /// <summary>The item's vendor-neutral kind code (see <c>ItemKind</c>).</summary>
    int KindCode(ItemRef item);

    ItemRef CreateChild(ItemRef parent, string name, int kindCode, string? language = null);
    void Delete(ItemRef parent, string name);
    void Rename(ItemRef item, string newName);

    /// <summary>Which accessors an INTERFACE property declares — <c>(hasGetter, hasSetter)</c>. Interface
    /// accessors are declaration-only, so only presence matters. The driver reads it its SAFE way: CODESYS
    /// enumerates the accessor children directly; TwinCAT reads the enclosing interface's PLCopen export,
    /// because enumerating an interface property's accessor COM children can hard-crash it.</summary>
    (bool getter, bool setter) InterfacePropertyAccessors(ItemRef property);
}
