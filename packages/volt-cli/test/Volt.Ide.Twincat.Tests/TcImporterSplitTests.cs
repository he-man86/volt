using System.Linq;
using System.Xml.Linq;
using Volt.Engine.Format.Body;
using Volt.Engine.Format.Network;
using Xunit;

namespace Volt.Ide.Twincat.Tests;

/// <summary>
/// UNDOING THE IMPORTER'S SPLIT — and the two wrong explanations it took to get there.
///
/// <para><c>fixtures/tc-pou/importer-split.TcPOU</c> is real XAE output, captured 2026-09-06 by pushing ONE
/// network holding two independent rungs (<c>t1(IN := a, PT := pt); done := t1.Q;</c>) and reading back what the
/// importer built: TWO networks (D25, one per connected component). CODESYS keeps the one, so this was the last
/// divergence in `twincat-graphical-create-parity` that was neither a refusal nor an impossibility.</para>
///
/// <para><b>Both earlier explanations were wrong, and each survived because it was only tested offline.</b> The
/// first said a tree in the second network points into the first. It does not: that tree is an ordinary assign
/// whose RValue is a plain operand whose text is <c>"t1.Q"</c> — no id, no connector — and the two networks'
/// <c>Id</c>s do not overlap. The second was mine: a network is HOMOGENEOUS, so the halves can never share a
/// list. It held across every archive we had, until a fan-out drawn by hand
/// (<c>ladder-demux.TcPOU</c>) produced a list with NO <c>cet</c> whose children each carry their own <c>t</c>.</para>
///
/// <para><b>The rule is an exclusive OR</b>, verified across all 22 populated lists: a <c>NetworkItems</c> list
/// has <c>cet</c> and NO child typed, or NO <c>cet</c> and EVERY child typed — never a mixture. The merge that
/// failed on a live XAE wrote exactly that mixture (it kept the destination's <c>cet</c> and stamped <c>t</c> on
/// only the moved items), so TwinCAT typed the moved assign from the list, read an assign as a box, and returned
/// <c>done := ();</c> — after round-tripping perfectly through Volt's own reader, which is why offline never
/// caught it. Converting the destination wholesale to the child-typed form works: measured live, all four
/// grouping shapes now come back as one network, matching CODESYS.</para>
/// </summary>
public class TcImporterSplitTests
{
    private static string Built() =>
        XDocument.Parse(Fixtures.Pou("importer-split.TcPOU"), LoadOptions.PreserveWhitespace)
            .Descendants("NWL").Single().ToString(SaveOptions.DisableFormatting);

    private static XElement Impl(string bodyXml) =>
        XElement.Parse(bodyXml, LoadOptions.PreserveWhitespace)
            .DescendantsAndSelf("o").First(o => (string?)o.Attribute("t") == "NWLImplementationObject");

    /// <summary>The premise: one network in, two networks out. Asserted, so the rest cannot pass vacuously.</summary>
    [Fact]
    public void The_importer_splits_one_pushed_network_into_two()
    {
        var pushed = Pushed();

        Assert.Equal(1, pushed.Networks.Count);
        Assert.Equal(2, TcNetworkReader.Read(Impl(Built()), BodyLanguage.Fbd).Networks.Count);
    }

    /// <summary>AND THE TWO HALVES HAVE DIFFERENT ELEMENT TYPES, which is the reason they are two.
    ///
    /// <para>This is what makes the divergence permanent rather than open: merging them would mean one list
    /// holding both, and the vendor has no way to write that down.</para></summary>
    [Fact]
    public void The_split_networks_carry_different_element_types()
    {
        var lists = Impl(Built()).Descendants("l2")
            .Where(l => (string?)l.Attribute("n") == "NetworkItems")
            .Select(l => (string?)l.Attribute("cet"))
            .ToList();

        Assert.Equal(2, lists.Count);
        Assert.Equal(new[] { "BoxTreeBox", "BoxTreeAssign" }, lists);
    }

    /// <summary>HOW A NETWORK TYPES ITS ITEMS — and it is an EXCLUSIVE OR, not homogeneity.
    ///
    /// <para>This test asserted the wrong rule for a day. Every archive then held said a list declares its
    /// element type once via <c>cet</c> with no child carrying <c>t</c>, so a network looked HOMOGENEOUS and the
    /// importer's split looked permanent. A hand-drawn fan-out (`ladder-demux.TcPOU`) falsified it: that
    /// network's list has NO <c>cet</c> and EVERY child carries its own <c>t</c> —
    /// <c>BoxTreeDemux</c>, <c>BoxTreeAssign</c>, <c>BoxTreeAssign</c>. A network CAN hold mixed item types.</para>
    ///
    /// <para><b>The real contract, across all 22 populated lists here:</b> either <c>cet</c> is present and NO
    /// child has <c>t</c>, or <c>cet</c> is absent and ALL children do. Never a mixture of the two — which is
    /// exactly what the first merge attempt wrote (it kept the destination's <c>cet</c> and stamped <c>t</c> on
    /// only the moved items), and why the vendor read the moved assign as a box and returned
    /// <c>done := ();</c>.</para></summary>
    [Fact]
    public void A_network_types_its_items_by_the_list_or_by_every_child_never_both()
    {
        var violations = new System.Collections.Generic.List<string>();
        var lists = 0;

        foreach (var file in System.IO.Directory.EnumerateFiles(Fixtures.PouDir(), "*.TcPOU"))
        {
            XElement root;
            try { root = XElement.Parse(System.IO.File.ReadAllText(file), LoadOptions.PreserveWhitespace); }
            catch (System.Xml.XmlException) { continue; }

            foreach (var list in root.Descendants("l2").Where(l => (string?)l.Attribute("n") == "NetworkItems"))
            {
                var kids = list.Elements("o").ToList();
                if (kids.Count == 0) continue;
                lists++;

                var cet = (string?)list.Attribute("cet") != null;
                var typed = kids.Count(k => k.Attribute("t") != null);
                var conforms = (cet && typed == 0) || (!cet && typed == kids.Count);
                if (!conforms)
                    violations.Add($"{System.IO.Path.GetFileName(file)}: cet={cet}, {typed}/{kids.Count} children typed");
            }
        }

        Assert.True(lists >= 20, $"only {lists} populated NetworkItems lists — too thin to conclude from");
        Assert.True(violations.Count == 0,
            "a list that is neither fully cet-typed nor fully child-typed — the form the vendor does not write, " +
            "and the one a merge must not produce: " + string.Join(" | ", violations));
    }

    /// <summary>AND A MIXED NETWORK IS A SHAPE THE VENDOR DOES WRITE — the fact that reopens the merge.</summary>
    [Fact]
    public void A_hand_drawn_network_holds_more_than_one_item_type()
    {
        var mixed = XElement.Parse(Fixtures.Pou("ladder-demux.TcPOU"), LoadOptions.PreserveWhitespace)
            .Descendants("l2")
            .Where(l => (string?)l.Attribute("n") == "NetworkItems" && (string?)l.Attribute("cet") == null)
            .Select(l => l.Elements("o").Select(o => (string?)o.Attribute("t")).ToList())
            .FirstOrDefault();

        Assert.NotNull(mixed);
        Assert.True(mixed!.Distinct().Count() > 1, "the child-typed list should hold MORE THAN ONE type");
        Assert.Contains("BoxTreeDemux", mixed);
    }

    /// <summary>MERGING IN THE VENDOR'S OWN FORM — the repair the corrected contract makes possible.
    ///
    /// <para>The first attempt round-tripped perfectly through <c>TcNetworkReader</c> and still came back from a
    /// live XAE as <c>done := ();</c>, because it wrote a list that was NEITHER cet-typed nor child-typed. So the
    /// assertion that matters is not "it reads back" — that one passed while the code was wrong. It is that the
    /// merged list is in a form the vendor actually writes.</para></summary>
    [Fact]
    public void The_merged_list_is_in_a_form_the_vendor_writes()
    {
        var merged = TcNetworkWriter.MergeImporterSplits(Built(), Pushed());
        Assert.NotNull(merged);

        var lists = Impl(merged!).Descendants("l2")
            .Where(l => (string?)l.Attribute("n") == "NetworkItems")
            .Where(l => l.Elements("o").Any())
            .ToList();

        Assert.Single(lists);                                   // the two became one
        var kids = lists[0].Elements("o").ToList();
        Assert.True(kids.Count > 1, "the merged list should hold both rungs");

        // The exclusive-or, asserted on what was just built rather than on a fixture.
        Assert.Null((string?)lists[0].Attribute("cet"));
        Assert.All(kids, k => Assert.NotNull((string?)k.Attribute("t")));
        Assert.True(kids.Select(k => (string?)k.Attribute("t")).Distinct().Count() > 1,
            "the whole point is a MIXED list — a box rung and an assign rung together");
    }

    /// <summary>...and the operand survives, which is the regression the first attempt failed.</summary>
    [Fact]
    public void The_second_rungs_operand_survives_the_merge()
    {
        var text = TcText.Write(
            TcNetworkReader.Read(Impl(TcNetworkWriter.MergeImporterSplits(Built(), Pushed())!), BodyLanguage.Fbd));

        Assert.Contains("done := t1.Q;", text);
        Assert.DoesNotContain("done := ()", text);
        Assert.Contains("t1(IN := a, PT := pt);", text);
    }

    /// <summary>The pushed body, read against a scope whose declarations say <c>t1 : TON</c>.</summary>
    private static NetworkBody Pushed() =>
        NetworkText.Validate("(* @volt-implementation FBD *)\nNETWORK\n  t1(IN := a, PT := pt);\n  done := t1.Q;\nEND_NETWORK\n",
            new NetworkScope(new[] { "a", "pt", "done" }, System.Array.Empty<string>(),
                             new System.Collections.Generic.Dictionary<string, string> { ["t1"] = "TON" }));
}
