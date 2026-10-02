using Xunit;
using Volt.Contracts;
using Volt.Engine.Format.Task;
using Volt.Engine.Sync;

namespace Volt.Engine.Tests;

/// <summary>
/// THE POST-PUSH COMPARISON READS AN ITEM BY THE PUSH'S OWN FORMAT DISPATCH (<see cref="PushedText"/>): a task by its
/// descriptor format, anything else by the ST reader AT ITS WIRE KIND. A second copy of that dispatch in the CLI is
/// what once handed a `.task` to the ST reader after the IDE had applied the push.
/// </summary>
public class PushedTextTests
{
    [Fact]
    public void A_task_is_compared_as_a_descriptor()
    {
        var canonical = TaskDescriptorFormat.Write(new TaskSettings("cyclic", "t#10ms", "", "1", null, null, new[] { "PLC_PRG" }));
        Assert.True(PushedText.SameExceptLayout("MainTask.task", canonical.TrimEnd('\n') + "   \n", canonical));
    }

    /// <summary>A graphical body laid out otherwise is the same item; a changed token is not.</summary>
    [Theory]
    [InlineData("  out := ( a AND\n    b );", true)]
    [InlineData("  out := (a OR b);", false)]
    public void A_graphical_body_is_compared_by_its_tokens(string statement, bool same)
    {
        static string Prg(string s) =>
            "PROGRAM P\nVAR\n  a, b, out : BOOL;\nEND_VAR\nIMPLEMENTATION FBD\nNETWORK\n" + s + "\nEND_NETWORK\nEND_PROGRAM\n";
        Assert.Equal(same, PushedText.SameExceptLayout("P.prg", Prg("  out := (a AND b);"), Prg(statement)));
    }

    /// <summary>The extension is the kind wherever a wire name exists (the ST reader's contract), and the text's header
    /// is never read for it: a text whose header says another kind is compared as the kind its NAME says, exactly as
    /// the push wrote it (openspec <c>push-without-header-check</c>; this used to assert the header refusal).</summary>
    [Fact]
    public void An_item_is_read_at_its_wire_kind()
    {
        const string prg = "PROGRAM P\nVAR\nEND_VAR\nIMPLEMENTATION ST\nx := 1;\nEND_PROGRAM\n";
        Assert.True(PushedText.SameExceptLayout("P.fb", prg, prg));
        Assert.False(PushedText.SameExceptLayout("P.fb", prg, prg.Replace("x := 1;", "x := 2;")));
    }

    /// <summary>The outer END line is a token of the text, not layout. TwinCAT keeps a function block's tree kind when
    /// the text pushed under <c>X.fb</c> says <c>PROGRAM … END_PROGRAM</c>, and gives it back as
    /// <c>PROGRAM … END_FUNCTION_BLOCK</c> (DIALECT C2f, measured 2026-09-30). Both read to the same declaration and
    /// body, so "same but for layout" adopted the IDE's text into the working tree and rewrote the engineer's
    /// <c>END_PROGRAM</c> unseen. Its case is layout, as any keyword's is.</summary>
    /// <summary>Which name the IDE may publish a pushed object under instead (DIALECT C2f): another kind of the same
    /// family, same bare name in any case. Across families it is another item, and a name is never "held as" itself. A
    /// DUT has one name, <c>X.dut</c> (openspec <c>push-without-header-check</c> 5.P — this used to pair <c>X.struct</c>
    /// with <c>X.enum</c>), so only its spelling's case can differ.</summary>
    [Theory]
    [InlineData("X.fb", "X.prg", true)]
    [InlineData("X.fb", "x.fun", true)]
    [InlineData("X.dut", "x.dut", true)]
    [InlineData("X.dut", "X.dut", false)]
    [InlineData("X.fb", "X.fb", false)]
    [InlineData("X.fb", "X.dut", false)]
    [InlineData("X.fb", "Y.prg", false)]
    [InlineData("X.gvl", "X.prg", false)]
    public void A_pushed_object_may_be_held_under_another_kind_of_its_family(string pushed, string held, bool may) =>
        Assert.Equal(may, PushedText.MayBeHeldAs(pushed, held));

    [Fact]
    public void The_outer_END_keyword_is_a_token_not_layout()
    {
        const string pushed = "PROGRAM X\nVAR\n\tn : INT;\nEND_VAR\nIMPLEMENTATION ST\nn := 6;\nEND_PROGRAM\n";
        Assert.False(PushedText.SameExceptLayout("X.fb", pushed, pushed.Replace("END_PROGRAM", "END_FUNCTION_BLOCK")));
        Assert.True(PushedText.SameExceptLayout("X.fb", pushed, pushed.Replace("END_PROGRAM", "end_program")));
    }
}
