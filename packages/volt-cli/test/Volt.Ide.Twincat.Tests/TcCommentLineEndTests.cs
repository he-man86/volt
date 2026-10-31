using System.Linq;
using Volt.Engine.Format.Body;
using Volt.Engine.Format.Network;
using System.Xml.Linq;
using Xunit;

namespace Volt.Ide.Twincat.Tests;

/// <summary>
/// A NETWORK COMMENT'S CR LF THROUGH THE ARCHIVE'S XML (ld-fbd-coverage 2R.3; measured live 2026-10-17, TcXaeShell 15.0 /
/// Project14, DIALECT N42 f). TwinCAT keeps a value's characters and hands its CR LF back RAW: a comment written as
/// <c>&amp;#xD;</c> + LF and one written as a raw CR LF both read back as a raw CR LF, and a bare LF reads back as a bare
/// LF. XML's end-of-line normalization would fold a raw CR LF into LF on the way through Volt, so the in-place writer
/// parses the handed archive WITHOUT it (<see cref="TcArchive.Parse"/>) and writes every value as it holds it
/// (<see cref="TcArchive.Text"/>): an untouched value comes back byte for byte, and the read takes the parsed LF as the
/// IDE's line break.
/// </summary>
public class TcCommentLineEndTests
{
    [Fact]
    public void A_carriage_return_survives_the_archive_text()
    {
        const string handed = "<v>\"a\r\nb\"</v>";
        Assert.Equal(handed, TcArchive.Text(TcArchive.Parse(handed), handed));
    }

    /// <summary>A BARE LF STAYS A BARE LF (2R.3 review): <c>XNode.ToString</c> writes every LF in a text node as the
    /// platform's new line (CR LF on Windows), so a push rewrote every multi-line value of the WHOLE body (an untouched
    /// network's title, an EXECUTE box's ST lines) from LF to CR LF in the IDE. Each value keeps exactly what it holds.</summary>
    [Fact]
    public void A_bare_line_feed_is_written_as_a_line_feed()
    {
        var doc = new XDocument(new XElement("a",
            new XElement("v", "\"l1\nl2\""),
            new XElement("w", "\"c1\r\nc2\""),
            new XAttribute("x", "p\nq")));
        var text = TcArchive.Text(doc, "");
        var back = TcArchive.Parse(text);
        Assert.Equal("\"l1\nl2\"", back.Element("v")!.Value);
        Assert.Equal("\"c1\r\nc2\"", back.Element("w")!.Value);
        Assert.Equal("p\nq", (string?)back.Attribute("x"));
        Assert.Contains("l1\nl2", text);
    }

    /// <summary>THE FORMATTING IS THE ARCHIVE'S LAYOUT, NOT A VALUE (twincat-inproc-host, the native writer): TwinCAT stores
    /// the archive as handed (DIALECT N42 a), so the white space between elements keeps the handed archive's own line end,
    /// and a network spliced in sits in the same layout. Written with the values' rule, each line break of a spliced
    /// network (laid out in memory as LF) left TwinCAT's CR LF layout.</summary>
    [Fact]
    public void The_formatting_between_elements_keeps_the_handed_line_end()
    {
        const string handed = "<a>\r\n  <v>\"x\r\ny\"</v>\r\n  <w />\r\n</a>";
        var doc = TcArchive.Parse(handed);
        Assert.Equal(handed, TcArchive.Text(doc, handed));

        doc.Element("w")!.AddAfterSelf(new XText("\n  "), new XElement("u"));   // a spliced element, laid out in memory
        Assert.Equal("<a>\r\n  <v>\"x\r\ny\"</v>\r\n  <w />\r\n  <u />\r\n</a>", TcArchive.Text(doc, handed));
    }

    [Fact]
    public void A_parsed_line_feed_is_the_comments_line_break()
    {
        Assert.Equal("first\r\nsecond", TcNetworkReader.Comment("first\nsecond"));
        Assert.Equal("first\r\nsecond", TcNetworkReader.Comment("first\r\nsecond"));
        Assert.Null(TcNetworkReader.Comment(""));
    }

    /// <summary>AN UNTOUCHED NETWORK'S LINE ENDS ARE NEVER CHANGED (gate 2R.3, finding 2). The archive the XAE hands holds a
    /// comment's CR LF raw (measured, DIALECT N42 f); a push that changes only network 2 hands network 1's comment back
    /// exactly as it came — not folded to a bare LF by the parse, which the pull would hide (it reads LF as CR LF).</summary>
    [Fact]
    public void An_untouched_comment_is_written_back_as_the_archive_held_it()
    {
        var (xml, pushed, scope) = TwoNetworks("\"a\r\nb\"");

        var written = TcNetworkWriter.Apply(xml, pushed, scope);

        Assert.NotNull(written);
        Assert.Contains("<v n=\"Comment\">\"a\r\nb\"</v>", written);
        Assert.Equal("c", TcNetworkReader.Read(TcArchive.Root(written)!, BodyLanguage.Ld).Networks[1].Comment);
    }

    /// <summary>…and a comment Volt writes is written as the IDE holds one: its CR LF raw.</summary>
    [Fact]
    public void A_comment_the_push_writes_keeps_its_line_break()
    {
        var (xml, pushed, scope) = TwoNetworks("\"a\r\nb\"");
        var edited = pushed with { Networks = new[] { pushed.Networks[0], pushed.Networks[1] with { Comment = "c\r\nd" } } };

        var written = TcNetworkWriter.Apply(xml, edited, scope);

        Assert.NotNull(written);
        Assert.Contains("<v n=\"Comment\">\"c\r\nd\"</v>", written);
        Assert.Equal("c\r\nd", TcNetworkReader.Read(TcArchive.Root(written)!, BodyLanguage.Ld).Networks[1].Comment);
    }

    private static (string Xml, NetworkBody Pushed, NetworkScope Scope) TwoNetworks(string firstComment)
    {
        var xml = XDocument.Parse(Fixtures.Pou("importer-unwired.TcPOU"), LoadOptions.PreserveWhitespace)
            .Descendants("NWL").Single().ToString(SaveOptions.DisableFormatting);
        // The MUL's unwired first pin wired to `m`: an empty operand on a function's pin has no spelling (refused by
        // name, as on CODESYS), and this test is about another network.
        xml = WireMul(xml);
        const string empty = "<v n=\"Comment\">\"\"</v>";
        var first = xml.IndexOf(empty, System.StringComparison.Ordinal);
        xml = xml.Substring(0, first) + "<v n=\"Comment\">" + firstComment + "</v>" + xml.Substring(first + empty.Length);
        var scope = NetworkScope.FromDeclarations("PROGRAM VltProbe_Max\nVAR\n  n : INT;\n  m : INT;\n  t1 : TON;\nEND_VAR",
                                                  _ => null, () => System.Array.Empty<string>(), Volt.Tests.Shared.Scopes.NoItem, BeckhoffDriver.RefusedPouName, Volt.Tests.Shared.Scopes.NoLibrary);
        var pulled = TcNetworkReader.Read(XElement.Parse(xml).DescendantsAndSelf("o").First(o => (string?)o.Attribute("t") == "NWLImplementationObject"), BodyLanguage.Ld);
        Assert.Equal("a\r\nb", pulled.Networks[0].Comment);
        return (xml, pulled with { Networks = new[] { pulled.Networks[0], pulled.Networks[1] with { Comment = "c" } } }, scope);
    }

    internal static string WireMul(string xml)
    {
        const string unwired = "<v n=\"Operand\">\"\"</v>";
        var at = xml.IndexOf(unwired, System.StringComparison.Ordinal);
        return xml.Substring(0, at) + "<v n=\"Operand\">\"m\"</v>" + xml.Substring(at + unwired.Length);
    }
}
