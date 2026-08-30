using System.Linq;
using Xunit;
using Volt.Engine.Format.St;

namespace Volt.Cli.Tests;

/// <summary>
/// Where an INTERFACE's declaration ends — and why nothing here reads what is IN it.
///
/// <para>A declaration is handed to the IDE VERBATIM: it is written straight to the declaration aspect, and Volt
/// never interprets it. So the splitter's only job is to find the BOUNDARY, and it must do that without a
/// vocabulary of header keywords — otherwise every header shape it has not heard of breaks it.</para>
///
/// <para>It did break, on a real customer project: the declaration ended at the <c>INTERFACE</c> header LINE,
/// which is right only while the whole header fits on one line. CODESYS stores it wrapped, so
/// <c>EXTENDS IModuleStartable</c> landed in the member region and <c>SplitChildren</c> refused it — Volt pulled
/// the interface and would not take its own text back. The first fix taught the splitter to recognise
/// <c>EXTENDS</c> and <c>IMPLEMENTS</c> by name, which would have failed again on the next unknown header word.
/// The boundary is now "everything before the first member", which needs no vocabulary at all — and these tests
/// pin that, not the keyword list.</para>
/// </summary>
public class InterfaceHeaderBoundaryTests
{
    /// <summary>A header word the splitter has NEVER heard of still belongs to the declaration. This is the
    /// test the keyword-matching version could not have passed.</summary>
    [Theory]
    [InlineData("EXTENDS IBase")]
    [InlineData("IMPLEMENTS IOther")]
    [InlineData("{attribute 'hide'}")]
    [InlineData("SOMETHING_VOLT_HAS_NEVER_SEEN Foo")]
    public void An_unrecognised_header_continuation_stays_in_the_declaration(string continuation)
    {
        var src = string.Join("\n",
            "INTERFACE IThing",
            continuation,
            "",
            "METHOD Go : BOOL",
            "END_METHOD",
            "",
            "END_INTERFACE");

        var split = StReader.Read(src);

        Assert.Contains(continuation, split.Declaration);
        Assert.Equal(new[] { "Go" }, split.Members.Select(m => m.Name).ToArray());
    }

    /// <summary>THE OTHER SIDE OF THE BOUNDARY. A comment written above a method documents the METHOD, and the
    /// declaration must not swallow it — which is the trap in "everything before the first member" if the
    /// boundary is taken at the keyword line rather than at the start of the member's own block.</summary>
    [Fact]
    public void A_comment_above_a_method_belongs_to_the_method_not_the_declaration()
    {
        var src = string.Join("\n",
            "INTERFACE IThing",
            "EXTENDS IBase",
            "",
            "// what Go does",
            "METHOD Go : BOOL",
            "END_METHOD",
            "",
            "END_INTERFACE");

        var split = StReader.Read(src);

        Assert.DoesNotContain("what Go does", split.Declaration);
        var member = Assert.Single(split.Members);
        Assert.Equal("Go", member.Name);
        Assert.Contains("what Go does", member.Declaration);
    }

    /// <summary>An interface with NO members is all declaration — the boundary has nothing to find and must not
    /// invent one.</summary>
    [Fact]
    public void An_interface_with_no_members_is_all_declaration()
    {
        var src = string.Join("\n", "INTERFACE IEmpty", "EXTENDS IBase", "", "END_INTERFACE");

        var split = StReader.Read(src);

        Assert.Contains("INTERFACE IEmpty", split.Declaration);
        Assert.Contains("EXTENDS IBase", split.Declaration);
        Assert.Empty(split.Members);
    }

    /// <summary>A `METHOD` written inside a COMMENT is not a member, so it must not end the declaration.</summary>
    [Fact]
    public void A_member_keyword_inside_a_comment_does_not_end_the_declaration()
    {
        var src = string.Join("\n",
            "INTERFACE IThing",
            "EXTENDS IBase",
            "(* METHOD NotReal : BOOL *)",
            "",
            "METHOD Real : BOOL",
            "END_METHOD",
            "",
            "END_INTERFACE");

        var split = StReader.Read(src);

        Assert.Equal(new[] { "Real" }, split.Members.Select(m => m.Name).ToArray());
    }
}
