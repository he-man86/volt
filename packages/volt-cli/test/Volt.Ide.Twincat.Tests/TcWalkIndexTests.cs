using System.Collections.Generic;
using System.Linq;
using Volt.Engine.Ide;
using Volt.Engine.Item;
using Xunit;
using Volt.Tests.Shared;
using static Volt.Ide.Twincat.Tests.TcUntouchablePouTests;

namespace Volt.Ide.Twincat.Tests;

/// <summary>
/// THE DECLARATIONS INDEX IS THE OPERATION'S OWN WALK (openspec <c>twincat-large-solution-refs</c>). A graphical body
/// resolves the names it calls against every top-level item of the project (<see cref="ProjectDeclarations"/>), and that
/// index was a second full walk of the solution (<see cref="ItemLookup.All"/>), a cross-process COM call per node, in
/// every operation that read one. The walk the operation already made lists the same items in the same order, so the
/// index is taken from it — while it still describes the tree: never after a structural write since it, never from a
/// walk that did not read every folder.
/// </summary>
public class TcWalkIndexTests
{
    /// <summary>Two folders holding a name twice (a DUT and an FB <c>X</c>: the first in tree order wins), an excluded
    /// folder (its items are named unreadable by the walk, and still declare names), a task, a nested folder.</summary>
    private static Node Tree(Xae x) =>
        new(x, "Untitled2 Project", ItemKind.PlcFolder, false,
            new Node(x, "DUTs", ItemKind.PlcFolder, false, new Node(x, "X", ItemKind.PlcDutStruct), new Node(x, "E_Mode", ItemKind.PlcDutEnum)),
            new Node(x, "POUs", ItemKind.PlcFolder, false,
                new Node(x, "X", ItemKind.PlcPou),
                new Node(x, "Inner", ItemKind.PlcFolder, false, new Node(x, "Motor", ItemKind.PlcPou), new Node(x, "F_Scale", ItemKind.PlcPouFunc))),
            new TcExclusionTests.Folder(x, "Old", "True", new Node(x, "Legacy", ItemKind.PlcPou)),
            new Node(x, "G_IO", ItemKind.PlcGvl),
            new Node(x, "PlcTask", ItemKind.PlcTask),
            new Node(x, "MAIN", ItemKind.PlcPouProg));

    private static IEnumerable<(object Com, string Name, int Kind)> Shape(IEnumerable<(ItemRef Item, string Name, int Kind)> items) =>
        items.Select(i => (((BeckhoffDriver.TcNode)i.Item.Native).Com, i.Name, i.Kind));

    [Fact]
    public void The_walks_index_is_the_tree_walks_item_for_item_in_order()
    {
        var (driver, _, _, _) = Project(Tree);

        driver.WalkItems();
        var fromWalk = driver.WalkIndex();

        Assert.NotNull(fromWalk);
        Assert.Equal(Shape(ItemLookup.All(driver)), Shape(fromWalk!));
        Assert.Contains(fromWalk!, i => i.Name == "Legacy");   // under the excluded folder: still a name a body may call
    }

    [Fact]
    public void A_name_held_twice_resolves_to_the_first_in_tree_order_as_before()
    {
        var (driver, _, _, _) = Project(Tree);
        driver.WalkItems();

        Assert.Equal(ItemKind.Kinds.Dut, driver.Declarations.KindOf(PushedDeclarations.None, "X"));
    }

    [Fact]
    public void Resolving_a_name_after_the_walk_asks_the_IDE_nothing_more_of_the_tree()
    {
        var (driver, _, xae, _) = Project(Tree);
        driver.WalkItems();
        xae.TypeReads.Clear();
        xae.NameReads.Clear();

        Assert.Equal(ItemKind.Kinds.Pou, driver.Declarations.KindOf(PushedDeclarations.None, "Motor"));

        Assert.Empty(xae.TypeReads);
        Assert.Empty(xae.NameReads);
    }

    [Fact]
    public void A_structural_write_since_the_walk_leaves_the_index_to_its_own_walk()
    {
        var (driver, _, _, root) = Project(Tree);
        var walk = driver.WalkItems();
        var pous = walk.Items.Single(i => i.Name == "Motor").Item;

        driver.CreateChild(driver.Parent(pous), "Pump", ItemKind.PlcPou, null, null);

        Assert.Null(driver.WalkIndex());
        Assert.Equal(ItemKind.Kinds.Pou, driver.Declarations.KindOf(PushedDeclarations.None, "Pump"));
    }

    [Fact]
    public void A_walk_that_did_not_read_every_folder_gives_no_index()
    {
        var (driver, _, _, _) = Project(x => new Node(x, "Untitled2 Project", ItemKind.PlcFolder, false,
            new TcExclusionTests.Folder(x, "Odd", "Maybe", new Node(x, "Motor", ItemKind.PlcPou)),
            new Node(x, "MAIN", ItemKind.PlcPouProg)));

        var walk = driver.WalkItems();

        Assert.False(walk.Complete);
        Assert.Null(driver.WalkIndex());
    }
}
