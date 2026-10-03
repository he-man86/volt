using System;
using System.Xml.Linq;
using Volt.Engine.Format.Network;
using Volt.Engine.Item;
using Xunit;

namespace Volt.Ide.Twincat.Tests;

/// <summary>
/// THE LANGUAGE A TWINCAT BODY IS PULLED UNDER COMES FROM THE ARCHIVE, AND ONLY FROM WHAT IT STATES.
///
/// <para>The stated language is the one signal for how a body is read (openspec <c>implementation-keyword</c>), so a
/// body whose language the archive does not state, or states as something Volt has never seen, is never pulled under a
/// language it was guessed to have. It is HIDDEN under the name the archive gives — its view, its root, or <c>NWL</c> for
/// an archive stating no view — exactly as a CFC chart is (D27, openspec <c>bridge-refusal-review</c> 2.29, 2.34). Both
/// were refusals thrown outside <c>NetworkText.Pulled</c>, which took the whole POU — declaration and members — out of
/// refs and fetch. CODESYS answers the same cases the same way (<c>CodesysUnknownBodyLanguageTests</c>), through the one
/// engine answer, <see cref="NetworkText.ViewLanguage"/>.</para>
/// </summary>
[Collection(NetworkTextSwitchCollection.Name)]
public class TcBodyLanguageTests
{
    private static string Nwl(string? viewMode) =>
        "<NWL><o t=\"NWLImplementationObject\">" +
        (viewMode is null ? "" : $"<v n=\"DefaultViewMode\">\"{viewMode}\"</v>") +
        "</o></NWL>";

    /// <summary>The POU as the driver pulls it, over a plain node <c>dynamic</c> binds to as to the COM object.</summary>
    private static ItemContent Read(string implementation) =>
        new BeckhoffDriver(new TcObjectModel()).ReadContent(new ItemRef(
            new TcHiddenBodyWriteTests.Node("FB_Odd", ItemKind.PlcPou, "FUNCTION_BLOCK FB_Odd\nVAR\n\tx : BOOL;\nEND_VAR",
                                            implementation)));

    [Theory]
    [InlineData("Ld", "LD")]
    [InlineData("Fbd", "FBD")]
    public void A_stated_view_is_the_view_the_archive_names(string mode, string stated)
    {
        Assert.Equal(stated, NetworkText.ViewLanguage(TcArchive.ViewMode(XElement.Parse(Nwl(mode)).Element("o")!)));
    }

    /// <summary>IL is a view Volt does not read: <c>IMPLEMENTATION IL UNSUPPORTED</c>.</summary>
    [Fact]
    public void An_IL_view_is_the_IL_UNSUPPORTED_line()
    {
        Assert.Equal("IMPLEMENTATION IL UNSUPPORTED", Read(Nwl("IL")).Body);
    }

    /// <summary>2.29: no view at all is NOT IL (it once shared IL's answer, a language the body is not known to have) and
    /// is no lost POU either: the archive's own name for the body, <c>NWL</c>, and the declaration still pulls.</summary>
    [Fact]
    public void An_archive_with_no_view_is_the_NWL_UNSUPPORTED_line_and_the_declaration_still_pulls()
    {
        var content = Read(Nwl(null));

        Assert.Equal("IMPLEMENTATION NWL UNSUPPORTED", content.Body);
        Assert.Equal("FUNCTION_BLOCK FB_Odd\nVAR\n\tx : BOOL;\nEND_VAR", content.Declaration);
        Assert.Null(content.Unsupported);
    }

    /// <summary>2.29: a fourth view beside LD, FBD and IL.</summary>
    [Fact]
    public void An_unknown_view_is_the_UNSUPPORTED_line_naming_it()
    {
        Assert.Equal("IMPLEMENTATION SEQUENCE UNSUPPORTED", Read(Nwl("Sequence")).Body);
    }

    [Theory]
    [InlineData("<CFC><x/></CFC>", "CFC")]
    [InlineData("<SFC/>", "SFC")]
    public void A_CFC_or_SFC_body_is_its_unread_language(string raw, string expected)
    {
        Assert.Equal(expected, TcArchive.UnreadLanguage(raw));
    }

    [Theory]
    [InlineData("x := 1;")]
    [InlineData("(* <UML/> *)\nx := 1;")]
    public void Text_that_is_not_XML_is_no_unread_body(string raw)
    {
        Assert.Null(TcArchive.UnreadLanguage(raw));
    }

    /// <summary>2.34: a graphical body whose root Volt has never seen is its UNSUPPORTED line under that root's name —
    /// pulled whole, where a refusal took the POU out of refs and fetch (and, before that, its XML fell through as TEXT
    /// and pulled under <c>IMPLEMENTATION ST</c>).</summary>
    [Theory]
    [InlineData("<UML><state/></UML>", "IMPLEMENTATION UML UNSUPPORTED")]
    [InlineData("<NWL><o t=\"Other\"/></NWL>", "IMPLEMENTATION NWL UNSUPPORTED")]
    // A root that names a language Volt READS, in a form it does not (no NWL archive): a vendor fact, the hidden LD/FBD
    // body line — never a "Volt bug" thrown on the read path, which took the POU out of refs (review 2e+2g, low).
    [InlineData("<LD><x/></LD>", "IMPLEMENTATION LD UNSUPPORTED")]
    [InlineData("<Fbd><x/></Fbd>", "IMPLEMENTATION FBD UNSUPPORTED")]
    public void An_unknown_graphical_root_is_the_UNSUPPORTED_line_naming_it(string raw, string line)
    {
        var content = Read(raw);

        Assert.Equal(line, content.Body);
        Assert.Equal("FUNCTION_BLOCK FB_Odd\nVAR\n\tx : BOOL;\nEND_VAR", content.Declaration);
    }
}
