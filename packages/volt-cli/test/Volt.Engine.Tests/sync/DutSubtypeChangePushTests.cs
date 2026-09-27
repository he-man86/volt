using System.Collections.Generic;
using System.Linq;
using Xunit;
using Volt.Contracts;
using Volt.Engine.Sync;
using Volt.Engine.Item;

namespace Volt.Engine.Tests;

/// <summary>
/// A DUT SUBTYPE CHANGE IS ONE UPDATE OF THE SAME IDE OBJECT, decided here in <c>PushService</c> and nowhere
/// above it (openspec <c>dut-subtype-on-the-wire</c>, requirement "a subtype change is an update of the same
/// object").
///
/// <para>Once the wire names a DUT by its subtype, rewriting <c>X.struct</c> as an enum reaches the bridge as a
/// name change — and below the vendor seam the four names are ONE object, the bare <c>X</c>. Both vendors take a
/// new shape in place, same object, same folder (measured live, DIALECT C2e), so the right answer is a content
/// update and never a delete plus a create, which would lose the object's identity and folder.</para>
///
/// <para><b>What today's code does instead was measured (task 1.1)</b> and is worse than a recreate. The two
/// git shapes: a RENAME, and a DELETE + ADD (a struct→enum rewrite shares little text, so git often sees no
/// rename). The second sent two ops on one name: in one path order the set landed and the delete was refused
/// mid-push (a partial write), in the other the pre-flight refused it for ever; and under <c>--force</c>, which
/// drops the version gates, one order ACCEPTED and deleted the DUT and the other deleted it and then failed —
/// the obvious way out lost the object. So both orders must coalesce, with and without force: force drops the
/// version gate, never the pairing.</para>
/// </summary>
public class DutSubtypeChangePushTests
{
    private const string Struct = "TYPE X :\nSTRUCT\n\ta : INT;\nEND_STRUCT\nEND_TYPE\n";
    private const string Enum = "TYPE X :\n(\n\tIdle := 0,\n\tRun\n);\nEND_TYPE\n";

    /// <summary>A project holding one STRUCT DUT <c>X</c> in folder <c>DUTs</c>, and its refs.</summary>
    private static (FakeIde Ide, RefsResponse Refs) StructInDuts()
    {
        var ide = new FakeIde(new FakeIde.Item("X", ItemKind.PlcDut, "DUTs", true, Struct, null, null, null));
        return (ide, RefsService.Handle(ide));
    }

    private static PushResponse Push(FakeIde ide, RefsResponse refs, params PushOp[] ops) =>
        PushService.Handle(ide, new PushRequest { ExpectedProjectVersion = refs.ProjectVersion, Ops = ops.ToList() });

    private static PushResponse ForcePush(FakeIde ide, params PushOp[] ops) =>
        PushService.Handle(ide, new PushRequest { Force = true, Ops = ops.ToList() });

    private static string Reasons(PushResponse r) =>
        r.Conflicts is null ? "" : string.Join("; ", r.Conflicts.Select(c => $"{c.Name}: [{c.Code}] {c.Reason}"));

    /// <summary>The state every accepted subtype change must leave: the SAME object <c>X</c> (never deleted,
    /// never created), holding the enum, still in <c>DUTs</c>; <c>refs</c> — and the receipt, which the client
    /// adopts as its baseline with no follow-up refs — name it <c>X.enum</c> and no longer <c>X.struct</c>.</summary>
    private static void AssertOneUpdateToEnum(FakeIde ide, PushResponse resp)
    {
        Assert.True(resp.Accepted, Reasons(resp));
        Assert.Equal(new[] { "writecontent:X" }, ide.Recorded.ToArray());
        Assert.True(ide.Exists("X"), "the DUT is gone from the IDE");
        Assert.Contains("Idle := 0", ide.WrittenContent["X"].Declaration);

        var refs = RefsService.Handle(ide);
        Assert.Equal(new[] { "X.enum" }, refs.Items.Keys.ToArray());
        Assert.Equal("DUTs", refs.Folders["X.enum"]);
        Assert.Equal(refs.Items.OrderBy(k => k.Key), resp.NewItems!.OrderBy(k => k.Key));
        Assert.Equal("DUTs", resp.NewFolders!["X.enum"]);
    }

    // ── git sees a rename ──────────────────────────────────────────────────────────────────────────

    [Fact]
    public void A_rename_to_another_subtype_is_one_content_update_not_a_rename()
    {
        var (ide, refs) = StructInDuts();
        var resp = Push(ide, refs,
            new SetItemOp { Name = "X.struct", ToName = "X.enum", IfVersion = refs.Items["X.struct"], SourceText = Enum });

        AssertOneUpdateToEnum(ide, resp);
    }

    /// <summary>The rename keeps the version gate an update has: a stale <c>ifVersion</c> is a conflict, and
    /// nothing is written.</summary>
    [Fact]
    public void A_subtype_rename_with_a_stale_version_is_refused_as_a_version_conflict()
    {
        var (ide, refs) = StructInDuts();
        var resp = Push(ide, refs,
            new SetItemOp { Name = "X.struct", ToName = "X.enum", IfVersion = "stale", SourceText = Enum });

        Assert.False(resp.Accepted);
        Assert.Contains(resp.Conflicts!, c => c.Name == "X.struct" && c.Code == ConflictCodes.StaleItemVersion);
        Assert.Empty(ide.Recorded);
    }

    // ── git sees delete + add ──────────────────────────────────────────────────────────────────────

    /// <summary>BOTH ORDERS. Which op comes first is git's path order (<c>X.enum</c> sorts before
    /// <c>X.struct</c>, <c>X.union</c> after), not a meaning — and each order failed differently before.</summary>
    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public void A_delete_plus_create_of_another_subtype_coalesces_into_one_update(bool deleteFirst)
    {
        var (ide, refs) = StructInDuts();
        PushOp del = new DeleteItemOp { Name = "X.struct", IfVersion = refs.Items["X.struct"] };
        PushOp set = new SetItemOp { Name = "X.enum", IfVersion = null, SourceText = Enum };

        var resp = Push(ide, refs, deleteFirst ? new[] { del, set } : new[] { set, del });

        AssertOneUpdateToEnum(ide, resp);
    }

    /// <summary>The DELETE's <c>ifVersion</c> is the pair's guard — it is the only version the client quoted —
    /// so a stale one is refused exactly as a stale update is, and nothing is written.</summary>
    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public void A_stale_version_on_the_paired_delete_is_refused_as_a_version_conflict(bool deleteFirst)
    {
        var (ide, refs) = StructInDuts();
        PushOp del = new DeleteItemOp { Name = "X.struct", IfVersion = "stale" };
        PushOp set = new SetItemOp { Name = "X.enum", IfVersion = null, SourceText = Enum };

        var resp = Push(ide, refs, deleteFirst ? new[] { del, set } : new[] { set, del });

        Assert.False(resp.Accepted);
        Assert.Contains(resp.Conflicts!, c => c.Name == "X.struct" && c.Code == ConflictCodes.StaleItemVersion);
        Assert.Empty(ide.Recorded);
        Assert.Equal(new[] { "X.struct" }, RefsService.Handle(ide).Items.Keys.ToArray());
    }

    /// <summary>`--force` DROPS THE GATE, NEVER THE PAIRING. Measured today (1.1): `[set, delete]` forced was
    /// ACCEPTED with the DUT deleted; `[delete, set]` forced deleted it and then failed INTERNAL_ERROR writing
    /// through the dead handle. Either way the object, its identity and its folder were gone.</summary>
    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public void A_forced_delete_plus_create_of_another_subtype_is_still_one_update(bool deleteFirst)
    {
        var (ide, refs) = StructInDuts();
        PushOp del = new DeleteItemOp { Name = "X.struct", IfVersion = refs.Items["X.struct"] };
        PushOp set = new SetItemOp { Name = "X.enum", IfVersion = null, SourceText = Enum };

        var resp = ForcePush(ide, deleteFirst ? new[] { del, set } : new[] { set, del });

        AssertOneUpdateToEnum(ide, resp);
    }

    // ── what is NOT a subtype change ───────────────────────────────────────────────────────────────

    /// <summary>TWO SETS ON ONE BARE DUT are not a subtype change — they are two answers to "what is X?", and
    /// ordering them would pick one silently. Refused by name, both ops named, nothing written.</summary>
    [Fact]
    public void Two_sets_on_one_bare_dut_are_refused_naming_both()
    {
        var (ide, refs) = StructInDuts();
        var resp = Push(ide, refs,
            new SetItemOp { Name = "X.struct", IfVersion = refs.Items["X.struct"], SourceText = Struct.Replace("a : INT", "a : DINT") },
            new SetItemOp { Name = "X.enum", IfVersion = null, SourceText = Enum });

        Assert.False(resp.Accepted);
        var conflict = Assert.Single(resp.Conflicts!);
        Assert.Equal(BridgeErrorCodes.BadRequest, conflict.Code);
        Assert.Contains("X.struct", conflict.Reason);
        Assert.Contains("X.enum", conflict.Reason);
        Assert.Empty(ide.Recorded);
    }

    /// <summary>A delete and a create of the SAME subtype is not a subtype change either — the rule pairs a
    /// delete of one subtype with a create of ANOTHER; anything else landing two ops on one bare DUT is
    /// refused, never ordered.</summary>
    [Fact]
    public void A_delete_plus_create_of_the_same_subtype_is_refused_naming_both()
    {
        var (ide, refs) = StructInDuts();
        var resp = Push(ide, refs,
            new DeleteItemOp { Name = "X.struct", IfVersion = refs.Items["X.struct"] },
            new SetItemOp { Name = "X.struct", IfVersion = null, SourceText = Struct });

        Assert.False(resp.Accepted);
        var conflict = Assert.Single(resp.Conflicts!);
        Assert.Equal(BridgeErrorCodes.BadRequest, conflict.Code);
        Assert.Equal(2, CountOf("X.struct", conflict.Reason));
        Assert.Empty(ide.Recorded);
    }

    /// <summary>A DELETE WITH NO PAIRED SET STILL DELETES. The coalescing must not swallow the ordinary case.</summary>
    [Fact]
    public void A_lone_delete_of_a_subtype_name_deletes_the_dut()
    {
        var (ide, refs) = StructInDuts();
        var resp = Push(ide, refs, new DeleteItemOp { Name = "X.struct", IfVersion = refs.Items["X.struct"] });

        Assert.True(resp.Accepted, Reasons(resp));
        Assert.Contains("delete:X", ide.Recorded);
        Assert.False(ide.Exists("X"));
        Assert.Empty(RefsService.Handle(ide).Items);
    }

    /// <summary>A plain update under the subtype name the IDE already has stays a plain update.</summary>
    [Fact]
    public void An_update_under_the_current_subtype_name_is_an_ordinary_update()
    {
        var (ide, refs) = StructInDuts();
        var resp = Push(ide, refs,
            new SetItemOp { Name = "X.struct", IfVersion = refs.Items["X.struct"], SourceText = Struct.Replace("a : INT", "a : DINT") });

        Assert.True(resp.Accepted, Reasons(resp));
        Assert.Equal(new[] { "writecontent:X" }, ide.Recorded.ToArray());
        Assert.Equal(new[] { "X.struct" }, RefsService.Handle(ide).Items.Keys.ToArray());
    }

    private static int CountOf(string needle, string hay)
    {
        int n = 0, at = 0;
        while ((at = hay.IndexOf(needle, at, System.StringComparison.Ordinal)) >= 0) { n++; at += needle.Length; }
        return n;
    }
}
