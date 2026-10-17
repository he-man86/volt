using System;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Xml.Linq;
using Volt.Contracts;
using Volt.Engine.Format.Network;
using Xunit;

namespace Volt.Ide.Twincat.Tests;

/// <summary>The tests that capture the process-wide <c>Console.Error</c> (a bridge warning): run beside another test that
/// logs, they read its warning too (a rebuild elsewhere said "is rebuilt from its text" into a value edit's capture).</summary>
[CollectionDefinition(Name, DisableParallelization = true)]
public sealed class StdErrCollection
{
    public const string Name = "captures stderr";
}

/// <summary>
/// openspec <c>ld-fbd-coverage</c> 2.2, design "The interim loss window, made visible", on TwinCAT: a network whose SHAPE
/// changed is rebuilt by the native builder (<see cref="TcArchiveBuilder"/>) and replaces the archive element whole, so a
/// stored value of a member the text does not carry — <c>Flags.Fixed</c>, <c>Operand.Boolean</c>, the <c>Address</c>
/// sentinel, a box's output list, an operand's stored type, a box's EN/ENO — that the builder does not write back is named
/// in one bridge warning with its count (the item <c>Id</c>s are not: an IDE allocator, vendor-facts <c>nwl-item-id</c> —
/// and the splice keeps them unique in the body). Judged against the BUILDER'S answer, the members TwinCAT's own import
/// serialized (the native corpus): <c>Fixed</c> true on a pin's operand and false on an item's, a box's and its instance's,
/// <c>Boolean</c> false, <c>Address</c> empty, no operand type, EN/ENO null. (It was the PLCopen import's answer until
/// openspec twincat-inproc-host; the import did not touch the types or EN/ENO, and turned the instance's <c>Fixed</c> too.)
/// A value edit is written in place and keeps them, and says nothing. Over the vendor-written fixture <c>POU_PBD</c>.
/// </summary>
[Collection(StdErrCollection.Name)]
public class TcRebuildLossTests
{
    static XElement Impl(XElement root) =>
        root.DescendantsAndSelf("o").First(o => (string?)o.Attribute("t") == "NWLImplementationObject");

    /// <summary>POU_PBD with its first network marked as an editor stores it: every flag set <c>Fixed</c>, every operand
    /// <c>Boolean</c>, the first operand's address the archive sentinel.</summary>
    static string DrawnBody()
    {
        var doc = XDocument.Load(Fixtures.Path("tc-pou", "POU_PBD.TcPOU"), LoadOptions.PreserveWhitespace);
        var nwl = doc.Descendants("NWL").Single();
        var first = TcArchive.List(Impl(nwl), "NetworkList")[0];
        foreach (var v in first.Descendants("v").Where(v => (string?)v.Attribute("n") is "Fixed" or "Boolean")) v.Value = "true";
        first.Descendants("v").First(v => (string?)v.Attribute("n") == "Address").Value = "\"" + RebuildLoss.AddressSentinel + "\"";
        return nwl.ToString(SaveOptions.DisableFormatting);
    }

    static System.Collections.Generic.List<XElement> Values(XElement net, string member) => net.Descendants("v").Where(v => (string?)v.Attribute("n") == member).ToList();

    /// <summary>Every Id of <paramref name="net"/> renumbered from <paramref name="first"/> on, in document order.</summary>
    static void Renumber(XElement net, int first)
    {
        foreach (var v in net.Descendants("v").Where(TcIds.IsId))
            v.Value = (first++).ToString(CultureInfo.InvariantCulture) + "L";
    }

    /// <summary>Whether a <c>Fixed</c> value is an operand's (its flag set's owner is an <c>Operand</c>) rather than an
    /// item's or a box's.</summary>
    static bool OnOperand(XElement fixedValue)
    {
        var owner = fixedValue.Parent?.Parent;
        return ((string?)owner?.Attribute("t") ?? (string?)owner?.Parent?.Attribute("cet")) == "Operand";
    }

    /// <summary>Whether a <c>Fixed</c> value is a box instance's flag set (the builder writes it false, as the corpus holds).</summary>
    static bool OnInstance(XElement fixedValue) => (string?)fixedValue.Parent?.Parent?.Attribute("n") == "Instance";

    static int Count(XElement net, string member, Func<string, bool> stored) =>
        net.Descendants("v").Count(v => (string?)v.Attribute("n") == member && stored(v.Value));

    static string CaptureStdErr(Action act)
    {
        var original = Console.Error;
        var buffer = new StringWriter();
        Console.SetError(buffer);
        try { act(); } finally { Console.SetError(original); }
        return buffer.ToString();
    }

    static (NetworkBody Body, NetworkScope Scope) Pushed(string body, Func<string, string> edit)
    {
        var shown = TcNetworkReader.ReadShown(Impl(XElement.Parse(body, LoadOptions.PreserveWhitespace)), BodyLanguage.Fbd);
        var scope = TcText.ScopeOf(shown);
        var text = NetworkTextWriter.WritePulled(shown, scope);
        var edited = edit(text);
        Assert.NotEqual(text, edited);
        var read = NetworkTextReader.Read(edited, scope);
        Assert.True(read.Ok, string.Join("\n", read.Diagnostics.Select(d => d.Message)) + "\n\n" + edited);
        return (read.Body!, scope);
    }

    static (NetworkBody Body, NetworkScope Scope) AndGainsAnInput(string body) =>
        Pushed(body, t => { var at = t.IndexOf(" AND ", StringComparison.Ordinal); return t.Substring(0, at) + " AND extra_in" + t.Substring(at); });

    /// <summary>The first network's AND gains an input — a shape the in-place writer cannot edit, so the builder rebuilds
    /// it: the warning names each stored value the builder does not write back — every item's <c>Fixed</c> (the builder's
    /// are false), every <c>Boolean</c>, the sentinel, the AND's output list, the pins' stored types, EN and ENO — and NOT
    /// the operands' <c>Fixed</c>, which the builder writes true on a pin and false on the instance, as this body holds
    /// (named as lost, it was a false loss on every network Volt itself pushed, until gate 2-2).</summary>
    [Fact]
    public void A_network_the_builder_rebuilds_names_each_stored_value_it_does_not_give_back()
    {
        var body = DrawnBody();
        var live = TcArchive.List(Impl(XElement.Parse(body)), "NetworkList")[0];
        var pushed = AndGainsAnInput(body);

        var said = CaptureStdErr(() => TcNetworkWriter.Apply(body, pushed.Body, pushed.Scope, TcArchiveBuilder.NetworkGraph));

        var itemFixed = Values(live, "Fixed").Count(v => !OnOperand(v));
        var pinTypes = Count(live, "Type", v => v.Length > 2);
        var booleanN = Count(live, "Boolean", v => v == "true");
        Assert.True(itemFixed > 0 && booleanN > 0 && Values(live, "Fixed").Any(OnOperand));
        Assert.Contains(
            "TwinCAT: network 1 is rebuilt from its text, which does not carry these stored values, and the rebuilt " +
            $"network does not hold them: Flags.Fixed ×{itemFixed} (vendor-facts row nwl-flags-fixed), " +
            $"Operand.Boolean ×{booleanN} (vendor-facts row nwl-operand-boolean), Operand.Address ×1 (vendor-facts row " +
            "nwl-address-sentinel), " + AndOutputList + ", " + BuiltCaches(pinTypes), said);
    }

    /// <summary>What the builder writes in place of the members the IDE re-derives (R): no operand type and a null
    /// EN/ENO, as TwinCAT's own import serialized them (the native corpus) — each stored value named; measured on CODESYS
    /// as caches that run as Volt's (2R.4, DIALECT N40).</summary>
    static string BuiltCaches(int types) =>
        $"Operand.Type ×{types} (vendor-facts row nwl-operand-type), EN ×1 (vendor-facts row nwl-box-en-eno), " +
        "ENO ×1 (vendor-facts row nwl-box-en-eno) (openspec";

    /// <summary>The AND's stored output list (<c>['']</c> / <c>['BOOL']</c>, the bit operator's slot, design 2R.2 L),
    /// which the builder builds as the text's derivation (<c>[]</c>): 2R.3 B7 lost on rebuild, named since the pragma
    /// went.</summary>
    const string AndOutputList =
        "OutputParam.Names ×1 (vendor-facts row nwl-output-param-names), OutputParam.Types ×1 (vendor-facts row " +
        "nwl-param-types)";

    /// <summary>The reverse: a pin's operand that stored <c>Fixed = false</c> (533 operands in the fixtures) comes back
    /// true from the builder — a change a vendor-neutral "non-default" test could not see, named here; the values it gives
    /// back (every item's false, the instance's false, every <c>Boolean</c> false, the empty address) are not.</summary>
    [Fact]
    public void A_stored_value_the_builder_turns_is_named_and_one_it_gives_back_is_not()
    {
        var doc = XElement.Parse(DrawnBody(), LoadOptions.PreserveWhitespace);
        var first = TcArchive.List(Impl(doc), "NetworkList")[0];
        foreach (var v in Values(first, "Fixed")) v.Value = "false";
        foreach (var v in Values(first, "Boolean")) v.Value = "false";
        foreach (var v in Values(first, "Address")) v.Value = "\"\"";
        var body = doc.ToString(SaveOptions.DisableFormatting);
        var live = TcArchive.List(Impl(XElement.Parse(body)), "NetworkList")[0];
        var pushed = AndGainsAnInput(body);

        var said = CaptureStdErr(() => TcNetworkWriter.Apply(body, pushed.Body, pushed.Scope, TcArchiveBuilder.NetworkGraph));

        var pinFixed = Values(live, "Fixed").Count(v => OnOperand(v) && !OnInstance(v));
        var pinTypes = Count(live, "Type", v => v.Length > 2);
        Assert.True(pinFixed > 0);
        Assert.Contains(
            $"and the rebuilt network does not hold them: Flags.Fixed ×{pinFixed} (vendor-facts row nwl-flags-fixed), " +
            AndOutputList + ", " + BuiltCaches(pinTypes), said);
    }

    /// <summary>A BIT OPERATOR'S STORED SLOT <c>['']</c> (2R.3 B7; design 2R.2 L, "S1 17": the fan-out's AND in
    /// <c>fanout.test.ts</c>): the text does not carry it, so a rebuild that does not give it back loses it — and the
    /// warning names it. Before, the TwinCAT collector held only <c>'   '</c>, and the slot went unnamed.</summary>
    [Fact]
    public void A_bit_operators_stored_output_slot_the_builder_does_not_give_back_is_named()
    {
        var doc = XElement.Parse(DrawnBody(), LoadOptions.PreserveWhitespace);
        var first = TcArchive.List(Impl(doc), "NetworkList")[0];
        var and = first.Descendants("o").First(o => TcArchive.Str(o, "BoxType") == "AND");
        var names = TcArchive.Obj(and, "OutputParam")!.Elements("l2").First(l => (string?)l.Attribute("n") == "Names");
        names.RemoveNodes();
        names.Add(new XElement("v", ""));
        var body = doc.ToString(SaveOptions.DisableFormatting);
        var live = TcArchive.List(Impl(XElement.Parse(body)), "NetworkList")[0];
        var pushed = AndGainsAnInput(body);

        // The builder builds the text's derivation (B7: the text states no member), so the rebuilt AND holds [] — and
        // that is a loss the warning has to name.
        var said = CaptureStdErr(() => TcNetworkWriter.Apply(body, pushed.Body, pushed.Scope, TcArchiveBuilder.NetworkGraph));

        Assert.Contains("OutputParam.Names ×1 (vendor-facts row nwl-output-param-names)", said);
    }

    /// <summary>The builder numbers a network's Ids from 2, as TwinCAT's import did in its scratch POU; spliced into the
    /// live body they are renumbered above every Id the body keeps, so no Id is held twice (gate 2-2; census 1b.1: 0
    /// duplicates in 46 bodies). The body here gains a second network holding the Ids 2..N the builder mints again.</summary>
    [Fact]
    public void A_rebuilt_network_is_spliced_with_ids_no_other_network_holds()
    {
        var doc = XElement.Parse(DrawnBody(), LoadOptions.PreserveWhitespace);
        var list = TcArchive.List(Impl(doc), "NetworkList");
        // A network told apart by one operand, so the text pairs each network with itself, holding Ids 2..N — and
        // POU_PBD's own two moved to 100+ and 200+, so the body BEFORE the push holds each Id once.
        var second = new XElement(list[0]);
        second.Descendants("v").First(v => (string?)v.Attribute("n") == "Operand").Value = "\"other_op\"";
        Renumber(second, 2);
        Renumber(list[0], 100);
        Renumber(list[1], 200);
        list[0].AddAfterSelf(second);
        var before = Impl(doc).Descendants("v").Where(TcIds.IsId).Select(TcIds.Value).ToList();
        Assert.Equal(before.Count, before.Distinct().Count());
        var body = doc.ToString(SaveOptions.DisableFormatting);
        var live = TcArchive.List(Impl(XElement.Parse(body)), "NetworkList")[0];
        var pushed = Pushed(body, t =>
        {
            var at = t.IndexOf(" AND ", StringComparison.Ordinal);   // the FIRST network's AND only
            return t.Substring(0, at) + " AND extra_in" + t.Substring(at);
        });

        var written = TcNetworkWriter.Apply(body, pushed.Body, pushed.Scope, TcArchiveBuilder.NetworkGraph);

        Assert.NotNull(written);
        var ids = Impl(XElement.Parse(written!)).Descendants("v").Where(TcIds.IsId).Select(TcIds.Value).ToList();
        Assert.True(ids.Count > 0);
        Assert.Equal(ids.Count, ids.Distinct().Count());
    }

    /// <summary>A value edit (an operand renamed) is written into the archive in place: nothing is reset, nothing said.</summary>
    [Fact]
    public void A_value_edit_written_in_place_says_nothing()
    {
        var body = DrawnBody();
        var operand = TcArchive.List(TcArchive.List(Impl(XElement.Parse(body)), "NetworkList")[0], "NetworkItems")
            .Descendants("v").First(e => (string?)e.Attribute("n") == "Operand").Value.Trim('"');
        var pushed = Pushed(body, t => t.Replace(operand, "renamed_op"));

        var said = CaptureStdErr(() => TcNetworkWriter.Apply(body, pushed.Body, pushed.Scope,
            (n, _) => throw new Xunit.Sdk.XunitException($"the builder was reached for network {n.Order + 1}")));

        Assert.DoesNotContain("is rebuilt from its text", said);
    }
}
