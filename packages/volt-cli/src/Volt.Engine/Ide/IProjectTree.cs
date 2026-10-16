using System.Collections.Generic;
using Volt.Engine.Item;

namespace Volt.Engine.Ide;

/// <summary>Navigate and mutate the project tree. Pure structure — no source text (see
/// <see cref="ICodeStore"/>). Accessors return sentinels for genuine leaves (child count 0) and throw
/// only on real IDE failure; there is no silent fallback that would drop an item from a walk.</summary>
public interface IProjectTree
{
    /// <summary>Every tracked item in the project, depth-first, with folder paths resolved — AND whether the
    /// walk saw the whole tree.
    /// <para>The completeness half is not bookkeeping. A driver skips a subtree it cannot enumerate rather than
    /// failing the pull, which is right; but `FetchService` derives DELETIONS from absence, so a caller that
    /// cannot tell a partial walk from a complete one deletes the engineer's files for everything under the
    /// folder that faulted. See <see cref="WalkResult"/>.</para></summary>
    WalkResult WalkItems();

    /// <summary>The root the <see cref="WalkItems"/> folder paths are measured from — the whole tree's origin
    /// (CODESYS primary project; TwinCAT PLC project root). A non-empty push <c>toFolder</c> is the FULL path
    /// from here, exactly as the walk emits it, so push placement is symmetric with fetch.</summary>
    ItemRef GetTreeRoot();

    // NO Lookup member. Finding an item by name is a WALK over the four members above, so it is shared code
    // (Ide/ItemLookup) rather than something each driver reimplements — which is how the two copies came to
    // disagree about case sensitivity and about which kinds count. See ItemLookup for what each got wrong.

    int ChildCount(ItemRef item);
    /// <summary>The child at <paramref name="index1Based"/>. A driver may NAME a child it must not open, by throwing
    /// <see cref="UnreadableItemException"/> without touching it (TwinCAT, DIALECT C2i: a POU whose tree item crashes
    /// the IDE after a load). That is not a read fault: the walk names it in <c>unreadable</c>, a lookup skips it for any
    /// other name, and only a forced push reaches it — through its parent, by name.</summary>
    ItemRef ChildAt(ItemRef parent, int index1Based);
    /// <summary>The item's parent. Called only on an item the walk/lookup already found, and only rootward of it
    /// (<c>PushService</c>'s delete + move-recreate), so the contract has no no-parent case.
    /// <para>That is why it is non-nullable. A call ON the tree root has no parent to wrap, and the
    /// <see cref="ItemRef"/> constructor refuses the null native — a driver bug, not a coded error.</para></summary>
    ItemRef Parent(ItemRef item);
    string Name(ItemRef item);
    /// <summary>The item's vendor-neutral kind code (see <c>ItemKind</c>).</summary>
    int KindCode(ItemRef item);

    /// <summary>Does a handle into this project SURVIVE creating or deleting one of its children?
    ///
    /// <para>On CODESYS yes: the scripting objects are live, and adding a method does not disturb a handle to the
    /// POU. On TwinCAT NO — a member is not a separate file there, so placing one is a round trip through the
    /// enclosing POU's own archive and the import REPLACES the item (DIALECT D4d/D4j); the next write through
    /// the captured handle fails with "Unbound tree item".
    ///
    /// <para>Stated per driver so the reconciler re-finds the POU (a FULL PROJECT WALK per create) only where the
    /// handle actually dies, rather than charging one vendor's quirk to both.</para></summary>
    bool HandlesSurviveStructureChange { get; }

    /// <summary>Create a child. <paramref name="seed"/> is the ONE value the vendor wants at creation time, and
    /// WHICH value that is depends on the kind: the body LANGUAGE for a POU or a POU member, and the declared
    /// TYPE for an interface member (TwinCAT's <c>CreateChild</c> takes it as <c>vInfo</c>, and a null there
    /// fails with "Object reference not set to an instance of an object"; <see cref="Member.ReturnType"/> and
    /// <see cref="Member.DataType"/> supply it). <paramref name="cls"/> is the vendor CLASS to make it as, where the text names one (<c>%CLASS</c>,
    /// openspec <c>bridge-one-to-one</c> §3) — null for the kind's plain class. REQUIRED, like <paramref name="seed"/>:
    /// a class never changes in place (DIALECT C2l), so a create that made the plain class and was converted afterwards
    /// is no path; the driver makes the class at the create, through the vendor's own Add Object path (C2r), or refuses
    /// it by name (<see cref="ChildRefusedException"/>) — never a plain object reported created.</summary>
    ItemRef CreateChild(ItemRef parent, string name, int kindCode, string? seed, ObjectClass? cls);

    /// <summary>Which accessors an INTERFACE property actually has, as (Get, Set).
    ///
    /// <para>It needs a per-vendor answer because the obvious one is unsafe: enumerating an interface property's
    /// accessor COM children can HARD-CRASH TcXaeShell. CODESYS enumerates them in-process quite happily;
    /// TwinCAT reads presence out of the enclosing interface's own XML instead, where a property carries its
    /// <c>&lt;Get&gt;</c>/<c>&lt;Set&gt;</c> elements directly.</para>
    ///
    /// <para>Without it an interface property round-trips with NO accessors — the pull writes a bare
    /// <c>PROPERTY x : T END_PROPERTY</c> and the next push deletes the accessors the engineer actually has.</para></summary>
    (bool Get, bool Set) InterfacePropertyAccessors(ItemRef property);
    void Delete(ItemRef parent, string name);
    void Rename(ItemRef item, string newName);

    /// <summary>Re-place an EXISTING item under <paramref name="target"/>, keeping its identity and content.
    /// <para>BOTH vendors implement it: CODESYS through its scripting <c>ScriptObject.move</c>; TwinCAT, whose
    /// <c>ITcSmTreeItem</c> has no <c>Move</c>, through the <c>ExportChild</c>/<c>ImportChild</c> pair — the archive is a
    /// zip whose ENTRY NAME carries the item's source path, and flattening that name turns "recreate the path under the
    /// target" into a move (DIALECT D4f). A driver-specific refusal is not an expected state of this method.</para></summary>
    void Move(ItemRef item, ItemRef target);
}
