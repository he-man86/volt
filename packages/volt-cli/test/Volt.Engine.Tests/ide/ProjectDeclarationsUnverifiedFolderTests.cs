using System;
using Xunit;
using Volt.Contracts;
using Volt.Engine.Ide;
using Volt.Engine.Item;

namespace Volt.Engine.Tests;

/// <summary>
/// The project-wide declarations index walks EVERY folder (<see cref="ItemLookup.All"/>), so a folder anywhere that the
/// driver will not read — TwinCAT's C2i guard on a folder its hierarchy does not vouch for, <c>ITEM_UNVERIFIED</c> — stops
/// a body's name resolution even when the op's own item sits elsewhere (review of <c>bridge-refusal-review</c> 7). The
/// refusal is right (a skipped folder would resolve a name it holds as unknown — a guess), but the conflict lands on the
/// OP's item, so it must say why that op needed the folder: the code stays (the bridge is impaired, the remedy is the
/// folder's), the message names the reason. It used to read the folder's own message alone, as if the op's item were
/// the unread one.
/// </summary>
public class ProjectDeclarationsUnverifiedFolderTests
{
    private sealed record Node(string Name, int Kind);

    /// <summary>Root → folder <c>F</c> (whose child count the driver refuses, coded) and FB <c>X</c>.</summary>
    private sealed class Tree : IProjectTree
    {
        private readonly object _root = new();
        private readonly Node _folder = new("F", ItemKind.PlcFolder);
        private readonly Node _fb = new("X", ItemKind.PlcPou);
        public ItemRef GetTreeRoot() => new(_root);
        public int ChildCount(ItemRef item) =>
            ReferenceEquals(item.Native, _root) ? 2
            : ReferenceEquals(item.Native, _folder)
                ? throw new BridgeException(ConflictCodes.ItemUnverified, "'F' holds 3 children, and the hierarchy lists 2")
                : 0;
        public ItemRef ChildAt(ItemRef parent, int index1Based) => new(index1Based == 1 ? _folder : _fb);
        public string Name(ItemRef item) => ((Node)item.Native).Name;
        public int KindCode(ItemRef item) => ((Node)item.Native).Kind;
        public WalkResult WalkItems() => throw new NotSupportedException();
        public ItemRef Parent(ItemRef item) => throw new NotSupportedException();
        public bool HandlesSurviveStructureChange => true;
        public ItemRef CreateChild(ItemRef parent, string name, int kindCode, string? seed = null) => throw new NotSupportedException();
        public (bool Get, bool Set) InterfacePropertyAccessors(ItemRef property) => throw new NotSupportedException();
        public void Delete(ItemRef parent, string name) => throw new NotSupportedException();
        public void Rename(ItemRef item, string newName) => throw new NotSupportedException();
        public void Move(ItemRef item, ItemRef target) => throw new NotSupportedException();
    }

    [Fact]
    public void A_folder_the_driver_will_not_read_refuses_with_the_reason_the_op_needed_it()
    {
        var declarations = new ProjectDeclarations(new Tree(), _ => null, Scopes.RefusedPouName);

        var ex = Assert.Throws<BridgeException>(() => declarations.KindOf(PushedDeclarations.None, "Motor"));

        Assert.Equal(ConflictCodes.ItemUnverified, ex.ErrorCode);
        Assert.Contains("'F' holds 3 children, and the hierarchy lists 2", ex.Message);
        Assert.Contains("every declaration of the project", ex.Message);
        Assert.Contains("the refusal is the folder's, not the item's", ex.Message);
    }
}
