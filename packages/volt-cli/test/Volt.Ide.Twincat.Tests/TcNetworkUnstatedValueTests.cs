using System;
using System.Linq;
using System.Xml.Linq;
using Volt.Engine;
using Volt.Engine.Format.Body;
using Volt.Engine.Format.Network;
using Xunit;

namespace Volt.Ide.Twincat.Tests;

/// <summary>
/// A NETWORK MEMBER THE ARCHIVE DOES NOT HOLD IS REFUSED BY NAME, NEVER READ AS A DEFAULT (zero-fallback policy, owner
/// 2026-10-23) — the network-body twin of <see cref="TcUnansweredValueTests"/>.
///
/// <para>The accessors <c>TcArchive.Str</c>/<c>Bool</c>/<c>Int</c>/<c>FlagBits</c> answer an ABSENT member as
/// null / false / 0 — the same answer as the IDE writing <c>""</c>, <c>false</c> or <c>0</c>. Every member below is one
/// TwinCAT writes on EVERY object of its class (census 2026-10-28 over the TwinCAT archives under <c>test/</c>: the native
/// corpus, <c>nwl-corpus/twincat-project14</c>, the e2e projects and the drawn <c>tc-pou</c> fixtures — 207 boxes, 201
/// networks, 940 operands, 26 wires, 5 Execute lines), so its absence is no shape the IDE wrote: a box with no
/// <c>BoxType</c> read as a call to <c>""</c>, an operand with no text as an unwired pin, a network with no
/// <c>OutCommented</c> as enabled, a wire with no <c>VarId</c> as wire 0, a target with no <c>Flags</c> as a plain coil.</para>
///
/// <para>The values the IDE DOES write are read exactly: <c>""</c> stays <c>""</c> (an unwired pin, a network with no
/// title), the explicit null <c>&lt;n n="Operand" /&gt;</c> is an Instance's "no instance" and nothing else's.</para>
/// </summary>
public class TcNetworkUnstatedValueTests
{
    private static XElement Impl(string fixture)
    {
        var doc = XDocument.Load(Fixtures.Path("tc-pou", fixture), LoadOptions.PreserveWhitespace);
        return doc.Descendants("NWL").Single()
            .DescendantsAndSelf("o").First(o => (string?)o.Attribute("t") == "NWLImplementationObject");
    }

    private static bool Named(XElement e, string n) => (string?)e.Attribute("n") == n;

    /// <summary>The first object of archive class <paramref name="cls"/> (<c>Operand</c> means a contact's — the operand a
    /// <c>BoxTreeOperand</c> holds — so the pin, not a box's instance, is what loses its member).</summary>
    private static XElement First(XElement impl, string cls) =>
        cls == "Operand"
            ? impl.Descendants("o").First(o => Named(o, "Operand") && TcArchive.TypeOf(o.Parent!) == "BoxTreeOperand")
            : impl.Descendants("o").First(o => TcArchive.TypeOf(o) == cls);

    private static XElement Member(XElement owner, string name) => owner.Elements().Single(m => Named(m, name));

    /// <summary>Removing <paramref name="member"/> from the first <paramref name="cls"/> of a body TwinCAT drew makes the
    /// pull refuse, naming the member — before the fix each read as the default named in the class summary.</summary>
    [Theory]
    [InlineData("ladder-demux.TcPOU", "Network", "Title")]
    [InlineData("ladder-demux.TcPOU", "Network", "Label")]
    [InlineData("ladder-demux.TcPOU", "Network", "Comment")]
    [InlineData("ladder-demux.TcPOU", "Network", "OutCommented")]
    [InlineData("ladder-demux.TcPOU", "BoxTreeDemux", "VarId")]
    [InlineData("ladder-demux.TcPOU", "BoxTreeBox", "BoxType")]
    [InlineData("ladder-demux.TcPOU", "BoxTreeBox", "CallType")]
    [InlineData("ladder-demux.TcPOU", "BoxTreeBox", "ProvidesSTSnippet")]
    [InlineData("ladder-demux.TcPOU", "BoxTreeBox", "Flags")]
    [InlineData("ladder-demux.TcPOU", "BoxTreeAssign", "Flags")]
    [InlineData("ladder-demux.TcPOU", "BoxTreeOperand", "Operand")]
    [InlineData("ladder-demux.TcPOU", "Operand", "Operand")]
    [InlineData("ladder-demux.TcPOU", "Operand", "Type")]
    [InlineData("ladder-demux.TcPOU", "Operand", "SymbolComment")]
    [InlineData("ladder-demux.TcPOU", "Operand", "IsInstance")]
    [InlineData("ladder-demux.TcPOU", "Operand", "LValue")]
    [InlineData("ladder-demux.TcPOU", "Operand", "Flags")]
    [InlineData("execute-box.TcPOU", "TextLine", "Text")]
    [InlineData("execute-box.TcPOU", "TextDocument", "TextLines")]
    public void A_member_TwinCAT_writes_on_every_object_is_refused_by_name_when_absent(string fixture, string cls, string member)
    {
        var impl = Impl(fixture);
        Assert.NotNull(TcNetworkReader.Read(impl, BodyLanguage.Ld));   // the drawn body reads as it is
        Member(First(impl, cls), member).Remove();

        var ex = Assert.Throws<UnsupportedException>(() => TcNetworkReader.Read(impl, BodyLanguage.Ld));
        Assert.Contains($"'{member}'", ex.Message);
    }

    /// <summary>A terminator's <c>Flags</c> (drawn-refused-shapes.TcPOU, the hand-drawn terminator) — read as 0 when absent.</summary>
    [Fact]
    public void A_terminator_with_no_Flags_is_refused_by_name()
    {
        var impl = Impl("drawn-refused-shapes.TcPOU");
        Assert.NotNull(TcNetworkReader.ReadShown(impl, BodyLanguage.Ld));
        Member(First(impl, "BoxTreeTerminator"), "Flags").Remove();

        var ex = Assert.Throws<UnsupportedException>(() => TcNetworkReader.ReadShown(impl, BodyLanguage.Ld));
        Assert.Contains("'Flags'", ex.Message);
    }

    /// <summary>A pin's operand text held as the explicit null — the spelling of an Instance's "no instance" (174 of 174
    /// unnamed instances), never of a pin's (0 of 766: <c>""</c> or a name) — is refused, not read as an unwired pin.</summary>
    [Fact]
    public void A_contacts_operand_text_written_as_the_explicit_null_is_refused()
    {
        var impl = Impl("ladder-demux.TcPOU");
        Member(First(impl, "Operand"), "Operand").ReplaceWith(new XElement("n", new XAttribute("n", "Operand")));

        var ex = Assert.Throws<UnsupportedException>(() => TcNetworkReader.Read(impl, BodyLanguage.Ld));
        Assert.Contains("'Operand'", ex.Message);
    }

    [Theory]
    [InlineData("BoxTreeDemux", "VarId", "x")]
    [InlineData("BoxTreeBox", "ProvidesSTSnippet", "yes")]
    [InlineData("Network", "OutCommented", "")]
    public void A_scalar_TwinCAT_does_not_write_is_refused_not_read_as_a_default(string cls, string member, string raw)
    {
        var impl = Impl("ladder-demux.TcPOU");
        Member(First(impl, cls), member).Value = raw;

        var ex = Assert.Throws<UnsupportedException>(() => TcNetworkReader.Read(impl, BodyLanguage.Ld));
        Assert.Contains($"'{member}'", ex.Message);
    }

    /// <summary>Every box TwinCAT wrote names its type (207 of 207); an empty one is a call to nothing.</summary>
    [Fact]
    public void A_box_whose_type_is_empty_is_refused()
    {
        var impl = Impl("ladder-demux.TcPOU");
        Member(First(impl, "BoxTreeBox"), "BoxType").Value = "\"\"";

        var ex = Assert.Throws<UnsupportedException>(() => TcNetworkReader.Read(impl, BodyLanguage.Ld));
        Assert.Contains("'BoxType'", ex.Message);
    }

    /// <summary>What the IDE writes is read exactly, the empty string included: the importer's unwired pin is an operand
    /// holding <c>""</c> (Vn_ton_unwired), read as the empty terminator; a network with no title holds <c>""</c>.</summary>
    [Fact]
    public void The_empty_values_TwinCAT_writes_still_read()
    {
        var body = TcNetworkReader.Read(Impl("importer-unwired.TcPOU"), BodyLanguage.Fbd);
        Assert.Contains(body.Networks.SelectMany(n => n.Trees).SelectMany(Descend), n => n is Terminator);
        Assert.All(body.Networks, n => Assert.Null(n.Title));
    }

    private static System.Collections.Generic.IEnumerable<Node> Descend(Node n) => n.Children().SelectMany(Descend).Prepend(n);
}
