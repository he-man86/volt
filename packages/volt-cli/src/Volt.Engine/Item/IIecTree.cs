namespace Volt.Engine.Item;

/// <summary>
/// The IEC tables' codes as a host's tree answers them (<see cref="ItemKind"/>): what the IEC-format helpers read
/// (<c>Ide/MemberSites</c>, <c>Ide/ProjectDeclarations</c>, <c>Ide/ItemLookup.All</c>). NOT the contract — a host is
/// <c>Seam.IVendorDriver</c>; this is how a host whose tree answers these codes hands them to the helpers that read them.
///
/// <para>Why codes and not <c>IVendorTree.Classify</c>: a member is handed back WITH its code, and both hosts dispatch on
/// it (<see cref="ItemKind.MemberKind"/>, <see cref="ItemKind.PlcAction"/>, a property's accessors); through a
/// <c>NodeClass</c> the code is gone, and a host would ask it again per member — a second cross-process call per member
/// on TwinCAT.</para>
/// </summary>
public interface IIecTree
{
    /// <summary>The node every walked folder path is measured from (the same as the host's <c>IVendorTree.Root</c>).</summary>
    ItemRef Root { get; }

    int ChildCount(ItemRef item);

    /// <summary>The child at <paramref name="index1Based"/>. A host may NAME a child it must not open, by throwing
    /// <c>Ide.UnreadableItemException</c> without touching it (TwinCAT, DIALECT C2i).</summary>
    ItemRef ChildAt(ItemRef parent, int index1Based);

    string Name(ItemRef item);

    /// <summary>The node's IEC code (<see cref="ItemKind"/>).</summary>
    int KindCode(ItemRef item);
}
