using System.Collections.Generic;
using System.Linq;
using Xunit;
using Volt.Contracts;
using Volt.Engine.Item;
using Volt.Engine.Sync;

namespace Volt.Engine.Tests;

/// <summary>
/// ONE OP PER WIRE IDENTITY (openspec <c>push-without-header-check</c> 5.Q.6, design 5.Qb Q2).
///
/// <para>A batch that names one item in two ops — <c>deleteItem X.gvl</c> beside <c>set X.gvl</c>, in either order — was
/// the one path on which a push could replace an IDE object, and with it the class the wire does not carry: the apply
/// resolves the set from the pre-apply walk's cache, which a delete never updates. Measured live on a Pro2193 copy
/// (<c>scripts/merged-classes.log</c>): forced, <c>[deleteItem, set]</c> of <c>PersistentVars.gvl</c> (a
/// <c>VarPersistentObject</c>) deleted it and then failed on its dead GUID, and <c>[set, deleteItem]</c> of
/// <c>CheckBounds.pou</c> (a <c>POUObjectCheckFunction</c>) was ACCEPTED with the object gone. And the CLI sent exactly
/// that batch for a file moved and edited past git's rename threshold.</para>
///
/// <para>Refused <c>BAD_REQUEST</c> by name in the pre-flight, before anything is applied. An update, a rename and a
/// move are ONE <c>set</c>; a delete and a create of the same name are two pushes.</para>
/// </summary>
public class OneOpPerItemTests
{
    private const string Gvl = "VAR_GLOBAL\n\tn : INT;\nEND_VAR";

    private static FakeIde Ide() => new(
        new FakeIde.Item("X", ItemKind.PlcGvl, "GVLs", true, Gvl, null, null, null),
        new FakeIde.Item("B", ItemKind.PlcGvl, "GVLs", true, Gvl, null, null, null),
        FakeIde.Item.TextualPou("A", "FUNCTION_BLOCK A\nVAR\nEND_VAR", "x := 1;"));

    private static PushResponse Push(FakeIde ide, bool force, System.Func<RefsResponse, List<PushOp>> ops)
    {
        var refs = RefsService.Handle(ide);
        return PushService.Handle(ide, new PushRequest
        {
            ExpectedProjectVersion = refs.ProjectVersion,
            Force = force,
            Ops = ops(refs),
        });
    }

    private static void AssertRefusedNamingIt(FakeIde ide, PushResponse resp, string name, string ops)
    {
        Assert.False(resp.Accepted, "a batch naming one item in two ops was accepted");
        var conflict = Assert.Single(resp.Conflicts!);
        Assert.Equal(BridgeErrorCodes.BadRequest, conflict.Code);
        Assert.Contains($"'{name}' is named by two ops in this push ({ops})", conflict.Reason);
        Assert.Contains("One op per item", conflict.Reason);
        Assert.Empty(ide.Recorded);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public void A_delete_then_a_set_of_one_name_is_refused_before_anything_is_applied(bool force)
    {
        var ide = Ide();
        var resp = Push(ide, force, refs => new List<PushOp>
        {
            new DeleteItemOp { Name = "X.gvl", IfVersion = refs.Items["X.gvl"] },
            new SetItemOp { Name = "X.gvl", IfVersion = refs.Items["X.gvl"], SourceText = Gvl + "\n// edited\n" },
        });

        AssertRefusedNamingIt(ide, resp, "X.gvl", "deleteItem, set");
        Assert.True(ide.Exists("X"));
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public void A_set_then_a_delete_of_one_name_is_refused_before_anything_is_applied(bool force)
    {
        var ide = Ide();
        var resp = Push(ide, force, refs => new List<PushOp>
        {
            new SetItemOp { Name = "X.gvl", IfVersion = refs.Items["X.gvl"], SourceText = Gvl + "\n// edited\n" },
            new DeleteItemOp { Name = "X.gvl", IfVersion = refs.Items["X.gvl"] },
        });

        AssertRefusedNamingIt(ide, resp, "X.gvl", "set, deleteItem");
        Assert.True(ide.Exists("X"));
    }

    /// <summary>A rename's TARGET is an identity the batch touches too: renaming <c>A</c> to <c>B</c> next to a set of
    /// <c>B</c> addresses <c>B</c> twice.</summary>
    [Fact]
    public void A_rename_onto_a_name_another_op_sets_is_refused()
    {
        var ide = Ide();
        var resp = Push(ide, force: false, refs => new List<PushOp>
        {
            new SetItemOp { Name = "X.gvl", ToName = "B.gvl", IfVersion = refs.Items["X.gvl"] },
            new SetItemOp { Name = "B.gvl", IfVersion = refs.Items["B.gvl"], SourceText = Gvl + "\n// edited\n" },
        });

        AssertRefusedNamingIt(ide, resp, "B.gvl", "set, set");
    }

    /// <summary>Identity is case-insensitive here as everywhere else (the apply resolves an op by its bare name ignoring
    /// case), so <c>x.gvl</c> and <c>X.gvl</c> are one item.</summary>
    [Fact]
    public void Case_variants_of_one_name_are_one_item()
    {
        var ide = Ide();
        var resp = Push(ide, force: true, refs => new List<PushOp>
        {
            new DeleteItemOp { Name = "X.gvl", IfVersion = null },
            new SetItemOp { Name = "x.gvl", IfVersion = null, SourceText = Gvl + "\n" },
        });

        AssertRefusedNamingIt(ide, resp, "x.gvl", "deleteItem, set");
    }

    /// <summary>Two wire identities that share a BARE name are two items on the wire, but the apply resolves each op
    /// from a cache keyed by the BARE name (the IDE's own lookup key), which a delete never updates. So
    /// <c>deleteItem X.pou</c> + <c>set X.dut</c> — the re-type route, in either order — deleted the POU and then
    /// resolved the set to its dead handle: a push REJECTED with one item already written. Refused by name in the
    /// pre-flight instead, before anything is applied; a re-type in one push is <c>bridge-refusal-review</c>'s.</summary>
    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public void A_delete_and_a_set_of_one_bare_name_in_two_kinds_are_refused_before_anything_is_applied(bool deleteFirst)
    {
        var ide = new FakeIde(FakeIde.Item.TextualPou("A", "FUNCTION_BLOCK A\nVAR\nEND_VAR", "x := 1;"));
        var resp = Push(ide, force: false, refs =>
        {
            PushOp del = new DeleteItemOp { Name = "A.pou", IfVersion = refs.Items["A.pou"] };
            PushOp set = new SetItemOp { Name = "A.dut", IfVersion = null, SourceText = "TYPE A :\nSTRUCT\n\tn : INT;\nEND_STRUCT\nEND_TYPE\n" };
            return deleteFirst ? new List<PushOp> { del, set } : new List<PushOp> { set, del };
        });

        Assert.False(resp.Accepted, "a delete and a set of one bare name in two kinds was accepted");
        var conflict = Assert.Single(resp.Conflicts!);
        Assert.Equal(BridgeErrorCodes.BadRequest, conflict.Code);
        Assert.Contains("one IDE object", conflict.Reason);
        Assert.Empty(ide.Recorded);
        Assert.True(ide.Exists("A"));
    }

    /// <summary>The ordinary shapes are untouched: one op per item, and a rename+move+edit whose target no other op
    /// names.</summary>
    [Fact]
    public void One_op_per_item_is_accepted()
    {
        var ide = Ide();
        var resp = Push(ide, force: false, refs => new List<PushOp>
        {
            new SetItemOp { Name = "X.gvl", ToName = "Y.gvl", ToFolder = "Other", IfVersion = refs.Items["X.gvl"], SourceText = Gvl + "\n// edited\n" },
            new DeleteItemOp { Name = "B.gvl", IfVersion = refs.Items["B.gvl"] },
        });

        Assert.True(resp.Accepted, resp.Conflicts?.FirstOrDefault()?.Reason);
    }
}
