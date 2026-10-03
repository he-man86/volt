using Volt.Engine.Item;
using Volt.Engine.Sync;
using Xunit;

namespace Volt.Engine.Tests;

/// <summary>
/// PULL DOES NOT JUDGE THE IDE'S CODE (openspec <c>bridge-refusal-review</c> 1.4, spec "pull does not judge the IDE's
/// code").
///
/// <para>A comment is a comment. The pull used to refuse every source item whose IDE text held a <c>(* @volt-… *)</c>
/// comment — the tag of a Volt from before the <c>IMPLEMENTATION</c> line — and listed it unreadable, for every kind:
/// a DUT or a GVL holding one was pushable (neither is read on a push) and never pullable. The comment states no
/// boundary in a file that has one, so nothing about it stops the file reading back; the round-trip refusals the pull
/// keeps (<c>RefuseUnreadableBack</c>, <c>RefuseMemberOfAnotherClass</c>) are about the SPLIT, not about the code.</para>
/// </summary>
public class PullDoesNotJudgeCommentsTests
{
    [Fact]
    public void A_DUT_holding_a_retired_volt_comment_pulls_as_held()
    {
        const string decl = "TYPE ST_A :\nSTRUCT\n\t(* @volt-note *)\n\tn : INT;\nEND_STRUCT\nEND_TYPE";
        var ide = new FakeIde(new FakeIde.Item("ST_A", ItemKind.PlcDut, "", true, decl, null, null, null));

        var item = Materializer.Materialize(ide, "ST_A", ItemKind.Kinds.Dut, new ItemRef("ST_A"));

        Assert.Equal("ST_A.dut", item.FullName);
        Assert.Contains("(* @volt-note *)", item.Text);
    }

    [Fact]
    public void A_GVL_holding_a_retired_volt_comment_pulls_as_held()
    {
        const string decl = "(* @volt-note *)\nVAR_GLOBAL\n\tg : INT;\nEND_VAR";
        var ide = new FakeIde(new FakeIde.Item("GVL_A", ItemKind.PlcGvl, "", true, decl, null, null, null));

        var item = Materializer.Materialize(ide, "GVL_A", ItemKind.Kinds.Gvl, new ItemRef("GVL_A"));

        Assert.Equal("GVL_A.gvl", item.FullName);
        Assert.Contains("(* @volt-note *)", item.Text);
    }

    /// <summary>…and a POU, in its declaration and in its ST body: the file carries an <c>IMPLEMENTATION</c> line, so the
    /// comment states nothing.</summary>
    [Fact]
    public void A_POU_holding_a_retired_volt_comment_pulls_as_held()
    {
        var ide = new FakeIde(new FakeIde.Item("FB_A", ItemKind.PlcPou, "", true,
            "FUNCTION_BLOCK FB_A\n(* @volt-note *)\nVAR\nEND_VAR", "x := 1; (* @volt-implementation *)", null, null));

        var item = Materializer.Materialize(ide, "FB_A", ItemKind.Kinds.Pou, new ItemRef("FB_A"));

        Assert.Equal("FB_A.pou", item.FullName);
        Assert.Contains("(* @volt-note *)", item.Text);
        Assert.Contains("x := 1; (* @volt-implementation *)", item.Text);
    }

    /// <summary>…and the file it writes reads back on a push as the same item (2.1: a file with its boundary line is
    /// not judged for a comment), so the item round-trips.</summary>
    [Fact]
    public void A_pulled_POU_holding_a_retired_volt_comment_reads_back_on_a_push()
    {
        var ide = new FakeIde(new FakeIde.Item("FB_A", ItemKind.PlcPou, "", true,
            "FUNCTION_BLOCK FB_A\n(* @volt-note *)\nVAR\nEND_VAR", "x := 1; (* @volt-implementation *)", null, null));

        var item = Materializer.Materialize(ide, "FB_A", ItemKind.Kinds.Pou, new ItemRef("FB_A"));

        var back = Volt.Engine.Format.St.StReader.Read(item.Text, ItemKind.Kinds.Pou, "FB_A");
        Assert.Equal("FUNCTION_BLOCK FB_A\n(* @volt-note *)\nVAR\nEND_VAR", back.Declaration);
        Assert.Equal("x := 1; (* @volt-implementation *)", back.Body);
    }

    [Fact]
    public void The_items_are_published_by_refs_not_listed_unreadable()
    {
        var ide = new FakeIde(
            new FakeIde.Item("ST_A", ItemKind.PlcDut, "", true, "TYPE ST_A :\nSTRUCT\n\t(* @volt-note *)\n\tn : INT;\nEND_STRUCT\nEND_TYPE", null, null, null),
            new FakeIde.Item("GVL_A", ItemKind.PlcGvl, "", true, "(* @volt-note *)\nVAR_GLOBAL\n\tg : INT;\nEND_VAR", null, null, null));

        var refs = RefsService.Handle(ide);

        Assert.Contains("ST_A.dut", refs.Items.Keys);
        Assert.Contains("GVL_A.gvl", refs.Items.Keys);
        Assert.Empty(refs.Unreadable);
    }
}
