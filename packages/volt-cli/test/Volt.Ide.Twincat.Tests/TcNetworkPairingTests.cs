using System;
using System.Collections.Generic;
using System.Linq;
using System.Xml.Linq;
using Volt.Contracts;
using Volt.Engine.Format.Network;
using Xunit;

namespace Volt.Ide.Twincat.Tests;

/// <summary>
/// openspec <c>ld-fbd-coverage</c> 1b.4 on TwinCAT: the in-place writer pairs the live networks with the pushed ones by
/// TEXT (<see cref="NetworkPairing"/>), which lifts its network-count refusal — a removed network is the one no pushed
/// text pairs with, an inserted one is the one-network import spliced in where it stands — and every network whose text
/// did not change stays byte for byte as the IDE wrote it. Over the vendor-written fixture <c>POU_PBD</c> (two networks,
/// each an AND rung).
/// </summary>
public class TcNetworkPairingTests
{
    private static string VendorBody(bool pinFlagOnFirst = false)
    {
        var doc = XDocument.Load(Fixtures.Path("tc-pou", "POU_PBD.TcPOU"), LoadOptions.PreserveWhitespace);
        var nwl = doc.Descendants("NWL").Single();
        if (pinFlagOnFirst)
        {
            // A populated InputFlags is a fact this reader refuses by name (TcPinFlagTests): network 1 becomes its line.
            var first = Networks(nwl)[0];
            var flags = first.Descendants().First(e => (string?)e.Attribute("n") == "InputFlags");
            flags.ReplaceWith(new XElement("a", new XAttribute("n", "InputFlags"), new XAttribute("cet", "Flags"),
                new XElement("o", new XElement("v", new XAttribute("n", "Flags"), "1"))));
        }
        return nwl.ToString(SaveOptions.DisableFormatting);
    }

    private static XElement Impl(XElement root) =>
        root.DescendantsAndSelf("o").First(o => (string?)o.Attribute("t") == "NWLImplementationObject");

    private static IReadOnlyList<XElement> Networks(XElement root) => TcArchive.List(Impl(root), "NetworkList");

    private static IReadOnlyList<string> NetworkXml(string body) =>
        Networks(XElement.Parse(body, LoadOptions.PreserveWhitespace)).Select(n => n.ToString(SaveOptions.DisableFormatting)).ToList();

    private static NetworkBody Shown(string body) =>
        TcNetworkReader.ReadShown(Impl(XElement.Parse(body, LoadOptions.PreserveWhitespace)), BodyLanguage.Fbd);

    private static NetworkScope ScopeOf(NetworkBody b) => TcText.ScopeOf(b);

    /// <summary>The pulled text edited as an engineer would, read back as the push reads it.</summary>
    private static (NetworkBody Body, NetworkScope Scope) Pushed(string body, Func<string, string> edit)
    {
        var shown = Shown(body);
        var scope = ScopeOf(shown);
        var text = edit(NetworkTextWriter.WritePulled(shown, scope));
        var read = NetworkTextReader.Read(text, scope);
        Assert.True(read.Ok, string.Join("\n", read.Diagnostics.Select(d => d.Message)) + "\n\n" + text);
        return (read.Body!, scope);
    }

    private static string FirstNetworkText(string body) =>
        NetworkTextWriter.WritePulled(Shown(body), ScopeOf(Shown(body))).Split(new[] { "END_NETWORK\n" }, StringSplitOptions.None)[0]
            .Substring("IMPLEMENTATION FBD\n".Length) + "END_NETWORK\n";

    private static Func<Network, XElement> Never => n => throw new Xunit.Sdk.XunitException($"the import was reached for network {n.Order + 1}");

    /// <summary>A network inserted before the two the IDE holds is the import's one network, spliced in at the top; both
    /// live networks stay byte for byte (positional pairing called both "changed" and the count refused the push).</summary>
    [Fact]
    public void An_inserted_network_is_imported_and_spliced_where_it_stands()
    {
        var body = VendorBody();
        var before = NetworkXml(body);
        var first = FirstNetworkText(body);
        var operand = TcArchive.List(Networks(XElement.Parse(body))[0], "NetworkItems")
            .Descendants().First(e => (string?)e.Attribute("n") == "Operand" && e.Name == "v").Value.Trim('"');
        var pushed = Pushed(body, t => t.Replace("IMPLEMENTATION FBD\n", "IMPLEMENTATION FBD\n" + first.Replace(operand, "inserted_op")));

        var imported = new List<Network>();
        var written = TcNetworkWriter.Apply(body, pushed.Body, pushed.Scope, n =>
        {
            imported.Add(n);
            return new XElement(Networks(XElement.Parse(body))[0]);   // the import's answer: the same rung, before the stamp
        });

        Assert.NotNull(written);
        Assert.Single(imported);
        var after = NetworkXml(written!);
        Assert.Equal(3, after.Count);
        Assert.Equal(before[0], after[1]);
        Assert.Equal(before[1], after[2]);
        Assert.Contains("inserted_op", after[0]);
    }

    /// <summary>A network the reader refuses pulls as its UNSUPPORTED line beside an editable one; pushed back unchanged
    /// while the other is edited, it stays byte for byte and the import is never reached.</summary>
    [Fact]
    public void An_UNSUPPORTED_network_pushed_back_unchanged_is_kept_beside_an_edit()
    {
        var body = VendorBody(pinFlagOnFirst: true);
        var before = NetworkXml(body);
        var pushed = Pushed(body, t =>
        {
            Assert.Contains("UNSUPPORTED \"a flag on a box input pin\";", t);
            return t.Replace("NETWORK DISABLED", "NETWORK DISABLED TITLE: \"edited\"");
        });

        var written = TcNetworkWriter.Apply(body, pushed.Body, pushed.Scope, Never);

        Assert.NotNull(written);
        var after = NetworkXml(written!);
        Assert.Equal(before[0], after[0]);
        Assert.NotEqual(before[1], after[1]);
        Assert.Equal("edited", Shown(written!).Networks[1].Title);
    }

    /// <summary>An UNSUPPORTED line that pairs with no live network holds nothing to build from: refused by name.</summary>
    [Fact]
    public void An_edited_UNSUPPORTED_line_is_refused_by_name()
    {
        var body = VendorBody(pinFlagOnFirst: true);
        var pushed = Pushed(body, t => t.Replace("a flag on a box input pin", "a flag on an output pin"));

        var ex = Assert.Throws<NetworkTextException>(() => TcNetworkWriter.Apply(body, pushed.Body, pushed.Scope, Never));
        Assert.Equal(ConflictCodes.NetworkUnsupported, ex.Code);
        Assert.Contains("network 1", ex.Message);
    }

    /// <summary>Gate 1b-4, review findings 1 and 2: an UNSUPPORTED network emptied under its header, or moved below its
    /// neighbour, would be rebuilt (or removed and re-imported) from text that holds none of it — refused by name before
    /// the import is reached, the body untouched.</summary>
    [Theory]
    [InlineData("emptied")]
    [InlineData("moved")]
    public void An_UNSUPPORTED_network_emptied_or_moved_is_refused_before_the_import(string edit)
    {
        var body = VendorBody(pinFlagOnFirst: true);
        var pushed = Pushed(body, t =>
        {
            const string line = "  UNSUPPORTED \"a flag on a box input pin\";\n";
            Assert.Contains(line, t);
            if (edit == "emptied") return t.Replace(line, "");
            var parts = t.Substring("IMPLEMENTATION FBD\n".Length).Split(new[] { "END_NETWORK\n" }, StringSplitOptions.RemoveEmptyEntries);
            return "IMPLEMENTATION FBD\n" + parts[1] + "END_NETWORK\n" + parts[0] + "END_NETWORK\n";
        });

        var ex = Assert.Throws<NetworkTextException>(() => TcNetworkWriter.Apply(body, pushed.Body, pushed.Scope, Never));
        Assert.Equal(ConflictCodes.NetworkUnsupported, ex.Code);
        Assert.Contains("network 1", ex.Message);
        Assert.Contains("UNSUPPORTED", ex.Message);
    }

    /// <summary>S4 — a box read through a named main output — is unmeasured on TwinCAT (no TwinCAT project holds one): a
    /// changed network holding it is refused by name before the import.</summary>
    [Fact]
    public void A_changed_network_reading_a_box_by_a_named_output_is_refused_before_the_import()
    {
        var body = VendorBody();
        var model = Shown(body);
        var s4 = new Box("TON", new Operand("t1", IsInstance: true), CallKind.FunctionBlock,
            new[] { new Input("IN", new Leaf(new Operand("go"), Flags.None), Flags.None) }, new List<Output>(), null, null,
            Flags.None, HasEnoOutput: false, MainOutputName: "ET");
        var pushed = model with
        {
            Networks = new[] { model.Networks[0], model.Networks[1] with { Trees = new Node[] { new Assign(s4, new[] { new Operand("elapsed", IsLValue: true) }, Flags.None) } } },
        };
        var scope = new NetworkScope(new[] { "go", "elapsed" }, Array.Empty<string>(), new Dictionary<string, string> { ["t1"] = "TON" });

        var ex = Assert.Throws<NotSupportedException>(() => TcNetworkWriter.Apply(body, pushed, scope, Never));
        Assert.Contains("network 2 changed", ex.Message);
        Assert.Contains("'ET'", ex.Message);
    }
}
