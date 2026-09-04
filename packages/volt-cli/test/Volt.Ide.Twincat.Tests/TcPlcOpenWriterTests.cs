using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Xml.Linq;
using Volt.Engine.Format.Network;
using Xunit;

namespace Volt.Ide.Twincat.Tests;

/// <summary>
/// PLCopen FBD generation — the ONLY route by which a graphical body Volt holds can become one TwinCAT holds.
///
/// <para><b>Why this exists, and why it is not archive synthesis.</b> <see cref="TcNetworkWriter"/> refuses to
/// create, and its refusal is right: a real <c>BoxTreeBox</c> carries <c>InputParam</c>, <c>OutputParam</c>,
/// <c>CallType</c>, <c>EN</c>, <c>ENO</c> and <c>Id</c>, and those are RESULTS OF THE IDE RESOLVING THE CALL.
/// Volt does not resolve calls. An earlier attempt to build them from a template wrote twenty <c>.TcPOU</c>
/// files TwinCAT could not open. Reflecting over the shipped assemblies does not rescue it either — DIALECT N11
/// measured that the archive is the NWL object graph serialized, but that <c>BoxTreeBox</c>, the type the
/// archive names most often, has no concrete class in any shipped assembly to reflect over.</para>
///
/// <para><b>PLCopen inverts the problem.</b> Volt emits TOPOLOGY — which box, which operand, which wire — and
/// TwinCAT's own importer resolves the rest, producing the very members Volt must not guess. That is Beckhoff's
/// documented route (<c>PlcOpenImport</c>, the one API they document that carries a graphical body) and it is
/// the reason it can work where the archive cannot.</para>
///
/// <para><b>The gates are deliberately different in what they hold fixed.</b>
/// <list type="bullet">
/// <item><b>Format</b> — the vendor's own export is the expected VALUE, and the model is written to describe the
/// POU that export describes. Nothing weaker is honest before writing a vendor format
/// (<c>vendor-serialization-needs-identity-gate</c>). It is hand-built because the two fixtures turned out to be
/// different STATES of one POU — see the test.</item>
/// <item><b>Production</b> — the model a push actually carries is TEXT-derived, and provably cannot hold an
/// operand's type or flags (<c>NetworkTextReader</c> builds <c>new Operand(name)</c>; network text has no syntax
/// for either). A real two-network vendor archive must still lower cleanly through the whole chain.</item>
/// <item><b>Fan-out</b> and <b>LD</b> — the two shapes with their own lowering rules.</item>
/// </list>
/// <b>None of them is the last word.</b> Offline, TwinCAT's importer is not present, and it is the importer that
/// decides whether a document is understood. The definitive gate is the live e2e: import, then pull, and require
/// the wire to have survived.</para>
/// </summary>
public class TcPlcOpenWriterTests
{
    private static string Fixture(string name) => Fixtures.Path("tc-pou", name);

    /// <summary>The whole &lt;NWL&gt; body of a vendor file, exactly as it sits on disk.</summary>
    private static string Body(string fixture) =>
        XDocument.Load(Fixture(fixture), LoadOptions.PreserveWhitespace)
            .Descendants("NWL").Single().ToString(SaveOptions.DisableFormatting);

    private static XElement Impl(string fixture) =>
        XDocument.Load(Fixture(fixture), LoadOptions.PreserveWhitespace)
            .Descendants("NWL").Single()
            .DescendantsAndSelf("o").First(o => (string?)o.Attribute("t") == "NWLImplementationObject");

    /// <summary>The vendor's OWN PLCopen body for the same POU — this is the oracle.</summary>
    private static XElement VendorFbd(string fixture)
    {
        XNamespace tc6 = "http://www.plcopen.org/xml/tc6_0200";
        return XDocument.Load(Fixture(fixture)).Descendants(tc6 + "FBD").Single();
    }

    /// <summary>Compare ignoring insignificant whitespace, so indentation is not the thing under test.</summary>
    private static string Canon(XElement e)
    {
        var c = new XElement(e);
        foreach (var n in c.DescendantNodes().OfType<XText>().ToList())
            if (string.IsNullOrWhiteSpace(n.Value)) n.Remove();
        return c.ToString(SaveOptions.None);
    }

    /// <summary>The same, minus the addData blocks that carry types the IDE RESOLVED. A text-derived model
    /// cannot have these, and this is the only difference the topology gate tolerates.</summary>
    private static string CanonNoResolvedTypes(XElement e)
    {
        var c = new XElement(e);
        foreach (var d in c.Descendants().Where(x => x.Name.LocalName == "data").ToList())
        {
            var n = (string?)d.Attribute("name") ?? "";
            if (n.Contains("inputparamtypes") || n.Contains("outputparamtypes")) d.Remove();
        }
        foreach (var a in c.Descendants().Where(x => x.Name.LocalName == "addData" && !x.HasElements).ToList())
            a.Remove();
        foreach (var n in c.DescendantNodes().OfType<XText>().ToList())
            if (string.IsNullOrWhiteSpace(n.Value)) n.Remove();
        return c.ToString(SaveOptions.None);
    }

    /// <summary>Lower through the PRODUCTION entry point and hand back the body element. Tests go through
    /// `WriteProject` rather than a body-only overload on purpose: an entry point that exists only because a
    /// test calls it is exactly what `NoTestOnlyCodeInSrcTests` exists to catch.</summary>
    private static XElement Lower(NetworkBody model)
    {
        XNamespace tc6 = "http://www.plcopen.org/xml/tc6_0200";
        return TcPlcOpenWriter.WriteProject("P", model)
            .Descendants(tc6 + "body").Single().Elements().Single();
    }

    // -- routing: which door does a push take? ------------------------------------------------------

    /// <summary>WHAT COUNTS AS "THE IDE HAS NO BODY YET" — and the first answer was wrong.
    ///
    /// <para>The obvious test is <c>string.IsNullOrWhiteSpace(existing)</c>, and it never fires. Measured live:
    /// <c>CreateChild</c> with a graphical language mints a COMPLETE, VALID archive — an
    /// <c>NWLImplementationObject</c>, a <c>TypeList</c>, and one <c>Network</c> whose <c>NetworkItems</c> is
    /// empty. So a freshly created POU arrives with a body that is entirely present and entirely blank, the
    /// blankness check missed it, and the create fell through to the archive writer, which refused with
    /// "network 1 changes from 0 to 1 item(s)". <c>EmptyGraphicalShell.TcPOU</c> is that vendor-minted shell,
    /// saved from the live IDE.</para>
    ///
    /// <para>The rule that does hold: a body with NO ITEMS in any network is one the engineer has not drawn, so
    /// creating into it loses nothing. A body with items is edited in place, where every id and every unmodelled
    /// member survives untouched.</para></summary>
    [Fact]
    public void A_vendor_minted_shell_reads_as_having_no_items()
    {
        Assert.True(TcArchive.HasNoItems(Impl("EmptyGraphicalShell.TcPOU")),
            "a freshly created graphical POU must route to the create door");

        Assert.False(TcArchive.HasNoItems(Impl("POU_PBD.TcPOU")),
            "a real FBD body must never be re-created through an import - that would discard its ids");
        Assert.False(TcArchive.HasNoItems(Impl("ladder.TcPOU")),
            "a real ladder body must never be re-created through an import");
    }

    /// <summary>A MODIFIER SURVIVES A CREATE — carried by the SECOND step, not the first.
    ///
    /// <para>This assertion used to be that a modifier is REFUSED, and that was right while PLCopen was the
    /// whole write: a negated contact has no form this lowering knows, so a body carrying one could only be
    /// rejected or silently flattened, and rejecting is the honest half of that pair.</para>
    ///
    /// <para>It is no longer the whole write. The import settles STRUCTURE, and then the in-place archive
    /// writer — which has always known how to write <c>Flags</c> — stamps the VALUES onto the result. So the
    /// modifier does not need a PLCopen form at all, and refusing it would now be refusing something Volt can
    /// do. <b>The danger the old test guarded has not gone away</b>, so this covers the same ground one layer
    /// down: the guarantee is that step two restores what step one could not carry.</para>
    ///
    /// <para>Both halves are real vendor bytes. <c>NegatedContact.derived.TcPOU</c> carries
    /// <c>Flags 1</c> (Negation) and <c>SetCoil.derived.TcPOU</c> carries <c>Flags 2</c> (Set); zeroing them
    /// produces exactly what a fresh import hands back — the right shape, no modifiers — and the model is the
    /// TEXT-derived one a push actually carries.</para></summary>
    [Theory]
    [InlineData("NegatedContact.derived.TcPOU", 1)]
    [InlineData("SetCoil.derived.TcPOU", 2)]
    [InlineData("ResetCoil.derived.TcPOU", 3)]     // Negation|Set - the vendor's spelling of a RESET coil
    public void A_modifier_the_import_cannot_carry_is_restored_by_the_archive_write(string fixture, int flag)
    {
        var vendor = Body(fixture);
        Assert.Contains($"<v n=\"Flags\">{flag}</v>", vendor);

        // What a fresh PLCopen import hands back: the right structure, every modifier absent.
        var imported = vendor.Replace($"<v n=\"Flags\">{flag}</v>", "<v n=\"Flags\">0</v>");
        Assert.DoesNotContain($"<v n=\"Flags\">{flag}</v>", imported);

        // The model a push carries - round-tripped through network text, so it holds only what the text holds.
        var pulled = TcNetworkReader.Read(Impl(fixture), BodyLanguage.Ld);
        var model = NetworkTextGate.Validate(NetworkTextWriter.Write(pulled));

        var stamped = TcNetworkWriter.Apply(imported, model);

        Assert.NotNull(stamped);
        Assert.Contains($"<v n=\"Flags\">{flag}</v>", stamped);
    }

    // -- the gates ---------------------------------------------------------------------------------

    /// <summary>THE FORMAT GATE — the vendor's own bytes are the expected value.
    ///
    /// <para><b>The model here is hand-built, and that is a correction rather than a convenience.</b> The
    /// obvious move is to read <c>POU_PBD.TcPOU</c> and compare against <c>POU_PBD.plcopen.xml</c>, and it is
    /// wrong: <b>the two fixtures are different states of the same POU</b> — the archive holds TWO networks of
    /// one <c>BoxTreeBox</c> each, the PLCopen export holds ONE block. They were captured at different moments,
    /// so pairing them would have asserted a coincidence. Measured, not assumed.</para>
    ///
    /// <para>So the input is a model written to describe the POU the vendor's export actually describes, and the
    /// expected value is that export, untouched. What is under test is the WRITER'S FORMAT FIDELITY: element
    /// names, nesting, the <c>localId</c> scheme, the attribute marker, <c>formalParameter</c> numbering and the
    /// call-type <c>addData</c>.</para>
    ///
    /// <para>The resolved-signature <c>addData</c> is excluded from both sides, and it is the single documented
    /// exclusion: <c>OutputParam.Types</c> is the COMPILER's answer (the fixture's <c>AND</c> carries
    /// <c>["BOOL"]</c> there while its <c>OutputItems</c> is empty — a signature, not a wiring). Volt models no
    /// resolved signature, so the writer omits the block rather than guessing, and the IDE re-derives it on
    /// import. Guessing there would be the same class of error as building the archive.</para></summary>
    [Fact]
    public void Reproduces_the_vendors_own_FBD_export()
    {
        // `out := FALSE AND FALSE`, unassigned - exactly the one network POU_PBD.plcopen.xml holds.
        var model = new NetworkBody(BodyLanguage.Fbd, new[]
        {
            new Network(0, null, null, null, false, new Node[]
            {
                new Box("AND", null, CallKind.Operator,
                    new[]
                    {
                        new Input(null, new Leaf(new Operand("FALSE"), Flags.None), Flags.None),
                        new Input(null, new Leaf(new Operand("FALSE"), Flags.None), Flags.None),
                    },
                    Array.Empty<Output>(), null, null, Flags.None),
            }),
        });

        var written = Lower(model);

        Assert.Equal(CanonNoResolvedTypes(VendorFbd("POU_PBD.plcopen.xml")), CanonNoResolvedTypes(written));
    }

    /// <summary>THE PRODUCTION GATE. The model a push actually carries is TEXT-derived, which provably cannot
    /// hold an operand's type or flags, and it must still lower cleanly. Driving a real two-network vendor
    /// archive through the whole pull-then-push chain is what production does on every push.</summary>
    [Fact]
    public void The_text_derived_model_of_a_real_archive_lowers()
    {
        var pulled = TcNetworkReader.Read(Impl("POU_PBD.TcPOU"), BodyLanguage.Fbd);
        var model = NetworkTextGate.Validate(NetworkTextWriter.Write(pulled));

        var written = Lower(model);

        // Two networks, each a whole AND box with its two operands, in the vendor's per-network id space.
        Assert.Equal(2, written.Elements().Count(e => e.Name.LocalName == "block"));
        Assert.Equal(4, written.Elements().Count(e => e.Name.LocalName == "inVariable"));

        // EXACTLY ONE attribute marker for the whole body. This assertion used to demand one PER NETWORK, which
        // was the guess the code made and the test copied — a test agreeing with the code proves nothing. The
        // live importer settled it: a second marker came back as a real network item, rendering on the next pull
        // as a box called `FBD Implementation Attributes()`, so the body could be created and never pushed back.
        Assert.Single(written.Elements(), e => e.Name.LocalName == "vendorElement");

        var ids = written.Elements().Select(e => long.Parse(e.Attribute("localId")!.Value)).ToList();
        Assert.Equal(ids.Count, ids.Distinct().Count());
        Assert.Equal(4, ids.Count(i => i / 10_000_000_000L == 1));   // marker + network 0's three elements
        Assert.Equal(3, ids.Count(i => i / 10_000_000_000L == 2));   // network 1's three, no marker of its own
    }

    /// <summary>A LADDER IS LOWERED AS <c>&lt;FBD&gt;</c>, AND ITS LADDER-NESS IS A VIEW WRITTEN AFTERWARDS.
    ///
    /// <para>This used to demand an <c>&lt;LD&gt;</c> element, which reads as obviously right and is wrong.
    /// Measured live: importing an <c>&lt;LD&gt;</c> whose children are FBD-shaped
    /// (<c>block</c>/<c>inVariable</c>/<c>outVariable</c>) makes TwinCAT's importer throw — "Creation of object
    /// 'X' failed. Reason: Object reference not set to an instance of an object." PLCopen ladder is a different
    /// vocabulary entirely: power rails, contacts, coils.</para>
    ///
    /// <para>Volt does not need that vocabulary, because the vendor does not treat a ladder as a different
    /// program. FBD, LD and IL are three VIEWS of ONE network; <c>GraphReader</c> already lowers contacts and
    /// coils into the same boolean node graph an FBD network uses, and DIALECT C6 records that
    /// <c>CreateChild</c> cannot make an "LD" at all — it makes an FBD and the ladder view rides along as
    /// <c>DefaultViewMode</c> in the NWL archive. So the graph goes in as FBD, the one shape the importer is
    /// proven to accept, and the view is set on the archive afterwards. One lowering, not two.</para></summary>
    [Fact]
    public void A_ladder_body_is_lowered_as_FBD_because_ladder_ness_is_a_view()
    {
        var model = TcNetworkReader.Read(Impl("ladder.TcPOU"), BodyLanguage.Ld);

        var written = Lower(model);

        Assert.Equal("FBD", written.Name.LocalName);
    }

    /// <summary>…and the VIEW is what makes it a ladder again. A created archive says <c>"Fbd"</c> — that is all
    /// <c>CreateChild</c> can make — so without this write an engineer who pushed a ladder would open the IDE
    /// and find a function-block diagram instead.</summary>
    [Fact]
    public void The_ladder_view_is_written_onto_the_archive()
    {
        var shell = Body("EmptyGraphicalShell.TcPOU");
        Assert.Equal("Fbd", TcArchive.ViewMode(Impl("EmptyGraphicalShell.TcPOU")));

        var asLadder = TcArchive.WithViewMode(shell, "Ld");

        Assert.NotNull(asLadder);
        Assert.Equal("Ld", TcArchive.ViewMode(TcArchive.Root(asLadder)!));

        // …and a no-op when the archive already says so, so an FBD push never rewrites a body for nothing.
        Assert.Null(TcArchive.WithViewMode(asLadder!, "Ld"));
    }

    /// <summary>FAN-OUT IS A SHARED <c>refLocalId</c>, not a repeated producer. This is the shape that has no
    /// valid FBD form when duplicated, and PLCopen expresses it natively — several connections naming one
    /// localId — so a Demux must lower to exactly that.</summary>
    [Fact]
    public void A_wire_feeding_two_consumers_becomes_one_shared_refLocalId()
    {
        // The gate is handed the BODY only - everything from the first NETWORK marker on - not a whole POU.
        var model = NetworkTextGate.Validate(
            "NETWORK 0 FBD\n  LET g7 := (a AND b);\n  out1 := g7;\n  out2 := g7;\nEND_NETWORK\n");

        var written = Lower(model);

        // Both outVariables must reference THE SAME producer, and that producer is the AND block.
        var outs = written.Descendants().Where(e => e.Name.LocalName == "outVariable").ToList();
        Assert.Equal(2, outs.Count);
        var refs = outs.Select(o => o.Descendants().First(c => c.Name.LocalName == "connection")
                                     .Attribute("refLocalId")!.Value).Distinct().ToList();
        Assert.Single(refs);

        var block = written.Descendants().Single(e => e.Name.LocalName == "block");
        Assert.Equal(refs[0], block.Attribute("localId")!.Value);
    }
}
