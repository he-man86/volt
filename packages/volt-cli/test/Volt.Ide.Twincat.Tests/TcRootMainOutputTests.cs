using System;
using System.Collections.Generic;
using System.Linq;
using System.Xml.Linq;
using Volt.Contracts;
using Volt.Engine.Format.Body;
using Volt.Engine.Format.Network;
using Volt.Engine.Item;
using Xunit;

namespace Volt.Ide.Twincat.Tests;

/// <summary>
/// A ROOT BOX'S MAIN OUTPUT ON TWINCAT (openspec <c>network-text-one-to-one</c> F3). No fixture holds a root box whose
/// null stands past slot 0, so the push refuses to build one by name; the pull still states one, and the default keeps
/// building as it did.
/// </summary>
public class TcRootMainOutputTests
{
    static readonly Dictionary<string, string> Items = new(StringComparer.OrdinalIgnoreCase)
    {
        ["ton"] = "FUNCTION_BLOCK ton\nVAR_INPUT\n\tIN : BOOL;\n\tPT : TIME;\nEND_VAR\nVAR_OUTPUT\n\tQ : BOOL;\n\tET : TIME;\nEND_VAR",
    };

    const string Own = "PROGRAM P\nVAR\n\ta : BOOL;\n\tx : BOOL;\n\tel : TIME;\n\tTON_0 : ton;\nEND_VAR";

    static NetworkScope Scope() => NetworkScope.FromDeclarations(Own, n => Items.TryGetValue(n, out var d) ? d : null,
        () => Array.Empty<string>(), n => Items.ContainsKey(n) ? ItemKind.Kinds.Pou : null, _ => false, _ => null);

    static XElement Nwl() =>
        XDocument.Load(Fixtures.Path("tc-pou", "drawn-refused-shapes.TcPOU"), LoadOptions.PreserveWhitespace)
            .Descendants("NWL").Single();

    static XElement Impl(XElement nwl) => nwl.DescendantsAndSelf("o").First(o => (string?)o.Attribute("t") == "NWLImplementationObject");

    static bool Named(XElement e, string n) => (string?)e.Attribute("n") == n;

    /// <summary>The fixture's drawn root TON, its null swapped from slot 0 to slot 1.</summary>
    static void MoveMainToSlot1(XElement nwl)
    {
        var box = Impl(nwl).Descendants("o").First(o => o.Elements("v").Any(v => Named(v, "BoxType") && v.Value == "\"ton\""));
        var list = box.Elements("o").First(o => Named(o, "OutputItems")).Elements("l2").Single(l => Named(l, "OutputItems"));
        var slots = list.Elements().ToList();
        Assert.Equal("n", slots[0].Name.LocalName);
        slots[0].ReplaceWith(new XElement(slots[1]));
        slots[1].ReplaceWith(new XElement("n"));
    }

    static Box TonOf(XElement nwl) =>
        TcNetworkReader.Read(Impl(nwl), BodyLanguage.Fbd).Networks.SelectMany(n => n.Trees).OfType<Box>().First(b => b.Type == "ton");

    static NetworkBody Validated(string statement, NetworkScope scope)
    {
        var read = StNetworkGate.Validate($"%LANGUAGE FBD\n%NETWORK\n{statement}\n", scope);
        Assert.True(read.Ok, string.Join("\n", read.Diagnostics.Select(d => d.Message)));
        return read.Body!;
    }

    [Fact]
    public void A_root_closed_by_a_name_is_refused_as_an_unsupported_network()
    {
        var scope = Scope();
        var e = Assert.Throws<NetworkTextException>(() => TcArchiveBuilder.Body(Validated("TON_0(IN := a, PT := T#1S).ET;", scope), scope));
        Assert.Equal(ConflictCodes.NetworkUnsupported, e.Code);
        Assert.Contains("main output past its first", e.Message);
    }

    /// <summary>The default keeps building, to a body that reads back as no closer.</summary>
    [Fact]
    public void A_root_with_no_closer_builds_and_reads_back_with_no_closer()
    {
        var scope = Scope();
        var body = TcArchiveBuilder.Body(Validated("TON_0(IN := a, PT := T#1S);", scope), scope);
        var impl = TcArchive.Root(body) ?? throw new Xunit.Sdk.XunitException("no NWL archive");
        var back = TcNetworkReader.Read(impl, BodyLanguage.Fbd);
        Assert.Contains("TON_0(IN := a, PT := T#1S);\n", StNetworkWriter.WritePulled(back, scope));
    }

    /// <summary>The null's position is the main slot on both vendors (DIALECT N1, TcNetworkReader.ConnectedSlot): a root
    /// holding it past slot 0 pulls naming it, never dropping it.</summary>
    [Fact]
    public void A_stored_null_past_slot_0_on_a_root_is_read_as_its_named_output()
    {
        var nwl = Nwl();
        MoveMainToSlot1(nwl);
        var read = TonOf(nwl);
        Assert.Equal(1, read.ConnectedSlot);
        Assert.Equal("ET", read.MainOutputName);
    }

    /// <summary>The drawn default stays what it is: nothing stated.</summary>
    [Fact]
    public void A_stored_null_at_slot_0_on_a_root_states_nothing()
    {
        var read = TonOf(Nwl());
        Assert.Null(read.ConnectedSlot);
        Assert.Null(read.MainOutputName);
    }

    /// <summary>A text dropping <c>.NAME</c> moves the main slot, which writing in place cannot do. Refused, as a moved
    /// consumer is: kept as it stands, the push would report success and the next pull hand the closer back.</summary>
    [Fact]
    public void Dropping_the_closer_over_a_stored_main_slot_is_no_edit_in_place()
    {
        var nwl = Nwl();
        MoveMainToSlot1(nwl);
        var held = TcNetworkReader.Read(Impl(nwl), BodyLanguage.Fbd);
        var dropped = new NetworkBody(held.Language, held.Networks.Select(n => n with
        {
            Trees = n.Trees.Select(t => t is Box { Type: "ton" } b ? (Node)(b with { ConnectedSlot = null, MainOutputName = null }) : t).ToList(),
        }).ToList());
        var e = Assert.Throws<Volt.Engine.UnsupportedException>(() =>
            TcNetworkWriter.Apply(nwl.ToString(SaveOptions.DisableFormatting), dropped, TcText.ScopeOf(held)));
        Assert.Contains("moves to its first", e.Message);
    }
}
