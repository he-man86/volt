using System.Collections.Generic;
using System.Linq;
using System.Xml.Linq;
using Volt.Engine.Format.Body;
using Volt.Engine.Format.Network;
using Xunit;

namespace Volt.Ide.Twincat.Tests;

/// <summary>
/// A FAN-OUT WIRE, FROM REAL VENDOR BYTES — the first <c>BoxTreeDemux</c> this repo has held.
///
/// <para><c>fixtures/tc-pou/ladder-demux.TcPOU</c> was DRAWN BY HAND in XAE's ladder editor: a contact whose
/// output BRANCHES, one path into an OR box and the other to a second coil. Before it, three of the six node
/// types had no committed sample at all and `VarId`/`Input`/`Trees` were read against shapes nothing
/// demonstrated — which is what <c>VendorMemberNamesExistTests</c> exists to say out loud.</para>
///
/// <para><b>The create path cannot reach this shape, and that is the point.</b> Pushed through the PLCopen
/// importer the same fan-out comes back as ONE <c>BoxTreeAssign</c> carrying TWO <c>OutputItems</c> — measured
/// on a live XAE — so the importer spells a shared wire as a multi-target assign and only the EDITOR builds a
/// Demux. A measurement of the importer is not a measurement of the vendor, and this fixture is the difference.</para>
///
/// <para>Network text spells a fan-out as a wire declared in its network's <c>VAR_TEMP</c> block plus its uses, and
/// the writer declares one for nothing else — so the rendering below is itself evidence that the reader took the
/// Demux path.</para>
/// </summary>
public class TcDemuxTests
{
    private static string Body() =>
        XDocument.Parse(Fixtures.Pou("ladder-demux.TcPOU"), LoadOptions.PreserveWhitespace)
            .Descendants("NWL").Single().ToString(SaveOptions.DisableFormatting);

    private static NetworkBody Read() =>
        TcNetworkReader.Read(
            XElement.Parse(Body(), LoadOptions.PreserveWhitespace)
                .DescendantsAndSelf("o").First(o => (string?)o.Attribute("t") == "NWLImplementationObject"),
            BodyLanguage.Ld);

    [Fact]
    public void The_archive_really_holds_a_demux()
    {
        // The premise. Without it every assertion here would pass against a body that has no fan-out at all.
        Assert.Contains("BoxTreeDemux", Fixtures.Pou("ladder-demux.TcPOU"));
    }

    /// <summary>ONE DEFINITION, AND THE REFERENCES CARRY THE SAME ID.
    ///
    /// <para>That pairing is the whole mechanism: a <c>Demux</c> WITH an <c>Input</c> defines the wire, and one
    /// with a null <c>Input</c> references the definition sharing its <c>VarId</c>. Reading the id from the wrong
    /// member, or dropping the null-input case, would leave the references pointing nowhere — which is how 573
    /// of these in one real project once rendered as <c>out := ( AND b);</c> with the wire silently gone.</para></summary>
    [Fact]
    public void The_definition_carries_the_wire_and_the_references_share_its_id()
    {
        var demuxes = Read().Networks.SelectMany(n => n.Trees).SelectMany(Flatten).OfType<Demux>().ToList();

        Assert.NotEmpty(demuxes);
        var definitions = demuxes.Where(d => d.Input is not null).ToList();
        var references = demuxes.Where(d => d.Input is null).ToList();

        Assert.NotEmpty(definitions);
        Assert.NotEmpty(references);
        foreach (var r in references)
            Assert.Contains(definitions, d => d.VarId == r.VarId);
    }

    /// <summary>THE SLOT A CONSUMER READS, from the archive (task 3.10). The archive serializes no
    /// <c>MainOutputIndex</c>; the connected output is the one slot stored NULL, as the CODESYS census found beside the
    /// index (DIALECT N16). The hand-drawn TON read by its coil holds <c>[null, ""]</c> — <c>Q</c> connected, <c>ET</c>
    /// unwired — and an AND box, which stores no main output, is connected by none.</summary>
    [Fact]
    public void A_consumed_box_records_the_slot_its_consumer_reads()
    {
        var boxes = Read().Networks.SelectMany(n => n.Trees).SelectMany(Flatten).OfType<Box>().ToList();

        var ton = boxes.First(b => b.Type == "TON");
        Assert.Equal((0, 0, false), (ton.ConnectedSlot, ton.MainOutputIndex, ton.HasEnoOutput));
        var and = boxes.First(b => b.Type == "AND");
        Assert.Equal((null, null), (and.ConnectedSlot, and.MainOutputIndex));
    }

    /// <summary>...and it renders as the format's own spelling for a fan-out: the wire declared in its network's
    /// <c>VAR_TEMP</c> block, typed off its producer (a ladder leaf every use of which is a contact is BOOL), defined
    /// by an assignment and referenced by name.</summary>
    [Fact]
    public void It_materializes_as_a_named_wire_and_its_uses()
    {
        var text = TcText.Write(Read());

        Assert.Contains("  VAR_TEMP g1 : BOOL; END_VAR\n  g1 := b;\n", text);
        Assert.Contains("out2 := g1;", text);          // one consumer
        Assert.Contains("(a OR g1)", text);            // ...and the other, inside the OR box
    }

    /// <summary>A NO-OP PUSH MUST NOT REWRITE IT — the rule every other fixture is held to, now over a node type
    /// that had never been exercised against real bytes.</summary>
    [Fact]
    public void A_push_of_the_unchanged_body_writes_nothing()
    {
        Assert.Null(TcText.Apply(Body(), TcText.Validate(TcText.Write(Read()), TcText.ScopeOf(Read()))));
    }

    private static IEnumerable<Node> Flatten(Node n)
    {
        yield return n;
        switch (n)
        {
            case Box b:
                foreach (var i in b.Inputs) foreach (var c in Flatten(i.Value)) yield return c;
                if (b.Enable is { } en) foreach (var c in Flatten(en)) yield return c;
                break;
            case Assign a:
                foreach (var c in Flatten(a.Value)) yield return c;
                break;
            case Volt.Engine.Format.Network.Parallel p:
                if (p.Input is { } pi) foreach (var c in Flatten(pi)) yield return c;
                foreach (var br in p.Branches) foreach (var c in Flatten(br)) yield return c;
                break;
            case Demux d when d.Input is { } di:
                foreach (var c in Flatten(di)) yield return c;
                break;
        }
    }
}
