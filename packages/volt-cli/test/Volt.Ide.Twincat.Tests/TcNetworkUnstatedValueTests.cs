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
/// networks, 940 operands, 26 wires, 10 Execute ST lines), so its absence is no shape the IDE wrote: a box with no
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
    /// holding <c>""</c> (Vn_ton_unwired), read as the empty operand CODESYS reads, never the rail; a network with no
    /// title holds <c>""</c>.</summary>
    [Fact]
    public void The_empty_values_TwinCAT_writes_still_read()
    {
        var body = TcNetworkReader.Read(Impl("importer-unwired.TcPOU"), BodyLanguage.Fbd);
        var nodes = body.Networks.SelectMany(n => n.Trees).SelectMany(Descend).ToList();
        Assert.Contains(nodes, n => n is Leaf { Operand.Text.Length: 0 });
        Assert.DoesNotContain(nodes, n => n is Terminator);
        Assert.All(body.Networks, n => Assert.Null(n.Title));
    }

    /// <summary>AN UNWIRED FB INPUT PULLS AS THE PIN LEFT OUT (network-text-one-to-one finding 1): it was read as the rail
    /// and written <c>t1(IN := TRUE, PT := TRUE);</c> (TRUE on a TIME pin, which an edited push would write back).</summary>
    [Fact]
    public void An_unwired_FB_input_pulls_as_the_pin_left_out()
    {
        var nwl = XElement.Load(System.IO.Path.Combine(TcNativeCorpusTests.Dir, "import", "Vn_ton_unwired.nwl.xml"));
        var impl = nwl.DescendantsAndSelf("o").First(o => (string?)o.Attribute("t") == "NWLImplementationObject");
        var body = TcNetworkReader.Read(impl, BodyLanguage.Fbd);
        var text = StNetworkWriter.WritePulled(body, Volt.Tests.Shared.StNetworkOracle.InstancesOf(body));
        Assert.Contains("t1();", text);
        Assert.DoesNotContain("TRUE", text);
    }

    private static System.Collections.Generic.IEnumerable<Node> Descend(Node n) => n.Children().SelectMany(Descend).Prepend(n);

    /// <summary>A BOX SHOWING EN WITH NO INPUT ITEM TO BE THE ENABLE is refused, not read as a box with no enable: the
    /// reader took <c>items.Count == 0 ? null</c>, so the shown EN — and the rung it stands on — vanished from the text.
    /// Every box that shows EN holds its enable in input slot 0 (execute-box.TcPOU's, every enabled corpus box).</summary>
    [Fact]
    public void A_box_showing_EN_with_no_input_item_is_refused_not_read_as_unenabled()
    {
        var impl = Impl("execute-box.TcPOU");
        var box = impl.Descendants("o").First(o => TcArchive.TypeOf(o) == "BoxTreeBox" && o.Elements("v").Any(v => Named(v, "EN") && v.Value == "true"));
        box.Elements("l2").Single(l => Named(l, "InputItems")).RemoveNodes();

        var ex = Assert.Throws<UnrepresentableBodyException>(() => TcNetworkReader.Read(impl, BodyLanguage.Fbd));
        Assert.Equal(Box.ShownWithoutSlotMarker, ex.Reason);
    }

    // ── the in-place writer ──────────────────────────────────────────────────────────────────────

    private static string Body(string fixture) =>
        XDocument.Load(Fixtures.Path("tc-pou", fixture), LoadOptions.PreserveWhitespace)
            .Descendants("NWL").Single().ToString(SaveOptions.DisableFormatting);

    private static NetworkBody Pulled(string body) =>
        TcNetworkReader.Read(XElement.Parse(body, LoadOptions.PreserveWhitespace)
            .DescendantsAndSelf("o").First(o => (string?)o.Attribute("t") == "NWLImplementationObject"), BodyLanguage.Fbd);

    private static Node WithPin(Node n, Func<Box, Box> edit) => n switch
    {
        Box b when b.Instance is not null => edit(b),
        Box b => b with { Inputs = b.Inputs.Select(i => i with { Value = WithPin(i.Value, edit) }).ToList() },
        Assign a => a with { Value = WithPin(a.Value, edit) },
        _ => n,
    };

    /// <summary>A PIN THE IDE NAMES, PUSHED POSITIONAL, IS REFUSED — NEVER RENAMED <c>""</c>. The TON of FbCall names its pins
    /// <c>IN</c> and <c>PT</c>; a push naming <c>IN</c> and leaving the second pin positional wrote <c>Formal ?? ""</c> over
    /// <c>PT</c> — the IDE's name blanked, no refusal. The all-positional case was already refused naming the pin (the
    /// writer's own rule: "a name the IDE holds is the IDE's"); the mixed case now follows it.</summary>
    [Fact]
    public void A_named_pin_pushed_positional_beside_a_named_one_is_refused_not_blanked()
    {
        var body = Body("FbCall.derived.TcPOU");
        var pulled = Pulled(body);
        var model = pulled with
        {
            Networks = pulled.Networks.Select(n => n with
            {
                Trees = n.Trees.Select(t => WithPin(t, b => b with
                {
                    Inputs = b.Inputs.Select((p, i) => i == 1 ? p with { Formal = null } : p).ToList(),
                })).ToList(),
            }).ToList(),
        };

        var ex = Assert.Throws<UnsupportedException>(() => TcNetworkWriter.Apply(body, model, TcText.ScopeOf(pulled)));
        Assert.Contains("'PT'", ex.Message);
    }

    /// <summary>A <c>TypeList</c> entry with no name is no entry TwinCAT writes (every <c>&lt;Type&gt;</c> it lists carries
    /// <c>n</c>). Read as the type <c>""</c>, the IDE's GUID for the type it really lists was dropped and the TABLE's put in
    /// its place on the next structural edit — refused instead, naming the list.</summary>
    [Fact]
    public void A_TypeList_entry_with_no_name_is_refused_on_a_structural_edit()
    {
        var doc = XDocument.Load(Fixtures.Path("tc-pou", "ladder-demux.TcPOU"), LoadOptions.PreserveWhitespace);
        var nwl = doc.Descendants("NWL").Single();
        nwl.Descendants("TypeList").Single().Elements("Type").First().Attribute("n")!.Remove();
        var body = nwl.ToString(SaveOptions.DisableFormatting);
        var pulled = Pulled(body);
        // A structural edit: a network appended, which the builder builds and the TypeList must follow.
        var extra = new Network(pulled.Networks.Count, null, null, null, false,
            new Node[] { new Assign(new Leaf(new Operand("a"), Flags.None), new[] { new Operand("b", IsLValue: true) }, Flags.None) });
        var model = pulled with { Networks = pulled.Networks.Append(extra).ToList() };

        var ex = Assert.Throws<UnsupportedException>(() =>
            TcNetworkWriter.Apply(body, model, TcText.ScopeOf(model), TcArchiveBuilder.NetworkGraph));
        Assert.Contains("TypeList", ex.Message);
    }
}
