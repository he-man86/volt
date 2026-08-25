using System.IO;
using System.Linq;
using System.Xml.Linq;
using Xunit;
using Volt.Engine.Document;
using Volt.Engine.Graph;
using Volt.Engine.Model;
using Volt.Engine.Vocabulary;

namespace Volt.Cli.Tests;

/// <summary>
/// The BODY CODEC: one splice writes any body, dispatching on its LANGUAGE — there is no "graphical path".
/// <para>Every case here runs against a RECORDED CODESYS export with a real <c>&lt;FBD&gt;</c> body
/// (<c>VltFbd_FbdRoot.plcopen.xml</c>). Before the codec, a POU whose body was FBD took an entirely separate
/// write (<c>NetworkCodeIo.Write</c>) that wrote ONLY the body — so its declaration edits were silently
/// discarded and its dropped members silently kept. Those are not edge cases; they are what the fork cost.</para>
/// </summary>
public class BodyCodecTests
{
    private static string Fixture(string file) =>
        File.ReadAllText(Path.Combine(System.AppContext.BaseDirectory, "fixtures", "codesys-pou", file));

    private static string Fbd => Fixture("VltFbd_FbdRoot.plcopen.xml");

    private const string DeclA = "PROGRAM VltFbd\nVAR\n\ta : BOOL;\n\tb : BOOL;\nEND_VAR\n";
    private const string DeclB = "PROGRAM VltFbd\nVAR\n\ta : BOOL;\n\tb : BOOL;\n\tcAdded : INT;\nEND_VAR\n";

    /// <summary>The network text the fixture's own body renders to — the canonical form, so a push of it is a
    /// no-op on the body and isolates the declaration as the only thing under test.</summary>
    private static string BodyOfFixture()
    {
        var parsed = PouReader.Parse(Fbd);
        return Volt.Engine.Graph.NetworkCode.RenderBody(parsed.BodyElement!);
    }

    private static ItemContent Split(string decl, string body) =>
        new(ItemKind.Kinds.Program, decl, body, new System.Collections.Generic.List<Member>());

    /// <summary>DEFECT 1 — a declaration edit on a GRAPHICAL POU must land. It used to be discarded silently:
    /// the graphical write path took `declaration` only to resolve FB instance types and never wrote it, while
    /// the push still reported "updated". Measured live on CODESYS 3.5.21.40: a declaration change DOES land on
    /// an FBD-bodied POU through the merge import, body intact — so there was never a vendor reason for it.</summary>
    [Fact]
    public void A_declaration_edit_lands_on_a_graphical_POU()
    {
        var doc = PouDocument.Splice(Fbd, "VltFbd", Split(DeclB, BodyOfFixture()));

        Assert.Contains("cAdded", doc);
        Assert.Contains("<FBD", doc);          // …and the diagram is still a diagram
    }

    /// <summary>The body still round-trips through the codec — the declaration write must not disturb it.
    /// Pushing the body back unchanged leaves the same graph, which is the codec's identity law.</summary>
    [Fact]
    public void A_graphical_body_pushed_back_unchanged_stays_equivalent()
    {
        var doc = PouDocument.Splice(Fbd, "VltFbd", Split(DeclA, BodyOfFixture()));

        var before = PouReader.Parse(Fbd).BodyElement!;
        var after = PouReader.Parse(doc).BodyElement!;
        Assert.Equal("FBD", after.Name.LocalName);
        Assert.Equal(Volt.Engine.Graph.NetworkCode.RenderBody(before),
                     Volt.Engine.Graph.NetworkCode.RenderBody(after));
    }

    /// <summary>DEFECT 5 — an IL body is refused as a LANGUAGE MISMATCH, by the body writer, with a message that
    /// names the language. It used to slip past the graphical-only narrowing as "textual", then get refused two
    /// layers down by a different rule with a different message — the one case handled by accident.</summary>
    [Fact]
    public void An_IL_body_is_refused_as_a_language_mismatch()
    {
        var il = Fbd.Replace("<FBD>", "<IL>").Replace("</FBD>", "</IL>");

        var ex = Assert.Throws<System.InvalidOperationException>(
            () => PouDocument.Splice(il, "VltFbd", Split(DeclA, "n := 1;")));

        Assert.Contains("IL", ex.Message);
    }

    // ── IL is UNSUPPORTED, exactly like CFC and SFC ──────────────────────────────────────────────────
    // Volt writes ST and FBD/LD and nothing else. IL is a TC6 body language, so the READER has to recognise one
    // — but recognising it is not supporting it. It used to have a bespoke codec that decoded to the raw body
    // text, so an IL POU materialized as an editable-looking file indistinguishable from ST source; a push then
    // rewrote the engineer's IL body as ST. It now shares CFC/SFC's treatment: marker on read, refusal on write.

    [Theory]
    [InlineData("IL")]
    [InlineData("CFC")]
    [InlineData("SFC")]
    public void An_unsupported_body_language_is_read_only(string language)
    {
        Assert.True(Volt.Engine.Document.BodyCodec.For(language).ReadOnly);
    }

    [Theory]
    [InlineData("IL")]
    [InlineData("CFC")]
    [InlineData("SFC")]
    public void An_unsupported_body_language_refuses_to_be_written(string language)
    {
        var body = new XElement("body");
        var ex = Assert.Throws<System.InvalidOperationException>(
            () => Volt.Engine.Document.BodyCodec.For(language).Encode(body, "x := 1;", null));
        Assert.Contains("read-only", ex.Message);
    }

    /// <summary>An IL body materializes as the MARKER, not as its raw text — the difference between "Volt shows
    /// you a body it cannot write" and "Volt hands you a file that looks editable and silently converts it".</summary>
    [Fact]
    public void An_IL_body_materializes_as_the_marker_not_as_source()
    {
        var ns = XNamespace.Get("http://www.plcopen.org/xml/tc6_0200");
        var body = new XElement(ns + "body", new XElement(ns + "IL", "LD a\nST b"));
        var found = Volt.Engine.Document.BodyCodec.PresentWith(body);

        Assert.Equal("IL", found!.Value.Codec.Language);
        var decoded = found.Value.Codec.Decode(found.Value.Element);
        Assert.True(Volt.Engine.Vocabulary.BodyMarker.Is(decoded));   // the read-only marker, same as CFC/SFC
        Assert.DoesNotContain("LD a", decoded);        // NOT the raw IL source
    }

    // ── the reader and the writer must agree on WHERE a body lives ─────────────────────────────────
    /// <summary>Only CFC nests under <c>&lt;body&gt;/&lt;addData&gt;</c>; every TC6 language is a direct child.
    /// <para>The reader accepted CFC, SFC, FBD <em>and</em> LD in the nested position while only the CFC codec
    /// ever writes there. A nested SFC/FBD/LD would have been READ as that language and been INVISIBLE to the
    /// writer — whose empty sibling <c>&lt;ST&gt;</c> then counts as uncommitted and gets overwritten, losing the
    /// body. No vendor emits that shape, which is precisely why the disagreement went unnoticed; the rule now
    /// lives once in <c>Languages.NestsInAddData</c> and both halves ask it.</para></summary>
    [Theory]
    [InlineData("CFC", true)]
    [InlineData("SFC", false)]
    [InlineData("FBD", false)]
    [InlineData("LD", false)]
    [InlineData("ST", false)]
    [InlineData("IL", false)]
    public void Only_CFC_nests_in_addData(string language, bool nests)
    {
        Assert.Equal(nests, Volt.Engine.Vocabulary.Languages.NestsInAddData(language));
    }

    /// <summary>Whatever the reader finds nested, the WRITER's codec must own that same position — otherwise a
    /// body is readable and unwritable at once.</summary>
    [Fact]
    public void A_nested_body_the_reader_finds_is_one_the_writer_owns()
    {
        var ns = XNamespace.Get("http://www.plcopen.org/xml/tc6_0200");
        var body = new XElement(ns + "body",
            new XElement(ns + "ST"),
            new XElement(ns + "addData", new XElement(ns + "data", new XElement(ns + "CFC"))));
        var found = Volt.Engine.Document.BodyCodec.PresentWith(body);
        Assert.Equal("CFC", found!.Value.Codec.Language);   // the writer locates it where the reader looks
    }
}
