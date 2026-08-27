using System.Linq;
using Xunit;
using Xunit.Abstractions;
using Volt.Engine.Text;

namespace Volt.Cli.Tests;

/// <summary>
/// A PROPERTY header must accept the modifiers a METHOD header already does.
///
/// <para>Same file, same shape of line, two different rules:</para>
/// <code>
/// METHOD    (?:(?:PUBLIC|PRIVATE|PROTECTED|INTERNAL|FINAL|ABSTRACT)\s+)*   // any number, incl. FINAL/ABSTRACT
/// PROPERTY  (?:(?:PUBLIC|PRIVATE|PROTECTED|INTERNAL)\s+)?                  // at most ONE, no FINAL/ABSTRACT
/// </code>
///
/// <para>So <c>PROPERTY PUBLIC ABSTRACT Ready : INT</c> — ordinary CODESYS — does not parse, and the failure is a
/// thrown <c>InvalidSt</c> rather than a diagnostic. It is thrown from inside the WRITE, so in a multi-op push it
/// lands mid-apply: earlier ops are already in the IDE.</para>
///
/// <para>And the engineer did not type it. A property declared that way in the IDE MATERIALIZES that way on
/// pull — the declaration is carried verbatim — so this is the pull-then-cannot-push shape again, on a file Volt
/// wrote itself.</para>
/// </summary>
public class PropertyModifierTests
{
    private readonly ITestOutputHelper _out;
    public PropertyModifierTests(ITestOutputHelper o) => _out = o;

    private static string FbWithProperty(string header) =>
        "FUNCTION_BLOCK FB_P\n" +
        "VAR\n\tx : INT;\nEND_VAR\n\n" +
        "x := x + 1;\n" +
        "END_FUNCTION_BLOCK\n" +
        $"\n{header}\n" +
        "GET\n\tReady := x;\nEND_GET\n" +
        "END_PROPERTY\n";

    /// <summary>Every modifier combination the METHOD parser already accepts, applied to a PROPERTY.</summary>
    [Theory]
    [InlineData("PROPERTY Ready : INT")]                       // the plain case — always worked
    [InlineData("PROPERTY PUBLIC Ready : INT")]                // one modifier — worked
    [InlineData("PROPERTY PUBLIC FINAL Ready : INT")]          // two — did not
    [InlineData("PROPERTY PROTECTED ABSTRACT Ready : INT")]    // FINAL/ABSTRACT — not in the set at all
    [InlineData("PROPERTY INTERNAL FINAL Ready : INT")]
    public void A_property_header_accepts_the_modifiers_a_method_header_does(string header)
    {
        var ex = Record.Exception(() => StReader.Read(FbWithProperty(header)));
        Assert.True(ex is null, $"'{header}' is ordinary CODESYS and does not parse: {ex?.Message}");

        var item = StReader.Read(FbWithProperty(header));
        var prop = item.Members.Single(m => m.Name == "Ready");
        Assert.Contains("Ready := x;", prop.Getter?.Body ?? "");
        _out.WriteLine($"{header}  ->  name='{prop.Name}' decl='{prop.Declaration}'");
    }

    /// <summary>The modifiers survive the round trip, rather than being parsed and dropped.
    /// <para>The declaration is what a later push writes back to the IDE. Accepting the header and then losing
    /// <c>ABSTRACT</c> would turn a parse failure into a silent semantic change, which is worse.</para></summary>
    [Fact]
    public void The_modifiers_are_kept_in_the_declaration()
    {
        var item = StReader.Read(FbWithProperty("PROPERTY PUBLIC ABSTRACT Ready : INT"));
        var prop = item.Members.Single(m => m.Name == "Ready");
        Assert.Contains("PUBLIC", prop.Declaration);
        Assert.Contains("ABSTRACT", prop.Declaration);
    }
}
