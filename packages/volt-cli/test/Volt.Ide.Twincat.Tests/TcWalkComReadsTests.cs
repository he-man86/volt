using System.Linq;
using Volt.Engine.Item;
using Xunit;
using static Volt.Ide.Twincat.Tests.TcUntouchablePouTests;

namespace Volt.Ide.Twincat.Tests;

/// <summary>
/// A WALK ASKS EACH NODE WHAT IT IS ONCE (TwinCAT e2e profile, 2026-10-18: `refs` ≈ 310 <c>ItemType</c>, 134 <c>Name</c> and
/// 60 <c>NestedProject</c> cross-process calls on MultiProject). Each is an out-of-process COM round trip, and every
/// repeat below asked the IDE a fact the same operation had just read: the child count of a node whose kind the walk
/// had classified re-asked its kind, the PLC project's root was asked of the PLC item on every use, and reading a walked
/// item's content asked its kind twice and its name twice more — the name only for an error message nobody saw.
/// </summary>
public class TcWalkComReadsTests
{
    private static Node Tree(Xae x) =>
        new(x, "Untitled2 Project", ItemKind.PlcFolder, false,
            new Node(x, "POUs", ItemKind.PlcFolder, false,
                new Node(x, "Motor", ItemKind.PlcPou),
                new Node(x, "Inner", ItemKind.PlcFolder, false, new Node(x, "Pump", ItemKind.PlcPou))),
            new Node(x, "PLC_PRG", ItemKind.PlcPouProg));

    [Fact]
    public void The_walk_reads_each_nodes_kind_once()
    {
        var (driver, _, xae, _) = Project(Tree);
        xae.TypeReads.Clear();

        driver.WalkItems();

        Assert.Equal(new[] { "Inner", "Motor", "PLC_PRG", "POUs", "Pump", "Untitled2 Project" }, xae.TypeReads.Keys.OrderBy(k => k));
        Assert.All(xae.TypeReads, r => Assert.Equal(1, r.Value));
    }

    [Fact]
    public void Reading_a_walked_items_content_asks_neither_its_kind_nor_its_name_again()
    {
        var (driver, _, xae, _) = Project(Tree);
        var motor = driver.WalkItems().Items.Single(i => i.Name == "Motor");
        xae.TypeReads.Clear();
        xae.NameReads.Clear();

        driver.ReadContent(motor.Item);

        Assert.False(xae.TypeReads.ContainsKey("Motor"), "kind read again");
        Assert.False(xae.NameReads.ContainsKey("Motor"), "name read again");
    }

    [Fact]
    public void The_PLC_projects_root_is_asked_once_per_operation()
    {
        var (driver, model, xae, _) = Project(Tree);
        model.ForgetExplorer();   // a new operation
        xae.NestedReads = 0;

        driver.WalkItems();
        driver.WalkItems();
        Assert.Equal(1, xae.NestedReads);

        model.ForgetExplorer();   // the next operation asks again
        driver.WalkItems();
        Assert.Equal(2, xae.NestedReads);
    }
}
