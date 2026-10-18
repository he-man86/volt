using System.Linq;
using System.Text;
using Volt.Engine.Ide;
using Volt.Engine.Item;
using Xunit;
using static Volt.Ide.Twincat.Tests.TcUntouchablePouTests;

namespace Volt.Ide.Twincat.Tests;

/// <summary>
/// A RENAME BEFORE A MOVE TRAVELS WITH THE ITEM (PLC Assist, 2026-10-18, MultiProject: a `set` that renamed and moved
/// answered IDE_LOST_ITEM, the IDE holding the item moved under its OLD name).
///
/// <para>TwinCAT's move is an export, a delete and an import of the item's DOCUMENT (DIALECT D4f), and the document
/// carries the name it was last SAVED under: a tree rename is not in it until a save (vendor-facts
/// `tc-rename-then-move`, measured on 4024: renamed then moved, into a new or an existing folder, lands under the old
/// name; renamed, saved, then moved keeps the new one). So the move persists what is pending before it exports.</para>
/// </summary>
public class TcRenameThenMoveTests
{
    [Fact]
    public void A_renamed_item_moves_under_its_new_name()
    {
        var (driver, _, xae, root) = Project(x => new Node(x, "Untitled2 Project", ItemKind.PlcFolder, false,
            new Node(x, "POUs", ItemKind.PlcFolder, false,
                new Node(x, "Probe", ItemKind.PlcPou) { Document = Encoding.UTF8.GetBytes("<TcPlcObject/>") }),
            new Node(x, "Target", ItemKind.PlcFolder),
            new Node(x, "PLC_PRG", ItemKind.PlcPouProg)));
        var probe = ItemLookup.Find(driver, App + "/POUs/Probe.pou")!.Value;

        driver.Rename(probe, "Moved");
        var moved = ItemLookup.Find(driver, App + "/POUs/Moved.pou")!.Value;
        var top = driver.Parent(driver.Parent(moved));
        var target = Enumerable.Range(1, driver.ChildCount(top)).Select(i => driver.ChildAt(top, i))
            .Single(c => driver.Name(c) == "Target");
        driver.Move(moved, target);

        var landed = root.Kids.Single(k => k.Name == "Target").Kids.Select(k => k.Name).ToArray();
        Assert.Equal(new[] { "Moved" }, landed);
        Assert.False(xae.Dead);
    }
}
