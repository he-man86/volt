using System.Collections.Generic;
using Volt.Engine.Item;
using Xunit;

namespace Volt.Ide.Twincat.Tests;

/// <summary>
/// TwinCAT's half of the one language-change comparison (openspec <c>bridge-refusal-review</c> D7; DIALECT N24): it has
/// NO in-place route at any site — ST over a graphical body is refused by the IDE, an archive over an ST body is stored
/// as ST text that does not compile — so it answers every change with that reason, which the push's guard reports by
/// name. And the read hands the body's language up as the fact it took it from (D6).
/// </summary>
[Collection(NetworkTextSwitchCollection.Name)]
public class TcLanguageChangeTests
{
    [Theory]
    [InlineData("pou", "FBD", "ST")]
    [InlineData("pou", "ST", "LD")]
    [InlineData("method", "LD", "ST")]
    [InlineData("property_get", "ST", "FBD")]
    public void Every_language_change_is_refused_naming_N24(string site, string from, string to)
    {
        var why = new BeckhoffDriver(new TcObjectModel()).RefusedLanguageChange(site, from, to);
        Assert.NotNull(why);
        Assert.Contains($"no route to change an existing body's language in place (from {from} to {to})", why);
        Assert.Contains("DIALECT N24", why);
    }

    private const string Ladder =
        "<NWL><o t=\"NWLImplementationObject\"><v n=\"DefaultViewMode\">\"Ld\"</v><l2 n=\"NetworkList\"/></o></NWL>";

    /// <summary>THE DRIVER'S OWN WRITE ASKS THE SAME PREDICATE (review of 4a; <c>ICodeStore.RefusedLanguageChange</c>):
    /// TwinCAT's write never asked it, so a write that skipped the guard had no backstop — ST text set over an archive is
    /// a raw vendor throw, an archive over ST is stored as ST text that does not compile (N24). Both are refused by name
    /// now, before the body is written.</summary>
    [Fact]
    public void ST_written_over_a_graphical_body_is_refused_by_the_write_itself()
    {
        var pou = new TcHiddenBodyWriteTests.Node("FB_L", ItemKind.PlcPou, "FUNCTION_BLOCK FB_L\nVAR\nEND_VAR", Ladder);
        var ex = Assert.Throws<Volt.Engine.BridgeException>(() =>
            TcUntouchablePouTests.BoundDriver().WriteContent(new ItemRef(pou),
                new ItemContent(ItemKind.Kinds.Pou, "FUNCTION_BLOCK FB_L\nVAR\nEND_VAR", "x := 1;", new List<Member>(),
                                Stated: StatedLanguage.St),
                Volt.Engine.Ide.PushedDeclarations.None));
        Assert.Equal(Volt.Contracts.BridgeErrorCodes.Unsupported, ex.ErrorCode);
        Assert.Contains("(from LD to ST)", ex.Message);
        Assert.Equal(0, pou.ImplementationWrites);
    }

    [Fact]
    public void A_graphical_body_written_over_ST_is_refused_by_the_write_itself()
    {
        const string decl = "FUNCTION_BLOCK FB_S\nVAR\n\ta, q : BOOL;\nEND_VAR";
        var pou = new TcHiddenBodyWriteTests.Node("FB_S", ItemKind.PlcPou, decl, "q := a;");
        var ex = Assert.Throws<Volt.Engine.BridgeException>(() =>
            TcUntouchablePouTests.BoundDriver().WriteContent(new ItemRef(pou),
                new ItemContent(ItemKind.Kinds.Pou, decl, "IMPLEMENTATION LD\nNETWORK\n  q := a;\nEND_NETWORK",
                                new List<Member>(), Stated: StatedLanguage.Shown("LD")),
                Volt.Engine.Ide.PushedDeclarations.None));
        Assert.Equal(Volt.Contracts.BridgeErrorCodes.Unsupported, ex.ErrorCode);
        Assert.Contains("(from ST to LD)", ex.Message);
        Assert.Equal(0, pou.ImplementationWrites);
    }

    private static ItemContent Read(string implementation) =>
        new BeckhoffDriver(new TcObjectModel()).ReadContent(new ItemRef(
            new TcHiddenBodyWriteTests.Node("FB_Odd", ItemKind.PlcPou, "FUNCTION_BLOCK FB_Odd\nVAR\n\tx : BOOL;\nEND_VAR",
                                            implementation)));

    /// <summary>D6: ST, a hidden view and a CFC chart each come up with the language the archive states.</summary>
    [Theory]
    [InlineData("x := 1;", "ST", false)]
    [InlineData("<NWL><o t=\"NWLImplementationObject\"><v n=\"DefaultViewMode\">\"IL\"</v></o></NWL>", "IL", true)]
    [InlineData("<CFC><x/></CFC>", "CFC", true)]
    public void The_read_states_the_body_language_the_archive_states(string raw, string language, bool hidden) =>
        Assert.Equal(new StatedLanguage(language, hidden), Read(raw).Stated);

    /// <summary>No body text states no language — an empty ST body, as TwinCAT stores it.</summary>
    [Fact]
    public void No_body_text_states_no_language() => Assert.Null(Read("").Stated);
}
