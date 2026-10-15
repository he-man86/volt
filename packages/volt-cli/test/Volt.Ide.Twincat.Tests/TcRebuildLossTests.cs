using System;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Xml.Linq;
using Volt.Contracts;
using Volt.Engine.Format.Network;
using Xunit;

namespace Volt.Ide.Twincat.Tests;

/// <summary>
/// openspec <c>ld-fbd-coverage</c> 2.2, design "The interim loss window, made visible", on TwinCAT: a network whose SHAPE
/// changed is rebuilt through the IDE's import and replaces the archive element whole, so a stored value of a member
/// the text does not carry — <c>Flags.Fixed</c>, <c>Operand.Boolean</c>, the <c>Address</c> sentinel — that the import
/// does not answer is named in one bridge warning with its count (the item <c>Id</c>s are not: the import mints them, an
/// IDE allocator, vendor-facts <c>nwl-item-id</c> — and the splice keeps them unique in the body). Judged against the
/// IMPORT'S answer (gate 2-2), which is not CODESYS's: <c>Fixed = true</c> on every operand (vendor-facts
/// <c>nwl-flags-fixed</c>, TwinCAT nwl@built). A value edit is written in place and keeps them, and says nothing. Over the
/// vendor-written fixture <c>POU_PBD</c>.
/// </summary>
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

    /// <summary>The import's answer for the three-input AND, as vendor-facts recorded it (<c>nwl-flags-fixed</c>,
    /// <c>nwl-operand-boolean</c>, <c>nwl-address-sentinel</c>, TwinCAT nwl@built): the live network with a third input,
    /// <c>Fixed</c> true on every OPERAND's flag set and false on every item's, <c>Boolean</c> false, <c>Address</c>
    /// empty, and its Ids from the scratch POU's own space (2..N), as the import mints them.</summary>
    static XElement Imported(XElement live)
    {
        var net = new XElement(live);
        var inputs = net.Descendants("l2").First(l => (string?)l.Attribute("n") == "InputItems");
        inputs.Add(new XElement(inputs.Elements("o").Last()));
        foreach (var v in Values(net, "Fixed")) v.Value = OnOperand(v) ? "true" : "false";
        foreach (var v in Values(net, "Boolean")) v.Value = "false";
        foreach (var v in Values(net, "Address")) v.Value = "\"\"";
        Renumber(net, 2);
        return net;
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

    /// <summary>The first network's AND gains an input — a shape the in-place writer cannot edit, so the import rebuilds
    /// it: the warning names each stored value the import does not answer — every item's <c>Fixed</c> (the import's are
    /// false), every <c>Boolean</c>, the sentinel — and NOT the operands' <c>Fixed</c>, which the import answers true
    /// (it named those as lost, a false loss on every network Volt itself pushed, until gate 2-2).</summary>
    [Fact]
    public void A_network_the_import_rebuilds_names_each_stored_value_it_does_not_give_back()
    {
        var body = DrawnBody();
        var live = TcArchive.List(Impl(XElement.Parse(body)), "NetworkList")[0];
        var pushed = AndGainsAnInput(body);

        var said = CaptureStdErr(() => TcNetworkWriter.Apply(body, pushed.Body, pushed.Scope, _ => Imported(live)));

        var itemFixed = Values(live, "Fixed").Count(v => !OnOperand(v));
        var booleanN = Count(live, "Boolean", v => v == "true");
        Assert.True(itemFixed > 0 && booleanN > 0 && Values(live, "Fixed").Any(OnOperand));
        Assert.Contains(
            "TwinCAT: network 1 is rebuilt from its text, which does not carry these stored values, and the rebuilt " +
            $"network does not hold them: Flags.Fixed ×{itemFixed} (vendor-facts row nwl-flags-fixed), " +
            $"Operand.Boolean ×{booleanN} (vendor-facts row nwl-operand-boolean), Operand.Address ×1 (vendor-facts row " +
            "nwl-address-sentinel) (openspec", said);
    }

    /// <summary>The reverse: an operand that stored <c>Fixed = false</c> (533 in the fixtures) comes back true from the
    /// import — a change a vendor-neutral "non-default" test could not see, named here; the values it gives back
    /// (every item's false, every <c>Boolean</c> false, the empty address) are not.</summary>
    [Fact]
    public void A_stored_value_the_import_turns_is_named_and_one_it_gives_back_is_not()
    {
        var doc = XElement.Parse(DrawnBody(), LoadOptions.PreserveWhitespace);
        var first = TcArchive.List(Impl(doc), "NetworkList")[0];
        foreach (var v in Values(first, "Fixed")) v.Value = "false";
        foreach (var v in Values(first, "Boolean")) v.Value = "false";
        foreach (var v in Values(first, "Address")) v.Value = "\"\"";
        var body = doc.ToString(SaveOptions.DisableFormatting);
        var live = TcArchive.List(Impl(XElement.Parse(body)), "NetworkList")[0];
        var pushed = AndGainsAnInput(body);

        var said = CaptureStdErr(() => TcNetworkWriter.Apply(body, pushed.Body, pushed.Scope, _ => Imported(live)));

        var operandFixed = Values(live, "Fixed").Count(OnOperand);
        Assert.True(operandFixed > 0);
        Assert.Contains(
            $"and the rebuilt network does not hold them: Flags.Fixed ×{operandFixed} (vendor-facts row nwl-flags-fixed) (openspec", said);
    }

    /// <summary>The import mints the network's Ids in its scratch POU's own space; spliced into the live body they are
    /// renumbered above every Id the body keeps, so no Id is held twice (gate 2-2; census 1b.1: 0 duplicates in 46
    /// bodies). The body here gains a second network holding the Ids 2..N the import mints again.</summary>
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

        var written = TcNetworkWriter.Apply(body, pushed.Body, pushed.Scope, _ => Imported(live));

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
            n => throw new Xunit.Sdk.XunitException($"the import was reached for network {n.Order + 1}")));

        Assert.DoesNotContain("is rebuilt from its text", said);
    }
}
