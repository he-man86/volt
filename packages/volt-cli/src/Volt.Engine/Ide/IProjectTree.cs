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

    // NO Lookup member. Finding an item by name is a WALK over the four members above, so it is shared code
    // (Ide/ItemLookup) rather than something each driver reimplements — which is how the two copies came to
    // disagree about case sensitivity and about which kinds count. See ItemLookup for what each got wrong.

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

    /// <summary>Re-place an EXISTING item under <paramref name="target"/>, keeping its identity and content —
    /// the one structural primitive a PLCopen import cannot express.
    /// <para>A POU write is one merge import (content), and that import FLATTENS the POU's internal child
    /// folders: measured on CODESYS 3.5.21.40 against <c>FB_FolderChild</c>, <c>testfolder</c> is pruned and the
    /// action lands at the POU root. The document CAN describe the folders (<c>bExportFolderStructure</c> emits a
    /// <c>projectstructure</c> block) but emits them <c>handleUnknown="discard"</c>, and that is exactly what the
    /// import does. So placement is restored afterwards, here.</para>
    /// <para>This interface previously had no move, which is why the change was twice stopped on "there is no
    /// move primitive" — a conclusion read off THIS file rather than off the vendor. CODESYS's scripting
    /// <c>ScriptObject</c> has one and it works.</para>
    /// <para><b>BOTH vendors implement this now.</b> TwinCAT was refused here for a third time, on a note saying
    /// its COM surface "has not been measured for an equivalent" — and it had not been. Enumerating
    /// <c>ITcSmTreeItem</c>'s real dispatch table confirms there is no <c>Move</c> member, but its
    /// <c>ExportChild</c>/<c>ImportChild</c> pair IS one: the archive is a zip whose ENTRY NAME carries the item's
    /// source path, and flattening that name turns "recreate the path under the target" into a move (DIALECT D4f).
    /// So a driver-specific refusal is no longer an expected state of this method.</para></summary>
    void Move(ItemRef item, ItemRef target);
}
