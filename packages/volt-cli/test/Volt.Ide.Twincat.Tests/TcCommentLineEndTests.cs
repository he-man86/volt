using System.Linq;
using Volt.Engine.Format.Body;
using Volt.Engine.Format.Network;
using System.Xml.Linq;
using Xunit;

namespace Volt.Ide.Twincat.Tests;

/// <summary>
/// A NETWORK COMMENT'S CR LF THROUGH THE ARCHIVE'S XML (ld-fbd-coverage 2R.3, measured live 2026-10-16). XML's
/// end-of-line normalization folds a raw CR LF into LF on every parse, so a two-line comment Volt wrote came back
/// holding a bare LF — which network text cannot spell (P10) — and the whole body pulled as
/// <c>IMPLEMENTATION FBD UNSUPPORTED</c>. The write keeps a CR as <c>&amp;#xD;</c>, and the read takes the parsed LF as
/// the IDE's line break.
/// </summary>
public class TcCommentLineEndTests
{
    [Fact]
    public void A_carriage_return_survives_the_archive_text()
    {
        var doc = new XDocument(new XElement("v", "\"a\r\nb\""));
        Assert.Equal("\"a\r\nb\"", XDocument.Parse(TcArchive.Text(doc, "")).Root!.Value);
    }

    /// <summary>A BARE LF STAYS A BARE LF (2R.3 review): <c>XNode.ToString</c> writes every LF in a text node as the
    /// platform's new line (CR LF on Windows), and entitizing the CR afterwards turned each one into <c>&amp;#xD;</c> +
    /// LF — so a push rewrote every multi-line value of the WHOLE body (an untouched network's title, an EXECUTE box's
    /// ST lines) from LF to CR LF in the IDE. Only a CR the value really holds is kept as one.</summary>
    [Fact]
    public void A_bare_line_feed_is_written_as_a_line_feed()
    {
        var doc = new XDocument(new XElement("a",
            new XElement("v", "\"l1\nl2\""),
            new XElement("w", "\"c1\r\nc2\""),
            new XAttribute("x", "p\nq")));
        var text = TcArchive.Text(doc, "");
        var back = XDocument.Parse(text).Root!;
        Assert.Equal("\"l1\nl2\"", back.Element("v")!.Value);
        Assert.Equal("\"c1\r\nc2\"", back.Element("w")!.Value);
        Assert.Equal("p\nq", (string?)back.Attribute("x"));
        Assert.Contains("l1\nl2", text);
    }

    [Fact]
    public void A_parsed_line_feed_is_the_comments_line_break()
    {
        Assert.Equal("first\r\nsecond", TcNetworkReader.Comment("first\nsecond"));
        Assert.Equal("first\r\nsecond", TcNetworkReader.Comment("first\r\nsecond"));
        Assert.Null(TcNetworkReader.Comment(""));
    }

    /// <summary>AN UNTOUCHED NETWORK'S LINE ENDS ARE NEVER CHANGED BY A GUESS (gate 2R.3, finding 2). Whether the XAE hands a
    /// CR as <c>&amp;#xD;</c> or raw is not measured. Entitized, the parse keeps it and the write hands it back as it came;
    /// raw, the parse folds network 1's CR LF into LF and the write would hand it back as a bare LF on a push that changed
    /// only network 2 — hidden from the pull, which reads LF as CR LF. That write is refused by name.</summary>
    [Fact]
    public void An_untouched_entitized_comment_is_written_back_as_the_archive_held_it()
    {
        var (xml, pushed, scope) = TwoNetworks("\"a&#xD;\nb\"");

        var written = TcNetworkWriter.Apply(xml, pushed, scope);

        Assert.NotNull(written);
        Assert.Contains("<v n=\"Comment\">\"a&#xD;\nb\"</v>", written);
        Assert.Equal("c", TcNetworkReader.Read(TcArchive.Root(written)!, BodyLanguage.Ld).Networks[1].Comment);
    }

    [Fact]
    public void An_archive_holding_a_raw_carriage_return_in_a_value_is_refused_not_rewritten()
    {
        var (xml, pushed, scope) = TwoNetworks("\"a\r\nb\"");

        Assert.Throws<TcRawLineEndRefusal>(() => TcNetworkWriter.Apply(xml, pushed, scope));
    }

    [Fact]
    public void Raw_line_ends_in_the_formatting_between_elements_are_not_a_value()
    {
        Assert.False(TcArchive.HoldsRawLineEnd("<a>\r\n  <v>\"x\"</v>\r\n</a>"));
        Assert.False(TcArchive.HoldsRawLineEnd("<a>\r\n  <v>\"x&#xD;\ny\"</v>\r\n</a>"));
        Assert.True(TcArchive.HoldsRawLineEnd("<a>\r\n  <v>\"x\r\ny\"</v>\r\n</a>"));
        Assert.True(TcArchive.HoldsRawLineEnd("<a x=\"p\r\nq\" />"));
    }

    private static (string Xml, NetworkBody Pushed, NetworkScope Scope) TwoNetworks(string firstComment)
    {
        var xml = XDocument.Parse(Fixtures.Pou("importer-unwired.TcPOU"), LoadOptions.PreserveWhitespace)
            .Descendants("NWL").Single().ToString(SaveOptions.DisableFormatting);
        const string empty = "<v n=\"Comment\">\"\"</v>";
        var first = xml.IndexOf(empty, System.StringComparison.Ordinal);
        xml = xml.Substring(0, first) + "<v n=\"Comment\">" + firstComment + "</v>" + xml.Substring(first + empty.Length);
        var scope = NetworkScope.FromDeclarations("PROGRAM VltProbe_Max\nVAR\n  n : INT;\n  m : INT;\n  t1 : TON;\nEND_VAR",
                                                  _ => null, () => System.Array.Empty<string>(), Volt.Tests.Shared.Scopes.NoItem, BeckhoffDriver.RefusedPouName, Volt.Tests.Shared.Scopes.NoLibrary);
        var pulled = TcNetworkReader.Read(XElement.Parse(xml).DescendantsAndSelf("o").First(o => (string?)o.Attribute("t") == "NWLImplementationObject"), BodyLanguage.Ld);
        Assert.Equal("a\r\nb", pulled.Networks[0].Comment);
        return (xml, pulled with { Networks = new[] { pulled.Networks[0], pulled.Networks[1] with { Comment = "c" } } }, scope);
    }
}
