using System.Linq;
using Volt.Engine.Ide;
using Volt.Engine.Item;
using Xunit;
using static Volt.Ide.Twincat.Tests.TcUntouchablePouTests;

namespace Volt.Ide.Twincat.Tests;

/// <summary>
/// A MOVE CARRIES WHAT THE IDE HOLDS, NOT WHAT WAS LAST SAVED (PLC Assist, 2026-10-18, MultiProject: a `set` that renamed
/// and moved answered IDE_LOST_ITEM, the IDE holding the item moved under its OLD name).
///
/// <para>TwinCAT's move is an export, a delete and an import of the item's DOCUMENT (DIALECT D4f), and the export is the
/// SAVED document (D45, vendor-facts <c>tc-rename-then-move</c>, <c>tc-unsaved-move</c>, measured on 4024): a rename, and an
/// implementation written since the save, are not in it. Volt never saves the engineer's project, so the move writes the
/// live texts into the archive before the import and gives the imported item its live name after it.</para>
/// </summary>
public class TcRenameThenMoveTests
{
    private static (Volt.Ide.Twincat.BeckhoffDriver Driver, Node Root, Xae Xae) Probe(string saved, string body)
    {
        var (driver, _, xae, root) = Project(x => new Node(x, "Untitled2 Project", ItemKind.PlcFolder, false,
            new Node(x, "POUs", ItemKind.PlcFolder, false,
                new Node(x, "Probe", ItemKind.PlcPou)
                {
                    Document = Node.PouDocument("Probe", "PROGRAM Probe\nVAR\nEND_VAR\n", saved),
                    DeclarationText = "PROGRAM Probe\nVAR\nEND_VAR\n",
                    ImplementationText = body,
                }),
            new Node(x, "Target", ItemKind.PlcFolder),
            new Node(x, "PLC_PRG", ItemKind.PlcPouProg)));
        return (driver, root, xae);
    }

    private static ItemRef Target(Volt.Ide.Twincat.BeckhoffDriver driver, ItemRef item)
    {
        var top = driver.Parent(driver.Parent(item));
        return Enumerable.Range(1, driver.ChildCount(top)).Select(i => driver.ChildAt(top, i))
            .Single(c => driver.Name(c) == "Target");
    }

    [Fact]
    public void A_renamed_item_moves_under_its_new_name()
    {
        var (driver, root, xae) = Probe(saved: "x := 1;", body: "x := 1;");
        var probe = ItemLookup.Find(driver, App + "/POUs/Probe.pou")!.Value;

        driver.Rename(probe, "Moved");
        var moved = ItemLookup.Find(driver, App + "/POUs/Moved.pou")!.Value;
        driver.Move(moved, Target(driver, moved));

        var landed = root.Kids.Single(k => k.Name == "Target").Kids.Select(k => k.Name).ToArray();
        Assert.Equal(new[] { "Moved" }, landed);
        Assert.False(xae.Dead);
    }

    [Fact]
    public void An_implementation_written_since_the_save_moves_with_the_item()
    {
        var (driver, root, _) = Probe(saved: "x := 1;", body: "x := 7;");
        var probe = ItemLookup.Find(driver, App + "/POUs/Probe.pou")!.Value;

        driver.Move(probe, Target(driver, probe));

        var landed = root.Kids.Single(k => k.Name == "Target").Kids.Single();
        Assert.Equal("x := 7;", landed.ImplementationText);
    }

    /// <summary>A member the IDE holds and the saved document does not (renamed since the save) would be dropped by the
    /// import: refused by name before anything is deleted.</summary>
    [Fact]
    public void A_member_the_saved_document_lacks_is_refused_before_the_item_is_deleted()
    {
        var (driver, root, _) = Probe(saved: "x := 1;", body: "x := 1;");
        var probeNode = root.Kids.Single(k => k.Name == "POUs").Kids.Single(k => k.Name == "Probe");
        probeNode.Kids.Add(new Node(XaeOf(probeNode), "Renamed", ItemKind.PlcMethod)
            { Owner = probeNode });
        var probe = ItemLookup.Find(driver, App + "/POUs/Probe.pou")!.Value;

        var ex = Assert.Throws<Volt.Engine.BridgeException>(() => driver.Move(probe, Target(driver, probe)));

        Assert.Equal(Volt.Contracts.BridgeErrorCodes.Unsupported, ex.ErrorCode);
        Assert.Contains("'Renamed'", ex.Message);
        Assert.Contains("Probe", root.Kids.Single(k => k.Name == "POUs").Kids.Select(k => k.Name));
    }

    private static Xae XaeOf(Node n) => (Xae)typeof(Node).GetField("_xae", System.Reflection.BindingFlags.NonPublic |
                                                                        System.Reflection.BindingFlags.Instance)!.GetValue(n)!;

    /// <summary>A CASE-ONLY rename left unsaved makes XAE ask, modally, to reload a file "changed outside the
    /// environment" (D45): it goes through another name first, which asks nothing.</summary>
    [Fact]
    public void A_case_only_rename_goes_through_another_name()
    {
        var (driver, root, _) = Probe(saved: "x := 1;", body: "x := 1;");
        var probe = ItemLookup.Find(driver, App + "/POUs/Probe.pou")!.Value;

        driver.Rename(probe, "PROBE");

        var node = root.Kids.Single(k => k.Name == "POUs").Kids.Single(k => k.Name == "PROBE");
        Assert.Equal(2, node.Renames.Count);
        Assert.NotEqual("PROBE", node.Renames[0], System.StringComparer.OrdinalIgnoreCase);
        Assert.Equal("PROBE", node.Renames[1]);
    }

    /// <summary>XAE holds a document per member a write reached, dirty until a save, and deleting the item asks MODALLY
    /// to save them (D45). The delete closes the deleted item's member documents first, without saving, and touches no
    /// other document.</summary>
    [Fact]
    public void A_delete_closes_the_deleted_items_member_documents_without_saving()
    {
        var (driver, _, _) = Probe(saved: "x := 1;", body: "x := 1;");
        var window = LastWindow!;
        var own = new TcAttachTests.Document(window, @"C:\p\Probe.TcPOU");
        var member = new TcAttachTests.Document(window, @"C:\p\Probe.TcPOU;Probe.P.Get");
        var foldered = new TcAttachTests.Document(window, @"C:\p\Probe.TcPOU;Probe\Helpers\Deep");
        var other = new TcAttachTests.Document(window, @"C:\p\Other.TcPOU;Other.M");
        window.Documents.AddRange(new[] { own, member, foldered, other });
        var probe = ItemLookup.Find(driver, App + "/POUs/Probe.pou")!.Value;

        driver.Delete(driver.Parent(probe), "Probe");

        Assert.Equal(2, member.ClosedWith);   // vsSaveChangesNo
        Assert.Equal(2, foldered.ClosedWith);
        Assert.Null(own.ClosedWith);
        Assert.Null(other.ClosedWith);
        Assert.Empty(window.Commands);
    }

    [Fact]
    public void A_member_delete_closes_that_members_documents_only()
    {
        var (driver, _, _) = Probe(saved: "x := 1;", body: "x := 1;");
        var window = LastWindow!;
        var deep = new TcAttachTests.Document(window, @"C:\p\Probe.TcPOU;Probe\Helpers\Deep");
        var getter = new TcAttachTests.Document(window, @"C:\p\Probe.TcPOU;Probe.P.Get");
        window.Documents.AddRange(new[] { deep, getter });
        var probe = ItemLookup.Find(driver, App + "/POUs/Probe.pou")!.Value;

        driver.Delete(probe, "Deep");

        Assert.Equal(2, deep.ClosedWith);
        Assert.Null(getter.ClosedWith);
    }

    [Fact]
    public void A_move_asks_the_shell_for_no_save()
    {
        var (driver, _, _) = Probe(saved: "x := 1;", body: "x := 7;");
        var probe = ItemLookup.Find(driver, App + "/POUs/Probe.pou")!.Value;

        driver.Rename(probe, "Moved");
        var moved = ItemLookup.Find(driver, App + "/POUs/Moved.pou")!.Value;
        driver.Move(moved, Target(driver, moved));

        Assert.Empty(LastWindow!.Commands);
    }
}
