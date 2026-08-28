using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Xml.Linq;
using Volt.Engine.Format.Network;
using Xunit;
using Xunit.Abstractions;

namespace Volt.Cli.Tests;

/// <summary>
/// What REGENERATION costs, measured against the vendor's own artifact — and ratcheted so it only shrinks.
///
/// <para>Every other graphical assertion in this repo compares a fetch to a later fetch. That is a FIXED-POINT
/// check, and a fixed point is what each of these bugs turned out to be: the write dropped something, the read
/// handed back the reduced body, and pushing that back changed nothing. `GraphRoundTrip.Once` is literally
/// reader-over-writer, so whatever the writer omits the reader never sees.</para>
///
/// <para>The comparison that CAN see it is stored-vs-regenerated: the vendor's element against the one Volt
/// builds from its own network text. That is what this does, on the 9 RECORDED vendor exports — the hand-authored
/// `roundtrip/*` fixtures are excluded, because a fixture written by a test author cannot testify about what a
/// vendor emits.</para>
///
/// <para><b>Why a ratchet rather than a green/red assertion.</b> This is RED on every fixture today and will be
/// until §2's defects land — an assertion that simply fails carries no information and gets disabled. So the
/// current losses are committed as a BASELINE and the gate is that the set only ever gets smaller. A defect fix
/// shows up as entries disappearing; a regression shows up as an entry nobody approved. The baseline cannot be
/// grown to make a failure go away without that being the whole of the diff.</para>
///
/// <para><b>This measures regeneration, not the push.</b> Since the body-level no-op landed, pushing back the
/// text a pull produced does not touch the stored XML at all, so a push-shaped test here would be vacuously
/// green — it would assert that Volt left the document alone, which is true and is not what is under test. What
/// is under test is what happens when a body IS rewritten, which is what an EDITED body still gets.</para>
/// </summary>
public class StoredVsPushedTests
{
    private readonly ITestOutputHelper _out;
    public StoredVsPushedTests(ITestOutputHelper o) => _out = o;

    /// <summary>Per fixture: the census entries regeneration currently DESTROYS. Ratchet — may only shrink.
    /// <para>Each key is a recorded vendor export; each value is what its stored body carries and the regenerated
    /// one does not, as <c>element</c> or <c>element/@attribute</c> with the count lost.</para></summary>
    private static readonly Dictionary<string, string[]> KnownLoss = new(StringComparer.OrdinalIgnoreCase)
    {
        // MEASURED, not estimated — this is what the first run reported, and every entry corresponds to a
        // finding in `body-census.md`. Four clusters:
        //
        //   `fbdattributes` + its addData/data/attribute/alternativeText/xhtml wrapper — the FBD editor's
        //   vendorElement, present in all 7 recorded FBD exports on BOTH vendors, read as an OpaqueNode and then
        //   deliberately unspellable in network text, so a rewrite deletes it.
        //
        //   `comment` + content/xhtml/position — every recorded comment box, all 6 of them, because the reader
        //   keeps only comment text of non-zero length and every recorded box is empty. A box the engineer
        //   placed is content. (tasks.md §2.2)
        //
        //   `contact` + its rail `connection`/`connectionPointIn` — the LD contact demoted to a floating data
        //   box, measured on ld_ton_rung_two_networks. The one loss that changes the shape of the rung a ladder
        //   engineer reads. (tasks.md §2.1)
        //
        //   `position` — all (0,0) in every recorded export on both vendors, and GraphWriter synthesizes
        //   y=row*40 rather than carrying them. There is no layout in this transport to lose; the entry is here
        //   because the census counts what moved, not what mattered.
        //
        // NOT here, and it is the highest-stakes gap: `executionOrderId`. It is execution semantics and XSD-legal
        // on FBD/LD elements, and NO recorded fixture carries one — so this table is silent about it rather than
        // clearing it. See U1.
        ["fbd_en_eno.plcopen.xml"] = new[] { "addData x1", "alternativeText x1", "attribute x1", "attribute/@name x1", "attribute/@value x1", "data x1", "data/@handleUnknown x1", "data/@name x1", "fbdattributes x1", "vendorElement x1", "vendorElement/@localId x1", "xhtml x1" },
        ["fbd_ton_embedded_output.plcopen.xml"] = new[] { "addData x1", "alternativeText x1", "attribute x1", "attribute/@name x1", "attribute/@value x1", "data x1", "data/@handleUnknown x1", "data/@name x1", "fbdattributes x1", "vendorElement x1", "vendorElement/@localId x1", "xhtml x1" },
        ["ld_four_networks_shared_rails.plcopen.xml"] = new[] { "comment x4", "comment/@height x4", "comment/@localId x4", "comment/@width x4", "content x4", "position x4", "position/@x x4", "position/@y x4", "xhtml x4" },
        ["ld_ton_rung_two_networks.plcopen.xml"] = new[] { "comment x2", "comment/@height x2", "comment/@localId x2", "comment/@width x2", "connection x1", "connection/@refLocalId x1", "connectionPointIn x1", "contact x1", "contact/@edge x1", "contact/@localId x1", "contact/@negated x1", "contact/@storage x1", "content x2", "position x2", "position/@x x2", "position/@y x2", "variable x1", "xhtml x2" },
        ["PLC_PRG.plcopen.xml"] = new[] { "addData x1", "alternativeText x1", "attribute x1", "attribute/@name x1", "attribute/@value x1", "data x1", "data/@handleUnknown x1", "data/@name x1", "fbdattributes x1", "position x1", "position/@x x1", "position/@y x1", "vendorElement x1", "vendorElement/@localId x1", "xhtml x1" },
        ["PLC_PRG_jump_sr.plcopen.xml"] = new[] { "addData x1", "alternativeText x1", "attribute x1", "attribute/@name x1", "attribute/@value x1", "data x1", "data/@handleUnknown x1", "data/@name x1", "fbdattributes x1", "position x1", "position/@x x1", "position/@y x1", "vendorElement x1", "vendorElement/@localId x1", "xhtml x1" },
        // POU_PBD IS NOT A DECORATION LOSS LIKE THE OTHERS — it loses the whole network, and the reason is a
        // modelling gap worth stating plainly. Its single network is `FALSE AND FALSE` into an AND block whose
        // `Out1` is UNCONSUMED: no outVariable, no assignment. Network text is assignment-oriented, so
        // `RenderBody` produces exactly:
        //
        //     NETWORK 1 FBD
        //     END_NETWORK
        //
        // …an EMPTY network. Regeneration from that text therefore writes nothing, which is why this baseline
        // lists the block, the inVariables, the connections and the variables rather than just vendor addData.
        //
        // MEASURED, both directions:
        //   - PUSH is safe. The production path passes the <body> element, `RenderBody(existing) == text`, and
        //     the no-op short-circuit in NetworkCodec.Encode returns false: 38 elements in, 38 out, untouched.
        //   - PULL is NOT. The engineer materializes an empty network where the IDE holds an AND with two
        //     inputs. The logic is invisible to them and to the LSP, silently. And an edit to that network
        //     would regenerate from empty text — this table — with no refusal.
        //
        // [UNMEASURED: whether a real project ever holds an output-less network outside mid-edit. POU_PBD is a
        //  scratch POU. Representing one needs a bare-expression form in network text, which the format does not
        //  have; refusing to render it as EMPTY (a marker instead) is the smaller, honesty-preserving fix.]
        ["POU_PBD.plcopen.xml"] = new[] { "CallType x1", "InputParamTypes x1", "OutputParamTypes x1", "addData x2", "alternativeText x1", "attribute x1", "attribute/@name x1", "attribute/@value x1", "block x1", "block/@localId x1", "block/@typeName x1", "connection x2", "connection/@refLocalId x2", "connectionPointIn x2", "connectionPointOut x3", "data x4", "data/@handleUnknown x4", "data/@name x4", "expression x2", "fbdattributes x1", "inOutVariables x1", "inVariable x2", "inVariable/@localId x2", "inputVariables x1", "outputVariables x1", "position x4", "position/@x x4", "position/@y x4", "variable x3", "variable/@formalParameter x3", "vendorElement x1", "vendorElement/@localId x1", "xhtml x1" },
        ["POU.plcopen.xml"] = new[] { "addData x1", "alternativeText x1", "attribute x1", "attribute/@name x1", "attribute/@value x1", "data x1", "data/@handleUnknown x1", "data/@name x1", "fbdattributes x1", "position x1", "position/@x x1", "position/@y x1", "vendorElement x1", "vendorElement/@localId x1", "xhtml x1" },
        ["POU_SfcRoot_StFbdMethods.plcopen.xml"] = new[] { "addData x1", "alternativeText x1", "attribute x1", "attribute/@name x1", "attribute/@value x1", "data x1", "data/@handleUnknown x1", "data/@name x1", "fbdattributes x1", "position x1", "position/@x x1", "position/@y x1", "vendorElement x1", "vendorElement/@localId x1", "xhtml x1" },
        ["VltFbd_FbdRoot.plcopen.xml"] = new[] { "addData x1", "alternativeText x1", "attribute x1", "attribute/@name x1", "attribute/@value x1", "data x1", "data/@handleUnknown x1", "data/@name x1", "fbdattributes x1", "position x1", "position/@x x1", "position/@y x1", "vendorElement x1", "vendorElement/@localId x1", "xhtml x1" },
    };

    public static TheoryData<string, string> RecordedBodies()
    {
        var data = new TheoryData<string, string>();
        var root = Path.Combine(AppContext.BaseDirectory, "fixtures");
        if (!Directory.Exists(root)) return data;
        foreach (var file in Directory.EnumerateFiles(root, "*.xml", SearchOption.AllDirectories)
                     .Where(f => !f.Contains("roundtrip"))
                     .OrderBy(f => f, StringComparer.Ordinal))
        {
            XDocument doc;
            try { doc = XDocument.Load(file); } catch { continue; }
            if (doc.Descendants().Any(e => e.Name.LocalName is "FBD" or "LD"))
                data.Add(Path.GetFileName(file), file);
        }
        return data;
    }

    /// <summary>Element names and element/@attribute pairs, counted. Deliberately NOT a text diff: attribute
    /// order and whitespace are the serializer's business, and a diff that reports them buries the losses that
    /// matter under noise nobody can act on.</summary>
    private static Dictionary<string, int> Census(XElement body)
    {
        var c = new Dictionary<string, int>(StringComparer.Ordinal);
        void Bump(string k) => c[k] = c.TryGetValue(k, out var n) ? n + 1 : 1;
        foreach (var e in body.DescendantsAndSelf())
        {
            Bump(e.Name.LocalName);
            foreach (var a in e.Attributes())
                if (a.Name.LocalName != "xmlns") Bump($"{e.Name.LocalName}/@{a.Name.LocalName}");
        }
        return c;
    }

    [Theory]
    [MemberData(nameof(RecordedBodies))]
    public void Regeneration_loses_no_more_than_the_recorded_baseline(string fixture, string path)
    {
        var stored = XDocument.Load(path).Descendants().First(e => e.Name.LocalName is "FBD" or "LD");

        // The real production path, minus the no-op short-circuit — this is what an EDITED body still gets.
        var text = NetworkCode.RenderBody(stored);
        var types = InstanceTypes.FromBody(stored);
        var regenerated = GraphWriter.WriteBody(
            NetworkTextReader.Parse(text),
            inst => types.TryGetValue(inst, out var t) ? t : null);

        var before = Census(stored);
        var after = Census(regenerated);

        var lost = before
            .Select(kv => (kv.Key, Missing: kv.Value - (after.TryGetValue(kv.Key, out var n) ? n : 0)))
            .Where(x => x.Missing > 0)
            .Select(x => $"{x.Key} x{x.Missing}")
            .OrderBy(x => x, StringComparer.Ordinal)
            .ToArray();

        var baseline = KnownLoss.TryGetValue(fixture, out var b) ? b : Array.Empty<string>();
        var unapproved = lost.Except(baseline, StringComparer.Ordinal).ToArray();
        var fixedSince = baseline.Except(lost, StringComparer.Ordinal).ToArray();

        _out.WriteLine($"{fixture}: {lost.Length} loss entr(ies)");
        foreach (var l in lost) _out.WriteLine("  " + l);

        Assert.True(unapproved.Length == 0,
            $"{fixture}: regeneration destroys something the baseline does not list. Either fix it, or — if it " +
            "is a deliberate, understood loss — add it to KnownLoss WITH the reason in the commit.\n  " +
            string.Join("\n  ", unapproved) +
            "\n\nFull current loss set for this fixture (paste into KnownLoss if you are recording a baseline):\n" +
            "        [\"" + fixture + "\"] = new[] { " + string.Join(", ", lost.Select(l => $"\"{l}\"")) + " },");

        Assert.True(fixedSince.Length == 0,
            $"{fixture}: the baseline lists losses that no longer happen — the ratchet must be tightened, or it " +
            "stops meaning anything. Remove:\n  " + string.Join("\n  ", fixedSince));
    }
}
