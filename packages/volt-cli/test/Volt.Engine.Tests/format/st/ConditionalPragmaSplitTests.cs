using System.Linq;
using Xunit;
using Volt.Engine.Format.St;

namespace Volt.Engine.Tests;

/// <summary>
/// A CONDITIONAL-COMPILATION pragma opens a block, so it belongs to the IMPLEMENTATION — it is not trivia.
///
/// The decl/impl split sweeps trailing trivia into the declaration, which is right and well measured: `pro2193`'s
/// `BitLogic` has fourteen members whose declarations end `END_VAR`, a blank line, then a comment, and not one body
/// begins with a comment; reading that comment as the body's first line drifted twenty files. But a comment
/// DOCUMENTS what follows, while `{IF defined(X)}` GUARDS it — and the matching `{ELSE}` / `{END_IF}` sit further
/// down, in code. Sweeping the opener across the boundary cuts the block in half.
///
/// Found from the LSP conformance recordings (2026-09-17): four `conditional_*` fixtures that used to build clean
/// came back with `This code is not supported in declaration part`, `Unexpected End-of-file found: 'ELSIF', 'ELSE'
/// or 'END_IF' expected`, and `'ELSE'/'END_IF' found without matching 'if'` — the compiler describing precisely
/// this split. A TEXT round-trip cannot see it: decl and impl are re-joined on read, so the bytes come back
/// identical while the IDE holds them apart.
/// </summary>
public class ConditionalPragmaSplitTests
{
    private static string DeclOf(string st) => StReader.Read(st).Members.Single().Declaration;
    private static string BodyOf(string st) => StReader.Read(st).Members.Single().Body;

    // The marker is what keeps the block whole: the boundary is STATED, so nothing has to decide whether
    // `{IF defined(X)}` is trivia or code. The rule that used to answer that question is gone with the guess.
    private const string MethodWithConditional =
        "FUNCTION_BLOCK FB\nVAR\n\tiCounter : INT;\nEND_VAR\n(* @volt-implementation *)\n\nEND_FUNCTION_BLOCK\n\n" +
        "METHOD Run\n(* @volt-implementation *)\n{define MY_FLAG}\n{IF defined (MY_FLAG)}\niCounter := 42;\n{ELSE}\nbroken_xyz;\n{END_IF}\nEND_METHOD\n";

    [Fact]
    public void A_conditional_block_is_never_split_across_the_boundary()
    {
        var decl = DeclOf(MethodWithConditional);
        var body = BodyOf(MethodWithConditional);

        // The opener must not be left in the declaration without its closer.
        Assert.DoesNotContain("{IF", decl);
        Assert.DoesNotContain("{define", decl);
        Assert.Equal("METHOD Run", decl);

        // Every part of the block is on the same side of the boundary.
        Assert.Contains("{define MY_FLAG}", body);
        Assert.Contains("{IF defined (MY_FLAG)}", body);
        Assert.Contains("{ELSE}", body);
        Assert.Contains("{END_IF}", body);
    }

    [Fact]
    public void An_ATTRIBUTE_pragma_still_belongs_to_the_declaration()
    {
        // The rule this narrows, not replaces: `{attribute …}` decorates what follows and is declaration trivia.
        const string st =
            "FUNCTION_BLOCK FB\nVAR\n\tn : INT;\nEND_VAR\n(* @volt-implementation *)\nEND_FUNCTION_BLOCK\n\n" +
            "METHOD Run\n{attribute 'monitoring' := 'variable'}\n(* @volt-implementation *)\nn := 1;\nEND_METHOD\n";
        Assert.Contains("{attribute 'monitoring' := 'variable'}", DeclOf(st));
    }

    [Fact]
    public void A_trailing_COMMENT_still_belongs_to_the_declaration()
    {
        // The measured pro2193 shape, unchanged.
        const string st =
            "FUNCTION_BLOCK FB\nVAR\n\tn : INT;\nEND_VAR\n(* @volt-implementation *)\nEND_FUNCTION_BLOCK\n\n" +
            "METHOD Run\nVAR\n\tx : INT;\nEND_VAR\n// what this does\n(* @volt-implementation *)\nn := 1;\nEND_METHOD\n";
        Assert.Contains("// what this does", DeclOf(st));
    }

    [Fact]
    public void The_text_round_trips_either_way_which_is_why_this_needed_its_own_test()
    {
        var content = StReader.Read(MethodWithConditional);
        Assert.Equal(MethodWithConditional.TrimEnd('\n'), StWriter.Write(content).TrimEnd('\n'));
    }
}
