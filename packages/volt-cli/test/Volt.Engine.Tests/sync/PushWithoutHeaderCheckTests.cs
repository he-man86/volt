using System.Collections.Generic;
using System.Linq;
using Volt.Contracts;
using Volt.Engine.Item;
using Volt.Engine.Sync;
using Xunit;

namespace Volt.Engine.Tests;

/// <summary>
/// PUSH DOES NOT PARSE A TOP-LEVEL ITEM'S HEADER (openspec <c>push-without-header-check</c>).
///
/// <para>A top-level item's kind is its wire name's extension, so its header is never read, never checked against
/// the extension and never a reason to refuse: the text is written as sent, and the IDE's build reports what is
/// wrong with it. A DUT or a GVL is not read at all. A POU is read for exactly two things — its
/// <c>IMPLEMENTATION</c> line (declaration/body split) and its CHILD elements (METHOD, ACTION, PROPERTY and its
/// GET/SET), which have no extension, so their header line is what names and delimits them.</para>
///
/// <para>It came up in a PLCAssist chat (<c>c802b74d</c>): a DUT whose opening comment was never closed (<c>*</c>
/// where <c>*)</c> belonged) was refused <c>INVALID_CODE_HEADER</c> / "No header line found", taking its whole batch
/// with it. The client was told to fix a header that was fine; the real error was one the build reports.</para>
/// </summary>
public class PushWithoutHeaderCheckTests
{
    private static FakeIde Project() =>
        new(FakeIde.Item.TextualPou("PLC_PRG", "PROGRAM PLC_PRG\nVAR\nEND_VAR", "x := 1;"));

    private static PushResponse Create(FakeIde ide, string wireName, string text) =>
        PushService.Handle(ide, new PushRequest
        {
            ExpectedProjectVersion = RefsService.Handle(ide).ProjectVersion,
            Ops = new List<PushOp> { new SetItemOp { Name = wireName, IfVersion = null, ToFolder = "", SourceText = text } },
        });

    private static string Reasons(PushResponse r) =>
        r.Conflicts is null ? "" : string.Join("; ", r.Conflicts.Select(c => $"{c.Name}: [{c.Code}] {c.Reason}"));

    private static void AssertWrittenAsSent(FakeIde ide, PushResponse resp, string bare, string declaration)
    {
        Assert.True(resp.Accepted, Reasons(resp));
        Assert.Contains($"writecontent:{bare}", ide.Recorded);
        Assert.Equal(declaration, ide.WrittenContent[bare].Declaration);
    }

    // ── the c802b74d shape: an opening comment that never closes ─────────────────────────────────────

    /// <summary>The chat's DUT, as sent: the doc comment's closing <c>*)</c> is a lone <c>*</c>, so the whole text is
    /// one comment. Pushed as written; a build reports it.</summary>
    [Fact]
    public void A_struct_whose_opening_comment_never_closes_pushes_as_written()
    {
        const string text = "(* Carrier state\n *\nTYPE ST_Carrier :\nSTRUCT\n\tnPos : INT; (* mm *)\nEND_STRUCT\nEND_TYPE";
        var ide = Project();
        AssertWrittenAsSent(ide, Create(ide, "ST_Carrier.dut", text), "ST_Carrier", text);
    }

    [Fact]
    public void An_enum_whose_opening_comment_never_closes_pushes_as_written()
    {
        const string text = "(* Modes\n *\nTYPE E_Mode :\n(\n\tIdle := 0,\n\tRun\n);\nEND_TYPE";
        var ide = Project();
        AssertWrittenAsSent(ide, Create(ide, "E_Mode.dut", text), "E_Mode", text);
    }

    [Fact]
    public void A_gvl_whose_opening_comment_never_closes_pushes_as_written()
    {
        const string text = "(* Globals\n *\nVAR_GLOBAL\n\tgCount : INT;\nEND_VAR";
        var ide = Project();
        AssertWrittenAsSent(ide, Create(ide, "GVL_Main.gvl", text), "GVL_Main", text);
    }

    /// <summary>A POU is read for its IMPLEMENTATION line and its children — and a comment that never closes cannot
    /// hide either: a <c>(*</c> with no <c>*)</c> after it opens no comment the structure is read through. The
    /// declaration still carries it verbatim, so the IDE's build reports it.</summary>
    [Fact]
    public void A_function_block_whose_opening_comment_never_closes_pushes_as_written()
    {
        const string decl = "(* Motor control\n *\nFUNCTION_BLOCK FB_Motor\nVAR\n\tn : INT; (* count *)\nEND_VAR";
        const string text = decl + "\nIMPLEMENTATION ST\nn := n + 1;\nEND_FUNCTION_BLOCK\n\n" +
                            "METHOD Reset\nIMPLEMENTATION ST\nn := 0;\nEND_METHOD\n";
        var ide = Project();
        var resp = Create(ide, "FB_Motor.pou", text);

        AssertWrittenAsSent(ide, resp, "FB_Motor", decl);
        var written = ide.WrittenContent["FB_Motor"];
        Assert.Equal("n := n + 1;", written.Body);
        var reset = Assert.Single(written.Members);
        Assert.Equal("Reset", reset.Name);
        Assert.Equal("n := 0;", reset.Body);
    }

    // ── the header is not checked against the extension ─────────────────────────────────────────────

    /// <summary>A DUT's extension says nothing about its shape: <c>X.dut</c> with an enum's text is written as sent —
    /// the IDE takes the shape the text gives it — and <c>refs</c> names it <c>X.dut</c>. (Premise changed by the
    /// owner, openspec <c>push-without-header-check</c> 5.P: this pushed <c>X.struct</c> and expected <c>X.enum</c>.)</summary>
    [Fact]
    public void A_dut_with_an_enums_text_pushes_as_written_and_keeps_its_name()
    {
        const string text = "TYPE X :\n(\n\tIdle := 0,\n\tRun\n);\nEND_TYPE";
        var ide = Project();
        AssertWrittenAsSent(ide, Create(ide, "X.dut", text), "X", text);
        Assert.Contains("X.dut", RefsService.Handle(ide).Items.Keys);
    }

    /// <summary>The spec's second scenario: <c>FB_X.pou</c> whose text starts <c>PROGRAM FB_X</c> is not refused for its
    /// header. (What the IDE then does with it is task 1.2's live measurement.)</summary>
    [Fact]
    public void A_function_block_name_over_a_programs_text_is_not_refused_for_its_header()
    {
        const string decl = "PROGRAM FB_X\nVAR\n\tn : INT;\nEND_VAR";
        var ide = Project();
        var resp = Create(ide, "FB_X.pou", decl + "\nIMPLEMENTATION ST\nn := 1;\nEND_PROGRAM\n");

        AssertWrittenAsSent(ide, resp, "FB_X", decl);
        Assert.Contains("create:FB_X", ide.Recorded);
    }

    // ── a DUT or a GVL is not read at all ────────────────────────────────────────────────────────────

    [Fact]
    public void An_empty_struct_pushes_without_refusal()
    {
        var ide = Project();
        AssertWrittenAsSent(ide, Create(ide, "ST_Empty.dut", ""), "ST_Empty", "");
    }

    /// <summary>A comment of a Volt from before the IMPLEMENTATION keyword is refused in a POU (its boundary is what the
    /// comment used to state). In a GVL it is a comment and nothing else — harmless text to the IDE.</summary>
    [Fact]
    public void A_gvl_holding_a_retired_volt_comment_pushes_as_written()
    {
        const string text = "(* @volt-impl *)\nVAR_GLOBAL\n\tg : INT;\nEND_VAR";
        var ide = Project();
        AssertWrittenAsSent(ide, Create(ide, "GVL_Old.gvl", text), "GVL_Old", text);
    }

    /// <summary><c>IMPLEMENTATION</c> is reserved because a POU's boundary line is spelled with it. A struct has no
    /// boundary, so a member of that name is the IDE's to judge.</summary>
    [Fact]
    public void A_struct_naming_a_member_IMPLEMENTATION_pushes_as_written()
    {
        const string text = "TYPE ST_Doc :\nSTRUCT\n\tIMPLEMENTATION : INT;\nEND_STRUCT\nEND_TYPE";
        var ide = Project();
        AssertWrittenAsSent(ide, Create(ide, "ST_Doc.dut", text), "ST_Doc", text);
    }

    [Fact]
    public void Prose_under_a_struct_name_pushes_as_written()
    {
        const string text = "this is not structured text at all";
        var ide = Project();
        AssertWrittenAsSent(ide, Create(ide, "Junk.dut", text), "Junk", text);
    }

    // ── a CHILD's header is the one header push reads ───────────────────────────────────────────────

    /// <summary>A child has no extension: its header line names it and says what it is. One that cannot be read is
    /// refused naming the item AND the line in the file, before anything is written.</summary>
    [Fact]
    public void A_child_whose_header_cannot_be_read_is_refused_naming_the_item_and_the_line()
    {
        const string text = "FUNCTION_BLOCK FB_A\nVAR\nEND_VAR\nIMPLEMENTATION ST\nEND_FUNCTION_BLOCK\n\n" +
                            "METHOD 1Reset : INT\nIMPLEMENTATION ST\nEND_METHOD\n";
        var ide = Project();
        var resp = Create(ide, "FB_A.pou", text);

        Assert.False(resp.Accepted);
        var conflict = Assert.Single(resp.Conflicts!);
        Assert.Equal(BridgeErrorCodes.InvalidSt, conflict.Code);
        Assert.Contains("'FB_A'", conflict.Reason);
        Assert.Contains("line 7", conflict.Reason);
        Assert.Empty(ide.Recorded);
    }

    /// <summary>Text after the POU that is no child — here a method whose doc comment never closes, which used to hide
    /// the METHOD line and drop the method without a word — is refused naming the item and the line.</summary>
    [Fact]
    public void Text_after_the_pou_that_opens_no_child_is_refused_naming_the_item_and_the_line()
    {
        const string text = "FUNCTION_BLOCK FB_B\nVAR\nEND_VAR\nIMPLEMENTATION ST\nEND_FUNCTION_BLOCK\n\n" +
                            "(* resets the count\n *\nMETHOD Reset\nIMPLEMENTATION ST\nEND_METHOD\n";
        var ide = Project();
        var resp = Create(ide, "FB_B.pou", text);

        Assert.False(resp.Accepted);
        var conflict = Assert.Single(resp.Conflicts!);
        Assert.Equal(BridgeErrorCodes.InvalidSt, conflict.Code);
        Assert.Contains("'FB_B'", conflict.Reason);
        Assert.Contains("line 7", conflict.Reason);
        Assert.Contains("(* resets the count", conflict.Reason);
        Assert.Empty(ide.Recorded);
    }
}
