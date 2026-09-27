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

    // ── a subtype change that also MOVES the DUT ───────────────────────────────────────────────────

    /// <summary>A SUBTYPE CHANGE PLUS A MOVE KEEPS THE MOVE. The CLI sends every create with its folder
    /// (<c>ToFolder</c> = the new file's folder), so an engineer who rewrites <c>DUTs/X.struct</c> as
    /// <c>Types/X.enum</c> sends the pair (or the rename) WITH a folder. Coalescing into one content update of
    /// <c>X</c> must carry that folder: dropping it leaves <c>X</c> in <c>DUTs</c> while the receipt — which the
    /// client adopts as its baseline — and the workspace both say <c>Types</c>. Later updates carry no folder
    /// and a pull short-circuits on an equal version, so the two sides would disagree about the folder for
    /// good. The object is still never deleted or created: a move is not a recreate.</summary>
    [Theory]
    [InlineData("rename", false)]
    [InlineData("rename", true)]
    [InlineData("delete-first", false)]
    [InlineData("delete-first", true)]
    [InlineData("set-first", false)]
    [InlineData("set-first", true)]
    public void A_subtype_change_into_another_folder_is_one_update_that_keeps_the_move(string shape, bool force)
    {
        var (ide, refs) = StructInDuts();
        PushOp del = new DeleteItemOp { Name = "X.struct", IfVersion = refs.Items["X.struct"] };
        PushOp set = new SetItemOp { Name = "X.enum", IfVersion = null, ToFolder = "Types", SourceText = Enum };
        var ops = shape switch
        {
            "rename" => new PushOp[]
            {
                new SetItemOp { Name = "X.struct", ToName = "X.enum", ToFolder = "Types", IfVersion = refs.Items["X.struct"], SourceText = Enum },
            },
            "delete-first" => new[] { del, set },
            _ => new[] { set, del },
        };

        var resp = force ? ForcePush(ide, ops) : Push(ide, refs, ops);

        Assert.True(resp.Accepted, Reasons(resp));
        Assert.DoesNotContain(ide.Recorded, x => x.StartsWith("delete:") || x.StartsWith("create:") || x.StartsWith("rename:"));
        Assert.Contains("writecontent:X", ide.Recorded);
        Assert.True(ide.Exists("X"), "the DUT is gone from the IDE");
        var after = RefsService.Handle(ide);
        Assert.Equal(new[] { "X.enum" }, after.Items.Keys.ToArray());
        Assert.Equal("Types", after.Folders["X.enum"]);
        Assert.Equal("Types", resp.NewFolders!["X.enum"]);
    }

    // ── a rename ACROSS bare names is still a rename ───────────────────────────────────────────────

    /// <summary>ONLY A NAME THAT DIFFERS IN THE SUBTYPE ALONE IS A SUBTYPE CHANGE. `X.struct → Y.struct` is an
    /// ordinary rename, and `X.struct → Y.enum` (with an enum body) is a rename AND a subtype change: in both the
    /// object must end up named `Y` — renamed, never deleted and recreated, and never left as `X` by a rule that
    /// sent every DUT `toName` with a different extension down the content-update path.</summary>
    [Theory]
    [InlineData("Y.struct", "TYPE Y :\nSTRUCT\n\ta : INT;\nEND_STRUCT\nEND_TYPE\n")]
    [InlineData("Y.enum", "TYPE Y :\n(\n\tIdle := 0,\n\tRun\n);\nEND_TYPE\n")]
    public void A_dut_rename_to_another_bare_name_renames_the_object(string toName, string body)
    {
        var (ide, refs) = StructInDuts();
        var resp = Push(ide, refs,
            new SetItemOp { Name = "X.struct", ToName = toName, IfVersion = refs.Items["X.struct"], SourceText = body });

        Assert.True(resp.Accepted, Reasons(resp));
        Assert.Contains("rename:X->Y", ide.Recorded);
        Assert.DoesNotContain(ide.Recorded, x => x.StartsWith("delete:") || x.StartsWith("create:"));
        Assert.False(ide.Exists("X"), "X is still in the IDE: the rename was taken as a content update of X");
        var after = RefsService.Handle(ide);
        Assert.Equal(new[] { toName }, after.Items.Keys.ToArray());
        Assert.Equal("DUTs", after.Folders[toName]);
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

    /// <summary>TWO DELETES ON ONE BARE DUT are the same "anything else": one object cannot be deleted under two
    /// names, and taking either as meant would be a guess.</summary>
    [Fact]
    public void Two_deletes_on_one_bare_dut_are_refused_naming_both()
    {
        var (ide, refs) = StructInDuts();
        var resp = Push(ide, refs,
            new DeleteItemOp { Name = "X.struct", IfVersion = refs.Items["X.struct"] },
            new DeleteItemOp { Name = "X.enum", IfVersion = null });

        AssertRefusedAsAPair(ide, resp, "X.struct", "X.enum");
    }

    /// <summary>A subtype RENAME plus any second op on the same bare DUT: the rename already says what `X`
    /// becomes, so a second op is a second answer — refused, not ordered.</summary>
    [Fact]
    public void A_subtype_rename_plus_another_op_on_the_same_dut_is_refused_naming_both()
    {
        var (ide, refs) = StructInDuts();
        var resp = Push(ide, refs,
            new SetItemOp { Name = "X.struct", ToName = "X.enum", IfVersion = refs.Items["X.struct"], SourceText = Enum },
            new SetItemOp { Name = "X.enum", IfVersion = null, SourceText = Enum });

        AssertRefusedAsAPair(ide, resp, "X.struct", "X.enum");
    }

    /// <summary>THE RULE'S BOUNDARY: it is about ONE DUT under two subtype names, never about a bare name shared
    /// across kinds. `X.fb` beside `X.struct` is two items (CLAUDE.md, the item-name invariant — no duplicate-name
    /// guard), so whatever the IDE makes of the pair, the push must not refuse it as "two ops on one DUT". A rule
    /// written as "two ops on one bare name → BAD_REQUEST" is exactly that forbidden guard, and this catches it.
    ///
    /// <para><b>The FB text must be VALID ST.</b> Otherwise the per-op pre-flight refuses it as <c>INVALID_ST</c> and
    /// returns before any pairing rule, pre-flight or apply-time, is reached, and the assertion below then holds for
    /// the forbidden guard too. It did: this test first sent an FB with no implementation marker and no
    /// <c>END_FUNCTION_BLOCK</c>, and was green for that reason alone. The <c>create:X</c> assertion pins that the
    /// push got past the pre-flight into the IDE, so the test cannot go quietly vacuous again.</para>
    ///
    /// <para>What the IDE then makes of the pair is NOT asserted. The push resolves an existing item by bare name,
    /// so the struct resolves onto the FB it has just created and is refused as a re-type (<c>UNSUPPORTED</c>,
    /// after the FB was written) — a bare-name lookup that predates this change and is not about DUT subtypes.
    /// Whether either vendor can hold an FB and a DUT of one name at all is unmeasured (IEC puts both in one type
    /// namespace), and this fake cannot hold two items of one bare name, so acceptance is not provable here.</para></summary>
    [Fact]
    public void A_dut_op_beside_a_same_named_non_dut_op_is_not_refused_as_a_pair()
    {
        var ide = new FakeIde(FakeIde.Item.TextualPou("PLC_PRG", "PROGRAM PLC_PRG\nVAR\nEND_VAR", "x := 1;"));
        var refs = RefsService.Handle(ide);
        var resp = Push(ide, refs,
            new SetItemOp
            {
                Name = "X.fb", IfVersion = null,
                SourceText = "FUNCTION_BLOCK X\nVAR\nEND_VAR\n(* @volt-implementation *)\nEND_FUNCTION_BLOCK\n",
            },
            new SetItemOp { Name = "X.struct", IfVersion = null, SourceText = Struct });

        Assert.Contains("create:X", ide.Recorded);   // the premise: past the pre-flight and into the IDE

        // NO BAD_REQUEST AT ALL, not merely none naming both ops: the forbidden rule need not quote either op —
        // "two ops land on 'X'" names only the bare name, and a refusal naming just one op is the same guard.
        Assert.DoesNotContain(resp.Conflicts ?? new List<PushConflict>(), c => c.Code == BridgeErrorCodes.BadRequest);
    }

    // ── the name must say what the declaration says ────────────────────────────────────────────────

    /// <summary>A DUT'S WIRE NAME IS ITS DECLARATION'S SUBTYPE, on the way in as on the way out. The common way to
    /// break it is an engineer rewriting `DUTs/X.struct` as an enum without renaming the file: git sees a MODIFY
    /// and the client sends `set X.struct` with an enum body. The re-type guard cannot see it (all four names are
    /// `Kinds.Dut`), and accepting it would publish `X.enum` in the receipt for an op the client sent as
    /// `X.struct` — the client's baseline then holds neither name for `X`, its workspace keeps the stale
    /// `X.struct` beside the `X.enum` the next pull writes, and a later delete of the stale file deletes the live
    /// DUT (the split this change removes). So the disagreement is refused by name — the op's name AND the name
    /// its declaration implies — and nothing is written. Every shape that carries a body: an update, a subtype
    /// rename, the delete + create pair, and a plain create.</summary>
    [Theory]
    [InlineData("update")]
    [InlineData("rename")]
    [InlineData("pair")]
    [InlineData("create")]
    public void An_op_whose_subtype_name_disagrees_with_its_declaration_is_refused_by_name(string shape)
    {
        FakeIde ide;
        RefsResponse refs;
        if (shape == "create")
        {
            ide = new FakeIde(FakeIde.Item.TextualPou("PLC_PRG", "PROGRAM PLC_PRG\nVAR\nEND_VAR", "x := 1;"));
            refs = RefsService.Handle(ide);
        }
        else (ide, refs) = StructInDuts();

        PushOp[] ops;
        string sent, declared;
        switch (shape)
        {
            case "update":   // DUTs/X.struct rewritten as an enum, file not renamed
                ops = new PushOp[] { new SetItemOp { Name = "X.struct", IfVersion = refs.Items["X.struct"], SourceText = Enum } };
                (sent, declared) = ("X.struct", "X.enum");
                break;
            case "rename":   // renamed to X.enum, body still a struct
                ops = new PushOp[] { new SetItemOp { Name = "X.struct", ToName = "X.enum", IfVersion = refs.Items["X.struct"], SourceText = Struct } };
                (sent, declared) = ("X.enum", "X.struct");
                break;
            case "pair":     // git saw delete + add, and the added file's body is still a struct
                ops = new PushOp[]
                {
                    new DeleteItemOp { Name = "X.struct", IfVersion = refs.Items["X.struct"] },
                    new SetItemOp { Name = "X.enum", IfVersion = null, SourceText = Struct },
                };
                (sent, declared) = ("X.enum", "X.struct");
                break;
            default:         // a new file named for a subtype its body does not declare
                ops = new PushOp[] { new SetItemOp { Name = "X.struct", IfVersion = null, SourceText = Enum } };
                (sent, declared) = ("X.struct", "X.enum");
                break;
        }

        var resp = Push(ide, refs, ops);

        Assert.False(resp.Accepted);
        var conflict = Assert.Single(resp.Conflicts!);
        Assert.Equal(BridgeErrorCodes.BadRequest, conflict.Code);
        Assert.Contains(sent, conflict.Reason);
        Assert.Contains(declared, conflict.Reason);
        Assert.Empty(ide.Recorded);
    }

    /// <summary>A DELETE NAMES ONE WIRE ITEM, not a bare name. `X.struct` does not exist when the IDE's `X` is an
    /// enum (its wire name is `X.enum`), so deleting `X.struct` — a stale file from before a subtype change,
    /// deleted by the engineer — must never reach the live DUT. Resolving the op to its bare `X` and deleting
    /// whatever answers to it is the stale-subtype data loss this change exists to remove. With and without
    /// `--force`: force drops a version gate, it never widens what a name means.</summary>
    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public void A_delete_of_a_subtype_the_ide_does_not_hold_never_deletes_the_dut(bool force)
    {
        var ide = new FakeIde(new FakeIde.Item("X", ItemKind.PlcDut, "DUTs", true, Enum, null, null, null));
        var refs = RefsService.Handle(ide);
        var del = new DeleteItemOp { Name = "X.struct", IfVersion = null };

        if (force) ForcePush(ide, del); else Push(ide, refs, del);

        Assert.DoesNotContain("delete:X", ide.Recorded);
        Assert.True(ide.Exists("X"), "a delete of X.struct deleted the enum DUT X");
    }

    private static void AssertRefusedAsAPair(FakeIde ide, PushResponse resp, string a, string b)
    {
        Assert.False(resp.Accepted);
        var conflict = Assert.Single(resp.Conflicts!);
        Assert.Equal(BridgeErrorCodes.BadRequest, conflict.Code);
        Assert.Contains(a, conflict.Reason);
        Assert.Contains(b, conflict.Reason);
        Assert.Empty(ide.Recorded);
    }

    private static int CountOf(string needle, string hay)
    {
        int n = 0, at = 0;
        while ((at = hay.IndexOf(needle, at, System.StringComparison.Ordinal)) >= 0) { n++; at += needle.Length; }
        return n;
    }
}
