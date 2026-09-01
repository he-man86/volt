using System.Linq;
using Xunit;
using Xunit.Abstractions;
using Volt.Engine.Format.St;
using Volt.Engine.Format.Body;

namespace Volt.Engine.Tests;

/// <summary>
/// A structural keyword must be found on a line that also carries a comment.
///
/// <para><c>ScanContext.Update</c> calls <c>CodeHelper.CodeOn</c> — the repo's one trivia scanner — and then
/// throws the stripped code away, keeping only whether it was empty. Every keyword test then runs against the RAW
/// line. So <c>(* restore *) END_GET</c> is correctly judged to CONTAIN code, and just as correctly fails to
/// match <c>END_GET</c>, because the raw line starts with <c>(*</c>.</para>
///
/// <para>That single mismatch is the root of both boundary failures. An accessor whose <c>END_GET</c> carries a
/// leading comment is never closed, so the next keyword — or <c>END_PROPERTY</c> — closes it as BARE, and a bare
/// accessor means "exists, holds no code". The body is discarded on READ, before any push is involved, and the
/// next push then clears it in the IDE.</para>
///
/// <para>A trailing comment on a header line is ordinary in PLC source — it is where engineers put the note
/// explaining what the accessor is for.</para>
/// </summary>
public class StReaderTriviaBoundaryTests
{
    private readonly ITestOutputHelper _out;
    public StReaderTriviaBoundaryTests(ITestOutputHelper o) => _out = o;

    private const string Fb =
        "FUNCTION_BLOCK FB_P\n" +
        "VAR\n\tx : INT;\nEND_VAR\n\n" +
        "x := x + 1;\n" +
        "END_FUNCTION_BLOCK\n";

    /// <summary>The getter's body must survive a comment sitting before <c>END_GET</c>.</summary>
    [Fact]
    public void An_accessor_closed_on_a_commented_line_keeps_its_body()
    {
        var src = Fb +
            "\nPROPERTY P : INT\n" +
            "GET\n" +
            "\tP := x;\n" +
            "(* restore *) END_GET\n" +
            "SET\n" +
            "\tx := P;\n" +
            "END_SET\n" +
            "END_PROPERTY\n";

        var item = StReader.Read(src);
        var prop = item.Members.Single(m => m.Name == "P");
        _out.WriteLine($"getter: '{prop.Getter?.Body}'  setter: '{prop.Setter?.Body}'");

        Assert.Contains("P := x;", prop.Getter?.Body ?? "");
        Assert.Contains("x := P;", prop.Setter?.Body ?? "");
    }

    /// <summary>And the general rule the accessor case is one instance of: a structural keyword is still
    /// structural when a closed comment precedes it on the same line. <c>END_VAR</c> is the one that decides
    /// where a member's declaration stops and its code begins, so missing it silently moves lines across that
    /// boundary.</summary>
    [Fact]
    public void A_method_whose_END_VAR_carries_a_leading_comment_splits_correctly()
    {
        var src = Fb +
            "\nMETHOD M : INT\n" +
            "VAR_INPUT\n" +
            "\td : INT;\n" +
            "(* end of inputs *) END_VAR\n" +
            "M := d * 2;\n" +
            "END_METHOD\n";

        var item = StReader.Read(src);
        var m = item.Members.Single(x => x.Name == "M");
        _out.WriteLine($"decl: '{m.Declaration}'\nbody: '{m.Body}'");

        Assert.Contains("d : INT;", m.Declaration);
        Assert.Contains("M := d * 2;", m.Body ?? "");
        // and the boundary did not leak: the declaration must not have swallowed the code
        Assert.DoesNotContain("M := d * 2;", m.Declaration);
    }

    /// <summary>An ACTION has no declaration of its own — it shares the parent POU's variables — so every line
    /// of it is implementation.
    /// <para>The split is otherwise kind-agnostic and keys on the LAST <c>END_VAR</c>, which for an action can
    /// only ever be a false positive. It matters more than a misplaced line because <c>PouDocument</c> correctly
    /// nulls an action's declaration on push: anything the split put there is not moved, it is DROPPED.</para></summary>
    [Fact]
    public void An_action_puts_every_line_in_its_implementation()
    {
        var src = Fb +
            "\nACTION A\n" +
            "\tx := 1;\n" +
            "\tx := 2;\n" +
            "END_ACTION\n";

        var item = StReader.Read(src);
        var a = item.Members.Single(m => m.Name == "A");
        _out.WriteLine($"decl: '{a.Declaration}'\nbody: '{a.Body}'");

        Assert.Contains("x := 1;", a.Body ?? "");
        Assert.Contains("x := 2;", a.Body ?? "");
    }
}
