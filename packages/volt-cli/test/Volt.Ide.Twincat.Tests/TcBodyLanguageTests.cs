using System;
using System.Xml.Linq;
using Volt.Engine.Format.Network;
using Xunit;

namespace Volt.Ide.Twincat.Tests;

/// <summary>
/// THE LANGUAGE A TWINCAT BODY IS PULLED UNDER COMES FROM THE ARCHIVE, AND ONLY FROM WHAT IT STATES.
///
/// <para>The stated language is the one signal for how a body is read (openspec <c>implementation-keyword</c>), so
/// a body whose language the archive does not state, or states as something Volt has never seen, is refused by name
/// — never pulled under a language it was guessed to have. CODESYS answers the same two cases the same way
/// (<c>NwlInterop.Require(impl, "DefaultViewMode")</c>, <c>UnreadLanguage</c>), and the wire must be identical.</para>
/// </summary>
public class TcBodyLanguageTests
{
    private static XElement Nwl(string? viewMode) => XElement.Parse(
        "<o t=\"NWLImplementationObject\">" +
        (viewMode is null ? "" : $"<v n=\"DefaultViewMode\">\"{viewMode}\"</v>") +
        "</o>");

    [Theory]
    [InlineData("Ld", BodyLanguage.Ld)]
    [InlineData("Fbd", BodyLanguage.Fbd)]
    public void A_stated_view_is_read_as_its_language(string mode, BodyLanguage expected)
    {
        Assert.Equal(expected, BeckhoffDriver.ViewModeOf(Nwl(mode)));
    }

    /// <summary>IL is a view Volt does not read: null, which the caller states as <c>IMPLEMENTATION IL UNSUPPORTED</c>.</summary>
    [Fact]
    public void An_IL_view_is_the_UNSUPPORTED_answer()
    {
        Assert.Null(BeckhoffDriver.ViewModeOf(Nwl("IL")));
    }

    /// <summary>No view at all is NOT IL. It used to share IL's null and pull as <c>IMPLEMENTATION IL UNSUPPORTED</c> — a
    /// language the body is not known to have.</summary>
    [Fact]
    public void An_archive_with_no_view_is_refused_naming_the_missing_view()
    {
        var ex = Assert.Throws<NotSupportedException>(() => BeckhoffDriver.ViewModeOf(Nwl(null)));
        Assert.Contains("DefaultViewMode", ex.Message);
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

    /// <summary>A graphical body whose root Volt has never seen used to fall through as TEXT and pull under
    /// <c>IMPLEMENTATION ST</c> — the vendor's XML as an engineer's code — where CODESYS refuses an unknown aspect.</summary>
    [Theory]
    [InlineData("<UML><state/></UML>", "UML")]
    [InlineData("<NWL><o t=\"Other\"/></NWL>", "NWL")]
    public void An_unknown_graphical_root_is_refused_naming_it(string raw, string root)
    {
        var ex = Assert.Throws<NotSupportedException>(() => TcArchive.UnreadLanguage(raw));
        Assert.Contains(root, ex.Message);
    }
}
