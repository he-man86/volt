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
    [InlineData("  out := a AND\n    b;", true)]
    [InlineData("  out := a OR b;", false)]
    // Another SPELLING of the same program is written since 2.12 and comes back canonical: the same item, not "another
    // program" (1+2d review — the CLI told the user the IDE held another program than the text pushed). A box word's case
    // is the box type's, so `a and b` is another box type.
    [InlineData("  out := `a` AND b;", true)]
    [InlineData("  out := a and b;", false)]
    public void A_graphical_body_is_compared_by_its_tokens(string statement, bool same)
    {
        static string Prg(string s) =>
            "PROGRAM P\nVAR\n  a, b, out : BOOL;\nEND_VAR\nIMPLEMENTATION FBD\nNETWORK\n" + s + "\nEND_NETWORK\nEND_PROGRAM\n";
        Assert.Equal(same, PushedText.SameExceptLayout("P.pou", Prg("  out := a AND b;"), Prg(statement)));
    }

    /// <summary>A variable of an elementary type is no FB instance to the CLI either (review of
    /// <c>bridge-refusal-review</c> 4a): the comparison's scope takes the words BOTH vendors refuse as a POU name
    /// (<c>BothVendorsRefusedNames</c>). Read with no refused name at all, a BOOL named <c>R_EDGE</c> was an "instance"
    /// that took the edge construct, neither text read, and two spellings of one program were called different.</summary>
    [Theory]
    [InlineData("  out := R_EDGE a AND b;", "  out := R_EDGE `a` AND b;", true)]
    [InlineData("  out := a AND b;", "  out := `a` AND b;", true)]
    [InlineData("  out := R_EDGE a AND b;", "  out := R_EDGE a OR b;", false)]
    public void An_elementary_typed_variable_named_like_a_construct_is_no_instance(string x, string y, bool same)
    {
        static string Prg(string s) =>
            "PROGRAM P\nVAR\n  R_EDGE : BOOL;\n  a, b, out : BOOL;\nEND_VAR\nIMPLEMENTATION FBD\nNETWORK\n" + s +
            "\nEND_NETWORK\nEND_PROGRAM\n";
        Assert.Equal(same, PushedText.SameExceptLayout("P.pou", Prg(x), Prg(y)));
    }

    /// <summary>The extension is the kind wherever a wire name exists (the ST reader's contract), and the text's header
    /// is never read for it: a text whose header says another kind is compared as the kind its NAME says, exactly as
    /// the push wrote it (openspec <c>push-without-header-check</c>; this used to assert the header refusal).</summary>
    [Fact]
    public void An_item_is_read_at_its_wire_kind()
    {
        const string prg = "PROGRAM P\nVAR\nEND_VAR\nIMPLEMENTATION ST\nx := 1;\nEND_PROGRAM\n";
        Assert.True(PushedText.SameExceptLayout("P.pou", prg, prg));
        Assert.False(PushedText.SameExceptLayout("P.pou", prg, prg.Replace("x := 1;", "x := 2;")));
    }

    /// <summary>Which name the IDE may publish a pushed object under instead: the same name in another case, nothing
    /// else. Across families it is another item, and a name is never "held as" itself. A POU has one name, <c>X.pou</c>
    /// (openspec <c>push-without-header-check</c> 5.Q — this used to pair <c>X.fb</c> with <c>X.prg</c> and <c>X.fun</c>,
    /// the names CODESYS re-typed a POU to by its text, DIALECT C2f), and a DUT one, <c>X.dut</c> (5.P), so only the
    /// spelling's case can differ — for every kind (review 5.G: a GVL or an interface in another case was never paired).</summary>
    [Theory]
    [InlineData("X.pou", "x.pou", true)]
    [InlineData("X.dut", "x.dut", true)]
    [InlineData("X.gvl", "x.gvl", true)]
    [InlineData("X.itf", "x.itf", true)]
    [InlineData("X.gvl", "x.dut", false)]
    [InlineData("X.dut", "X.dut", false)]
    [InlineData("X.pou", "X.pou", false)]
    [InlineData("X.pou", "X.dut", false)]
    [InlineData("X.pou", "Y.pou", false)]
    [InlineData("X.gvl", "X.pou", false)]
    public void A_pushed_object_may_be_held_under_another_kind_of_its_family(string pushed, string held, bool may) =>
        Assert.Equal(may, PushedText.MayBeHeldAs(pushed, held));

    /// <summary>The outer END line is a token of the text, not layout. A pull writes it from the declaration's own
    /// header (openspec <c>push-without-header-check</c> 5.Q.3), so text pushed as <c>PROGRAM … END_FUNCTION_BLOCK</c>
    /// comes back <c>PROGRAM … END_PROGRAM</c> — and, before that, TwinCAT gave <c>PROGRAM … END_PROGRAM</c> pushed under
    /// an FB back as <c>… END_FUNCTION_BLOCK</c> (DIALECT C2f). Both read to the same declaration and body, so "same but
    /// for layout" would adopt the IDE's text into the working tree and rewrite the engineer's END line unseen. Its
    /// case is layout, as any keyword's is.</summary>
    [Fact]
    public void The_outer_END_keyword_is_a_token_not_layout()
    {
        const string pushed = "PROGRAM X\nVAR\n\tn : INT;\nEND_VAR\nIMPLEMENTATION ST\nn := 6;\nEND_PROGRAM\n";
        Assert.False(PushedText.SameExceptLayout("X.pou", pushed, pushed.Replace("END_PROGRAM", "END_FUNCTION_BLOCK")));
        Assert.True(PushedText.SameExceptLayout("X.pou", pushed, pushed.Replace("END_PROGRAM", "end_program")));
    }

    /// <summary>A positional FUNCTION call is pushed with the input names the gate derives from the callee's
    /// declaration (ld-fbd-coverage 2R.4), and the IDE holds them: <c>F(n)</c> comes back <c>F(a := n)</c>. The CLI
    /// reads with no project, so it cannot derive — it is the same item all the same, adopted as the IDE's text, never
    /// "held otherwise" (which pinned <c>volt/ide</c> to the pushed text and brought the names in on the next pull as an
    /// IDE change nobody made). A held pin with another VALUE, or a pin the text named held under another NAME, is
    /// another program.</summary>
    [Theory]
    [InlineData("r := F(n);", "r := F(a := n);", true)]
    [InlineData("r := F(n, m);", "r := F(a := n, b := m);", true)]
    [InlineData("r := F(n, b := m);", "r := F(a := n, b := m);", true)]
    [InlineData("r := F(n);", "r := F(a := m);", false)]
    [InlineData("r := F(a := n);", "r := F(b := n);", false)]
    [InlineData("r := F(n, b := m);", "r := F(a := n, c := m);", false)]
    [InlineData("r := F(n);", "r := G(a := n);", false)]
    public void A_positional_function_call_held_with_its_derived_names_is_the_same_item(string pushed, string held, bool same)
    {
        static string Prg(string s) =>
            "PROGRAM P\nVAR\n  n, m, r : INT;\nEND_VAR\nIMPLEMENTATION FBD\nNETWORK\n  " + s + "\nEND_NETWORK\nEND_PROGRAM\n";
        Assert.Equal(same, PushedText.SameExceptLayout("P.pou", Prg(pushed), Prg(held)));
    }
}
