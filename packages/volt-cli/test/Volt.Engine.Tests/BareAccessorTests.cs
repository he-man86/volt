using System.Linq;
using Volt.Engine.Workspace;
using Volt.Engine.Workspace.SourceText;
using Xunit;

namespace Volt.Cli.Tests;

/// <summary>
/// REGRESSION: a BARE `GET` / `SET` (the bodiless accessor form — one keyword, no `END_GET`) must parse as a
/// PRESENT accessor.
/// <para>It used to fall off the end of the accessor scan unclosed: the boundary list stayed empty, the keyword
/// was swallowed into the property's DECLARATION, the accessor came back <c>null</c>, and the push then REMOVED
/// the engineer's getter — because a null accessor means "this property has no getter". Silent data loss, from a
/// shape `volt-lsp-iec` documents as valid (`units/interface.ts`: "a bare keyword OR a full GET … END_GET
/// block"). `PouToStText` only ever emits the block form, so nothing in the round-trip suite could reach it.</para>
/// <para>The distinction under test is the one the whole accessor model turns on: <c>null</c> = no such accessor
/// (remove it), <c>""</c> = present but bodiless (keep it).</para>
/// </summary>
public class BareAccessorTests
{
    private static StSplitter.StChild OnlyChild(string src) =>
        StSplitter.SplitSt(src).Children.Single();

    private const string Fb = "FUNCTION_BLOCK K\nVAR\nEND_VAR\n\nEND_FUNCTION_BLOCK\n\n";

    [Theory]
    [InlineData("GET")]
    [InlineData("SET")]
    public void A_bare_accessor_keyword_is_a_present_but_empty_accessor(string keyword)
    {
        var child = OnlyChild(Fb + $"PROPERTY P : INT\n{keyword}\nEND_PROPERTY\n");

        var acc = keyword == "GET" ? child.Getter : child.Setter;
        Assert.NotNull(acc);                       // present — NOT null, which would delete it on push
        Assert.Equal("", acc!.Implementation);     // …and empty, which is what bodiless means
        Assert.DoesNotContain(keyword, child.Declaration);   // …and not swallowed into the declaration
    }

    /// <summary>Both bare accessors together, and the property declaration stays clean.</summary>
    [Fact]
    public void Both_bare_accessors_parse_and_the_declaration_is_untouched()
    {
        var child = OnlyChild(Fb + "PROPERTY P : INT\nGET\nSET\nEND_PROPERTY\n");

        Assert.NotNull(child.Getter);
        Assert.NotNull(child.Setter);
        Assert.Equal("PROPERTY P : INT", child.Declaration.Trim());
    }

    /// <summary>The block form still parses as before — the fix must not change the shape that already worked.</summary>
    [Fact]
    public void The_block_form_still_carries_its_body()
    {
        var child = OnlyChild(Fb + "PROPERTY P : INT\nGET\nP := 1;\nEND_GET\nEND_PROPERTY\n");

        Assert.Equal("P := 1;", child.Getter!.Implementation.Trim());
        Assert.Null(child.Setter);                 // absent stays absent
    }
}
