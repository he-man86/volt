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
        // THE OBJECT `X` is never deleted, created or renamed. The FOLDER `Types` does not exist in this project,
        // so a move into it creates it (`create:Types`) — that is the destination being made, not the DUT.
        Assert.DoesNotContain(ide.Recorded, x => x is "delete:X" or "create:X" || x.StartsWith("rename:"));
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
                SourceText = "FUNCTION_BLOCK X\nVAR\nEND_VAR\nIMPLEMENTATION ST\nEND_FUNCTION_BLOCK\n",
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
        // The sentence the engineer reads, pinned: it says which subtype the NAME claims and which the DECLARATION
        // states, in words that read for every subtype (the previous "is named for a enum" did not).
        var (sentExt, declaredExt) = (sent[(sent.LastIndexOf('.') + 1)..], declared[(declared.LastIndexOf('.') + 1)..]);
        Assert.Contains($"'{sent}' names the subtype {sentExt} but its declaration's subtype is {declaredExt}, so its name is '{declared}'.",
            conflict.Reason);
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

    // ── section 3 review: a create, a subtype-less DUT, the apply-time kind, the header ─────────────

    /// <summary>A CREATE NEVER LANDS ON A DUT THAT IS ALREADY THERE UNDER ANOTHER SUBTYPE. The IDE holds the enum
    /// <c>X</c> (an engineer made it after the client's last pull) and the client independently adds
    /// <c>X.struct</c>: neither <c>X.struct</c> nor a bare <c>X</c> is in the version map, so the create gate saw
    /// nothing — and the apply then resolved the op by BARE name, found the enum and wrote the struct over it with
    /// no version check. While both names were <c>X.dut</c> the same push was refused <c>ITEM_EXISTS</c>; the
    /// subtype in the wire name must not open the gate. The control: the same create under the IDE's own subtype.</summary>
    [Theory]
    [InlineData("X.struct", "TYPE X :\nSTRUCT\n\ta : INT;\nEND_STRUCT\nEND_TYPE\n")]
    [InlineData("X.enum", Enum)]
    public void A_create_over_a_dut_of_another_subtype_is_refused_as_item_exists(string name, string body)
    {
        var ide = new FakeIde(new FakeIde.Item("X", ItemKind.PlcDut, "DUTs", true, Enum, null, null, null));
        var refs = RefsService.Handle(ide);
        var resp = Push(ide, refs, new SetItemOp { Name = name, IfVersion = null, ToFolder = "DUTs", SourceText = body });

        Assert.False(resp.Accepted, "a create overwrote the IDE's enum DUT X");
        var conflict = Assert.Single(resp.Conflicts!);
        Assert.Equal(ConflictCodes.ItemExists, conflict.Code);
        Assert.Equal(name, conflict.Name);
        Assert.Empty(ide.Recorded);
    }

    /// <summary>A DUT WHOSE IDE DECLARATION STATES NO SUBTYPE (an engineer half-typed <c>TYPE X :</c>) has no wire
    /// name — it is published unreadable — so whether a <c>delete X.struct</c> names it cannot be read from it.
    /// That must be decided BEFORE the first write: it used to throw <c>BAD_REQUEST</c> from inside the apply loop,
    /// after the batch's earlier ops had landed (a partial write reported as a rejection). Without force the push
    /// is refused whole as an unreadable item; with <c>--force</c> — the documented way past an unreadable item —
    /// the delete removes it, as a forced delete of <c>X.dut</c> did before the subtype reached the wire.</summary>
    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public void A_delete_of_a_dut_whose_declaration_states_no_subtype_is_decided_before_any_write(bool force)
    {
        var ide = new FakeIde(
            new FakeIde.Item("X", ItemKind.PlcDut, "DUTs", true, "TYPE X :\nEND_TYPE\n", null, null, null),
            FakeIde.Item.TextualPou("A", "FUNCTION_BLOCK A\nVAR\nEND_VAR\n", "", "POUs"));
        var refs = RefsService.Handle(ide);
        var ops = new List<PushOp>
        {
            new SetItemOp
            {
                Name = "A.fb", IfVersion = refs.Items["A.fb"],
                SourceText = "FUNCTION_BLOCK A\nVAR\n\tb : INT;\nEND_VAR\nIMPLEMENTATION ST\nEND_FUNCTION_BLOCK\n",
            },
            new DeleteItemOp { Name = "X.struct" },
        };
        var resp = PushService.Handle(ide, new PushRequest { Force = force, Ops = ops });

        if (force)
        {
            Assert.True(resp.Accepted, Reasons(resp));
            Assert.Contains("delete:X", ide.Recorded);
            Assert.Contains("writecontent:A", ide.Recorded);
        }
        else
        {
            Assert.False(resp.Accepted);
            var conflict = Assert.Single(resp.Conflicts!);
            Assert.Equal("X.struct", conflict.Name);
            Assert.Equal(BridgeErrorCodes.Unreadable, conflict.Code);
            Assert.DoesNotContain("already written", conflict.Reason);
            Assert.Empty(ide.Recorded);
        }
    }

    /// <summary>…AND A DUT THAT CANNOT BE READ AT ALL IS THE SAME UNREADABLE ITEM. A read failure other than a
    /// missing subtype — a COM error, a driver throw — is published unreadable by every refs/fetch walk
    /// (<c>Versioning.SafeVersion</c> catches every failure), so the push must answer as that walk did. Only the
    /// missing-subtype half was decided: any other failure escaped the pre-flight as a raw exception out of
    /// <c>PushService.Handle</c> (no response at all), and under force threw from the apply after the batch's
    /// earlier ops had landed — a partial write, and a DUT no push could ever delete.</summary>
    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public void A_delete_of_a_dut_the_ide_cannot_read_is_decided_like_the_walk_decided_it(bool force)
    {
        var ide = new FakeIde(
            new FakeIde.Item("X", ItemKind.PlcDut, "DUTs", true, Struct, null, null, "read failed (COM)"),
            FakeIde.Item.TextualPou("A", "FUNCTION_BLOCK A\nVAR\nEND_VAR\n", "", "POUs"));
        var refs = RefsService.Handle(ide);
        Assert.Equal(new[] { "A.fb" }, refs.Items.Keys.ToArray());
        var ops = new List<PushOp>
        {
            new SetItemOp
            {
                Name = "A.fb", IfVersion = refs.Items["A.fb"],
                SourceText = "FUNCTION_BLOCK A\nVAR\n\tb : INT;\nEND_VAR\nIMPLEMENTATION ST\nEND_FUNCTION_BLOCK\n",
            },
            new DeleteItemOp { Name = "X.struct" },
        };

        var resp = PushService.Handle(ide, new PushRequest { Force = force, Ops = ops });

        if (force)
        {
            Assert.True(resp.Accepted, Reasons(resp));
            Assert.Contains("delete:X", ide.Recorded);
            Assert.Contains("writecontent:A", ide.Recorded);
        }
        else
        {
            Assert.False(resp.Accepted);
            var conflict = Assert.Single(resp.Conflicts!);
            Assert.Equal("X.struct", conflict.Name);
            Assert.Equal(BridgeErrorCodes.Unreadable, conflict.Code);
            Assert.Contains("read failed (COM)", conflict.Reason);
            Assert.Empty(ide.Recorded);
        }
    }

    /// <summary>A PAIR WHOSE DELETE QUOTES NO VERSION IS NOT THE SUBTYPE CHANGE THE WIRE DEFINES. The pair is an
    /// UPDATE of <c>X</c>, and an update is guarded by the version the delete quotes; with none, the coalesced op
    /// read as a CREATE and was refused <c>ITEM_EXISTS</c> "expected to create new item" — for an op the client
    /// never sent, under a code that names no remedy. Refused by name as the malformed pair it is, nothing
    /// written. Force drops the version gate, so a forced unguarded pair is still the one update.</summary>
    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public void A_pair_whose_delete_quotes_no_version_is_refused_by_name_unless_forced(bool deleteFirst)
    {
        var (ide, refs) = StructInDuts();
        PushOp del = new DeleteItemOp { Name = "X.struct", IfVersion = null };
        PushOp add = new SetItemOp { Name = "X.enum", ToFolder = "DUTs", IfVersion = null, SourceText = Enum };
        var ops = deleteFirst ? new[] { del, add } : new[] { add, del };

        var resp = Push(ide, refs, ops);
        Assert.False(resp.Accepted);
        var conflict = Assert.Single(resp.Conflicts!);
        Assert.Equal(BridgeErrorCodes.BadRequest, conflict.Code);
        Assert.Contains("X.struct", conflict.Reason);
        Assert.Contains("X.enum", conflict.Reason);
        Assert.Contains("ifVersion", conflict.Reason);
        Assert.Empty(ide.Recorded);

        AssertOneUpdateToEnum(ide, ForcePush(ide, ops));
    }

    /// <summary>AN ALIAS OF A TYPE NAMED <c>Struct…</c> IS AN ALIAS, end to end: published <c>T.alias</c>, and an
    /// update under that name accepted. With the subtype matched as a prefix it was published <c>T.struct</c> and
    /// the correctly named push refused as "named for a alias but its declaration is a struct".</summary>
    [Fact]
    public void An_alias_of_a_type_whose_name_begins_with_struct_is_published_and_pushed_as_an_alias()
    {
        const string Alias = "TYPE T : Struct_Alarm;\nEND_TYPE\n";
        var ide = new FakeIde(new FakeIde.Item("T", ItemKind.PlcDut, "DUTs", true, Alias, null, null, null));
        var refs = RefsService.Handle(ide);
        Assert.Equal(new[] { "T.alias" }, refs.Items.Keys.ToArray());

        var resp = Push(ide, refs,
            new SetItemOp { Name = "T.alias", IfVersion = refs.Items["T.alias"], SourceText = "TYPE T : Struct_Alarm2;\nEND_TYPE\n" });

        Assert.True(resp.Accepted, Reasons(resp));
        Assert.Equal(new[] { "writecontent:T" }, ide.Recorded.ToArray());
    }

    /// <summary>THE APPLY-TIME READ GETS THE WIRE NAME'S KIND — for a DUT name, <c>Kinds.Dut</c> (task 3.6). It was
    /// handed the BARE name, so <c>KindForWireName</c> answered null for every item and the write believed the
    /// text's header. Pushed at <c>X.struct</c>, a function block's text over the IDE's function block <c>X</c>
    /// passes every other check (the re-type guard compares the text with the object, both FB; the subtype check
    /// judges only a TYPE declaration), and was written — with <c>--force</c>, and without it as a "create" whose
    /// name the version map does not hold. The receipt then named <c>X.fb</c> for an op sent as <c>X.struct</c>.
    /// The name is the kind: refused, and nothing written.</summary>
    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public void A_dut_name_over_a_function_blocks_text_is_refused_by_the_kind_its_name_carries(bool force)
    {
        const string Fb = "FUNCTION_BLOCK X\nVAR\n\tb : INT;\nEND_VAR\nIMPLEMENTATION ST\nEND_FUNCTION_BLOCK\n";
        var ide = new FakeIde(FakeIde.Item.TextualPou("X", "FUNCTION_BLOCK X\nVAR\nEND_VAR\n", "", "POUs"));
        var refs = RefsService.Handle(ide);
        var op = new SetItemOp { Name = "X.struct", IfVersion = null, SourceText = Fb };

        var resp = force ? ForcePush(ide, op) : Push(ide, refs, op);

        Assert.False(resp.Accepted, "a push named X.struct wrote a function block's text");
        var conflict = Assert.Single(resp.Conflicts!);
        Assert.Equal("X.struct", conflict.Name);
        Assert.Equal(BridgeErrorCodes.InvalidSt, conflict.Code);
        Assert.DoesNotContain(ide.Recorded, r => r.StartsWith("writecontent:"));
    }

    /// <summary>ONE ANSWER TO "IS THIS TEXT A DUT DECLARATION" — the ST reader's (<c>CodeHelper.ParseCodeHeader</c>).
    /// The subtype check used to scan the header keyword itself and accept a bare <c>TYPE</c> line the reader
    /// refuses, so <c>set X.struct</c> with <c>TYPE\n\tX : (A, B);</c> was told to rename the file to <c>X.enum</c>,
    /// and the renamed push was then refused by the reader as an unrecognized header — advice leading straight into
    /// a second, contradictory refusal. Both names get the reader's refusal, and the same one.</summary>
    [Theory]
    [InlineData("X.struct")]
    [InlineData("X.enum")]
    public void A_type_keyword_alone_on_its_line_is_refused_by_the_st_reader_under_any_subtype_name(string name)
    {
        // A CREATE, so nothing else (a version gate, the object's own kind) can answer first.
        var ide = new FakeIde(FakeIde.Item.TextualPou("PLC_PRG", "PROGRAM PLC_PRG\nVAR\nEND_VAR", "x := 1;"));
        var refs = RefsService.Handle(ide);
        var resp = Push(ide, refs,
            new SetItemOp { Name = name, IfVersion = null, SourceText = "TYPE\n\tX : (A, B);\nEND_TYPE\n" });

        Assert.False(resp.Accepted);
        var conflict = Assert.Single(resp.Conflicts!);
        Assert.Equal(BridgeErrorCodes.InvalidCodeHeader, conflict.Code);
        Assert.Empty(ide.Recorded);
    }

    // ── section 3 review, round 3: names the wire never published, and an update posing as a create ──

    /// <summary>A PUSH OP'S NAME IS A WIRE NAME, or the push is refused before anything is read or written. Since the
    /// DUT is named by its subtype, <c>X.dut</c> — what the previous CLI and unmigrated scripts still send — names no
    /// kind; neither does a bare <c>X</c> or <c>X.foo</c>. The gate found none of them in the version map and let the
    /// op through as a CREATE; the apply then resolved it by BARE name, found the live DUT and wrote over it with no
    /// version check (forced, it also moved it). Refused <c>BAD_REQUEST</c> naming the op, forced or not: force drops
    /// a version gate, it never makes a name mean something.</summary>
    [Theory]
    [InlineData("X.dut", false)]
    [InlineData("X.dut", true)]
    [InlineData("X", false)]
    [InlineData("X", true)]
    [InlineData("X.foo", false)]
    [InlineData("X.foo", true)]
    // A kind extension in the wrong CASE is no wire name either: refs/fetch publish `X.struct`, and a client keying
    // `X.Struct` compares Ordinal, so it never matched its own item (it pushed as a create beside it, and a pull's
    // removal sweep never reached its file — a DUT the IDE deleted came back).
    [InlineData("X.Struct", false)]
    [InlineData("X.Struct", true)]
    [InlineData("X.STRUCT", false)]
    public void A_set_under_a_name_that_is_no_wire_name_is_refused_and_writes_nothing(string name, bool force)
    {
        var (ide, refs) = StructInDuts();
        var set = new SetItemOp
        {
            Name = name, ToFolder = "Other", IfVersion = null,
            SourceText = "TYPE X :\nSTRUCT\n\tb : BOOL;\nEND_STRUCT\nEND_TYPE\n",
        };

        var resp = force ? ForcePush(ide, set) : Push(ide, refs, set);

        Assert.False(resp.Accepted, $"set '{name}' was written over the DUT X");
        var conflict = Assert.Single(resp.Conflicts!);
        Assert.Equal(BridgeErrorCodes.BadRequest, conflict.Code);
        Assert.Equal(name, conflict.Name);
        Assert.Contains($"'{name}'", conflict.Reason);
        Assert.Empty(ide.Recorded);
        Assert.Equal("DUTs", RefsService.Handle(ide).Folders["X.struct"]);
    }

    /// <summary>…and so is a <c>toName</c>: a rename to a name with no kind would land content under a name no read
    /// checks against its text.</summary>
    [Fact]
    public void A_rename_to_a_name_that_is_no_wire_name_is_refused_and_writes_nothing()
    {
        var (ide, refs) = StructInDuts();
        var resp = Push(ide, refs,
            new SetItemOp { Name = "X.struct", ToName = "X.dut", IfVersion = refs.Items["X.struct"], SourceText = Struct });

        Assert.False(resp.Accepted);
        var conflict = Assert.Single(resp.Conflicts!);
        Assert.Equal(BridgeErrorCodes.BadRequest, conflict.Code);
        Assert.Contains("'X.dut'", conflict.Reason);
        Assert.Empty(ide.Recorded);
    }

    /// <summary>A DELETE REACHES AN OBJECT ONLY UNDER THAT OBJECT'S WIRE NAME — for every name, not only the DUT
    /// subtype names. <c>delete X.dut</c> (an old baseline's name; its version equals <c>X.struct</c>'s, since an item
    /// version hashes folder + text and no name), <c>X.fb</c>, a bare <c>X</c> and <c>X.foo</c> all resolved to the
    /// bare <c>X</c> and destroyed the struct, while <c>delete X.struct</c> against an enum <c>X</c> is refused.
    /// Whether refused as no wire name or a no-op for an item that is not there, the DUT stays.</summary>
    [Theory]
    [InlineData("X.dut", true, false)]
    [InlineData("X.dut", false, false)]
    [InlineData("X.dut", false, true)]
    [InlineData("X.fb", true, false)]
    [InlineData("X.fb", false, false)]
    [InlineData("X.fb", false, true)]
    [InlineData("X", false, false)]
    [InlineData("X", false, true)]
    [InlineData("X.foo", false, false)]
    [InlineData("X.foo", false, true)]
    [InlineData("X.Struct", true, false)]
    [InlineData("X.Struct", false, true)]
    public void A_delete_under_a_name_that_is_not_the_duts_wire_name_never_deletes_it(string name, bool quoteVersion, bool force)
    {
        var (ide, refs) = StructInDuts();
        var del = new DeleteItemOp { Name = name, IfVersion = quoteVersion ? refs.Items["X.struct"] : null };

        if (force) ForcePush(ide, del); else Push(ide, refs, del);

        Assert.DoesNotContain("delete:X", ide.Recorded);
        Assert.True(ide.Exists("X"), $"delete '{name}' deleted the DUT X");
        Assert.Equal(new[] { "X.struct" }, RefsService.Handle(ide).Items.Keys.ToArray());
    }

    /// <summary>The same rule off the DUT kind: <c>delete X.prg</c> is not the function block <c>X.fb</c>.</summary>
    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public void A_delete_under_another_kinds_name_never_deletes_the_item(bool force)
    {
        var ide = new FakeIde(FakeIde.Item.TextualPou("X", "FUNCTION_BLOCK X\nVAR\nEND_VAR\n", "", "POUs"));
        var refs = RefsService.Handle(ide);
        var del = new DeleteItemOp { Name = "X.prg", IfVersion = null };

        if (force) ForcePush(ide, del); else Push(ide, refs, del);

        Assert.DoesNotContain("delete:X", ide.Recorded);
        Assert.Equal(new[] { "X.fb" }, RefsService.Handle(ide).Items.Keys.ToArray());
    }

    /// <summary>A DELETE PAIRED WITH AN UPDATE IS NOT A SUBTYPE CHANGE. The pair the wire defines is a delete of one
    /// subtype and a CREATE of another; a <c>set X.enum</c> that quotes an <c>ifVersion</c> is an update of an item
    /// the IDE does not hold (alone, refused <c>ITEM_MISSING</c>). Coalesced, its version was dropped unchecked and
    /// the enum written on the strength of the delete's. Refused naming both, nothing written, forced or not.</summary>
    [Theory]
    [InlineData(true, false)]
    [InlineData(false, false)]
    [InlineData(true, true)]
    [InlineData(false, true)]
    public void A_delete_paired_with_an_update_is_refused_naming_both(bool deleteFirst, bool force)
    {
        var (ide, refs) = StructInDuts();
        PushOp del = new DeleteItemOp { Name = "X.struct", IfVersion = refs.Items["X.struct"] };
        PushOp upd = new SetItemOp { Name = "X.enum", IfVersion = "a-version-of-X.enum-the-ide-never-had", SourceText = Enum };
        var ops = deleteFirst ? new[] { del, upd } : new[] { upd, del };

        var resp = force ? ForcePush(ide, ops) : Push(ide, refs, ops);

        AssertRefusedAsAPair(ide, resp, "X.struct", "X.enum");
        Assert.Equal(new[] { "X.struct" }, RefsService.Handle(ide).Items.Keys.ToArray());
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
