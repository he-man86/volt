using System.Linq;
using Xunit;
using Volt.Contracts;
using Volt.Engine.Item;
using Volt.Engine.Sync;

namespace Volt.Engine.Tests;

/// <summary>
/// <c>.dut</c> IS A WRITABLE DUT NAME, AND <c>.dut</c> ↔ SUBTYPE IS NEVER A REFUSAL (openspec
/// <c>push-without-header-check</c> 5.B.2 / 5.B.3, design step 5.B choices 4–5).
///
/// <para>A DUT's extension is the subtype its VENDOR states, so it changes without the client: a DUT published
/// <c>E_Mode.dut</c> (no answer) becomes <c>E_Mode.enum</c> once its text is fixed in the IDE, or once the vendor's
/// answer arrives. The client still holds <c>E_Mode.dut</c> and the version refs gave for it. The version hashes
/// folder and text, never the name, so an equal version proves the client's file holds exactly the IDE's content —
/// the push reaches the live DUT by its bare identity, gated by that version: no <c>ITEM_MISSING</c>, no
/// <c>--force</c>. A create and a delete stay what they were: a create over any DUT of the same bare name is
/// <c>ITEM_EXISTS</c>, a delete reaches only the live name.</para>
///
/// <para>Each test pins the vendor's answer on the fake (<see cref="FakeIde.DutAnswers"/>), never relying on a text
/// read.</para>
/// </summary>
public class DutBareIdentityPushTests
{
    private const string Enum = "TYPE E_Mode :\n(\n\tIdle := 0,\n\tRun\n);\nEND_TYPE";
    private const string Edited = "TYPE E_Mode :\n(\n\tIdle := 0,\n\tRun,\n\tStop\n);\nEND_TYPE\n";

    /// <summary>A project whose DUT <c>E_Mode</c> answers <paramref name="answer"/>, and its refs.</summary>
    private static (FakeIde Ide, RefsResponse Refs) Dut(DutSubtype? answer)
    {
        var ide = new FakeIde(new FakeIde.Item("E_Mode", ItemKind.PlcDut, "DUTs", true, Enum, null, null, null));
        ide.DutAnswers["E_Mode"] = answer;
        return (ide, RefsService.Handle(ide));
    }

    private static PushResponse Push(FakeIde ide, RefsResponse refs, params PushOp[] ops) =>
        PushService.Handle(ide, new PushRequest { ExpectedProjectVersion = refs.ProjectVersion, Ops = ops.ToList() });

    private static string Reasons(PushResponse r) =>
        r.Conflicts is null ? "" : string.Join("; ", r.Conflicts.Select(c => $"{c.Name}: [{c.Code}] {c.Reason}"));

    // ── 5.B.3: an update under the other DUT name reaches the live DUT by its version ─────────────────

    /// <summary>The client pulled <c>E_Mode.dut</c>; the vendor now answers <c>Enum</c>, the content unchanged. A push
    /// of <c>E_Mode.dut</c> quoting the version it holds is an ordinary update of that DUT: accepted, written as sent,
    /// and the receipt names the item by the IDE's answer.</summary>
    [Fact]
    public void An_update_of_a_dut_name_the_ide_now_publishes_under_its_subtype_is_accepted_at_an_equal_version()
    {
        var (ide, pulled) = Dut(null);
        var heldVersion = pulled.Items["E_Mode.dut"];
        ide.DutAnswers["E_Mode"] = DutSubtype.Enum;
        var refs = RefsService.Handle(ide);
        Assert.Equal(new[] { "E_Mode.enum" }, refs.Items.Keys.ToArray());

        var resp = Push(ide, refs, new SetItemOp { Name = "E_Mode.dut", IfVersion = heldVersion, SourceText = Edited });

        Assert.True(resp.Accepted, Reasons(resp));
        Assert.Equal(new[] { "writecontent:E_Mode" }, ide.Recorded.ToArray());
        Assert.Contains("Stop", ide.WrittenContent["E_Mode"].Declaration);
        Assert.Equal(new[] { "E_Mode.enum" }, resp.NewItems!.Keys.ToArray());
        Assert.Equal("DUTs", resp.NewFolders!["E_Mode.enum"]);
    }

    /// <summary>…and the reverse: the client holds <c>E_Mode.enum</c>, the vendor now states nothing (<c>.dut</c>).</summary>
    [Fact]
    public void An_update_of_a_subtype_name_the_ide_now_publishes_as_dot_dut_is_accepted_at_an_equal_version()
    {
        var (ide, pulled) = Dut(DutSubtype.Enum);
        var heldVersion = pulled.Items["E_Mode.enum"];
        ide.DutAnswers["E_Mode"] = null;
        var refs = RefsService.Handle(ide);

        var resp = Push(ide, refs, new SetItemOp { Name = "E_Mode.enum", IfVersion = heldVersion, SourceText = Edited });

        Assert.True(resp.Accepted, Reasons(resp));
        Assert.Equal(new[] { "writecontent:E_Mode" }, ide.Recorded.ToArray());
        Assert.Equal(new[] { "E_Mode.dut" }, resp.NewItems!.Keys.ToArray());
    }

    /// <summary>THE TEXT WAS FIXED IN THE IDE, so the client's version is stale: <c>STALE_ITEM_VERSION</c> with the live
    /// DUT's version (so the client pulls) — never <c>ITEM_MISSING</c>, which would invite a recreate of an item
    /// that is there. Nothing is written.</summary>
    [Fact]
    public void An_update_of_a_dut_name_whose_content_changed_in_the_ide_is_stale_never_missing()
    {
        var (ide, pulled) = Dut(null);
        var heldVersion = pulled.Items["E_Mode.dut"];
        ide.RemoveItem("E_Mode");
        ide.AddItem(new FakeIde.Item("E_Mode", ItemKind.PlcDut, "DUTs", true, Enum + "\n(* fixed *)", null, null, null));
        ide.DutAnswers["E_Mode"] = DutSubtype.Enum;
        var refs = RefsService.Handle(ide);
        Assert.NotEqual(heldVersion, refs.Items["E_Mode.enum"]);

        var resp = Push(ide, refs, new SetItemOp { Name = "E_Mode.dut", IfVersion = heldVersion, SourceText = Edited });

        Assert.False(resp.Accepted);
        var conflict = Assert.Single(resp.Conflicts!);
        Assert.Equal("E_Mode.dut", conflict.Name);
        Assert.Equal(ConflictCodes.StaleItemVersion, conflict.Code);
        Assert.Equal(refs.Items["E_Mode.enum"], conflict.CurrentVersion);
        Assert.Empty(ide.Recorded);
    }

    // ── what stays refused ─────────────────────────────────────────────────────────────────────────

    /// <summary>A CREATE of any DUT name over a live DUT of the same bare name is <c>ITEM_EXISTS</c>, naming the live
    /// name — <c>.dut</c> over <c>.enum</c> and the reverse.</summary>
    [Theory]
    [InlineData(DutSubtype.Enum, "E_Mode.dut", "E_Mode.enum")]
    [InlineData(null, "E_Mode.enum", "E_Mode.dut")]
    [InlineData(null, "E_Mode.struct", "E_Mode.dut")]
    public void A_create_of_any_dut_name_over_a_live_dut_of_the_same_bare_name_is_item_exists(
        DutSubtype? answer, string created, string live)
    {
        var (ide, refs) = Dut(answer);

        var resp = Push(ide, refs, new SetItemOp { Name = created, IfVersion = null, ToFolder = "DUTs", SourceText = Edited });

        Assert.False(resp.Accepted);
        var conflict = Assert.Single(resp.Conflicts!);
        Assert.Equal(ConflictCodes.ItemExists, conflict.Code);
        Assert.Equal(created, conflict.Name);
        Assert.Contains($"'{live}'", conflict.Reason);
        Assert.Empty(ide.Recorded);
    }

    /// <summary>A DELETE reaches only the live name: <c>delete E_Mode.dut</c> over a live <c>E_Mode.enum</c> is a no-op,
    /// forced or not, quoting the version or not. A delete cannot be undone; only a set's version proves content.</summary>
    [Theory]
    [InlineData(false, false)]
    [InlineData(true, false)]
    [InlineData(false, true)]
    public void A_delete_of_dot_dut_over_a_live_subtype_never_deletes_it(bool quoteVersion, bool force)
    {
        var (ide, pulled) = Dut(null);
        var heldVersion = pulled.Items["E_Mode.dut"];
        ide.DutAnswers["E_Mode"] = DutSubtype.Enum;
        var refs = RefsService.Handle(ide);
        var del = new DeleteItemOp { Name = "E_Mode.dut", IfVersion = quoteVersion ? heldVersion : null };

        PushService.Handle(ide, new PushRequest
        {
            Force = force, ExpectedProjectVersion = force ? null : refs.ProjectVersion, Ops = { del },
        });

        Assert.DoesNotContain("delete:E_Mode", ide.Recorded);
        Assert.True(ide.Exists("E_Mode"));
    }

    /// <summary>…while a delete under the live <c>.dut</c> name deletes the DUT: <c>.dut</c> is an ordinary wire name.</summary>
    [Fact]
    public void A_delete_under_the_live_dot_dut_name_deletes_the_dut()
    {
        var (ide, refs) = Dut(null);

        var resp = Push(ide, refs, new DeleteItemOp { Name = "E_Mode.dut", IfVersion = refs.Items["E_Mode.dut"] });

        Assert.True(resp.Accepted, Reasons(resp));
        Assert.Contains("delete:E_Mode", ide.Recorded);
        Assert.False(ide.Exists("E_Mode"));
    }

    // ── 5.B.2: `.dut` is writable — a create writes the text as sent ───────────────────────────────

    /// <summary>A CREATE OF <c>X.dut</c> takes the DUT create path (as <c>X.struct</c> would) and writes the text as
    /// sent; the receipt then names the item by the vendor's answer for what it holds — <c>.dut</c> for a text no
    /// vendor classifies, the subtype for one it does.</summary>
    [Theory]
    [InlineData("TYPE X :\n(* never closed\nSTRUCT\n\ta : INT;\nEND_STRUCT\nEND_TYPE\n", "X.dut")]
    [InlineData("TYPE X :\n(\n\tA,\n\tB\n);\nEND_TYPE\n", "X.enum")]
    public void A_create_of_dot_dut_writes_the_text_as_sent_and_is_named_by_the_vendors_answer(string text, string published)
    {
        var ide = new FakeIde();
        var refs = RefsService.Handle(ide);

        var resp = Push(ide, refs, new SetItemOp { Name = "X.dut", IfVersion = null, ToFolder = "DUTs", SourceText = text });

        Assert.True(resp.Accepted, Reasons(resp));
        Assert.Equal(ItemKind.PlcDut, ide.CreatedKinds["X"]);
        Assert.Equal(text.TrimEnd('\n'), ide.WrittenContent["X"].Declaration.TrimEnd('\n'));
        Assert.Equal(new[] { published }, resp.NewItems!.Keys.ToArray());
    }

    /// <summary>…and an update under <c>X.dut</c> of a DUT published <c>X.dut</c> is an ordinary update, its text written
    /// as sent (the text is never checked against the name, as for every DUT name).</summary>
    [Fact]
    public void An_update_under_the_live_dot_dut_name_is_an_ordinary_update()
    {
        var (ide, refs) = Dut(null);

        var resp = Push(ide, refs, new SetItemOp { Name = "E_Mode.dut", IfVersion = refs.Items["E_Mode.dut"], SourceText = Edited });

        Assert.True(resp.Accepted, Reasons(resp));
        Assert.Equal(new[] { "writecontent:E_Mode" }, ide.Recorded.ToArray());
    }
}
