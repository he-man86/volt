using System;
using System.Collections.Generic;
using System.Linq;
using Volt.Contracts;
using Volt.Engine.Format.Body;
using Volt.Engine.Format.Network;
using Volt.Tests.Shared;
using Xunit;
using static Volt.Engine.Tests.NetworkModels;

namespace Volt.Engine.Tests;

/// <summary>
/// openspec <c>ld-fbd-coverage</c> 1b.4 (design "Shown always, refused per network"), in plain-ST network text: (a) every
/// FB consumer reading a data output names it, <c>t(…).name</c>, the name the box itself stores; (b) a network
/// whose trees the text cannot spell is shown as its header, its comment and the one line
/// <c>%UNSUPPORTED "&lt;shape&gt;" #&lt;hash&gt;</c>; (c) a push pairs the live and pushed networks by TEXT
/// (<see cref="NetworkPairing"/>), so only a changed network is rebuilt and only a changed unbuildable one refused.
/// </summary>
public class ShownPerNetworkTests
{
    static readonly NetworkScope Scope = new(new[] { "src", "out", "x", "a", "b", "c", "done" },
        Array.Empty<string>(), new Dictionary<string, string> { ["fbCap"] = "L_FECA.L_FirstFASTErrCapture", ["t1"] = "TON" });

    /// <summary>census 1.6's Lenze box: read through output slot 1 (<c>xErrorActive</c>), slot 0 (<c>xBusy</c>) unwired.</summary>
    static Box Capture(Node feed) =>
        new("L_FECA.L_FirstFASTErrCapture", new Operand("fbCap", IsInstance: true), CallKind.FunctionBlock,
            new[] { In(feed, "xEnable") }, new List<Output>(), null, null, Flags.None,
            ConnectedSlot: 1, HasEnoOutput: false, MainOutputName: "xErrorActive");

    static NetworkBody One(params Node[] trees) => Fbd1(trees);

    // ── (a) an FB read by a named output ─────────────────────────────────────────────────────────

    [Fact]
    public void An_FB_read_by_a_data_output_is_spelled_by_the_name_the_box_stores()
    {
        var model = One(Set(Capture(L("src")), T("out")));
        Assert.Equal(FbdMarker + "%NETWORK\nout := fbCap(xEnable := src).xErrorActive;\n",
            StNetworkWriter.Write(model, Scope));
        var slot0 = Capture(L("src")) with { ConnectedSlot = 0, MainOutputName = "xBusy" };
        Assert.Equal(FbdMarker + "%NETWORK\nout := fbCap(xEnable := src).xBusy;\n",
            StNetworkWriter.Write(One(Set(slot0, T("out"))), Scope));
    }

    [Fact]
    public void A_named_output_reads_back_as_the_name_and_no_slot()
    {
        var read = StNetworkReader.Read(Src("out := fbCap(xEnable := src).xErrorActive;"), Scope);
        var box = Assert.IsType<Box>(Assert.IsType<Assign>(read.Networks[0].Trees[0]).Value);
        Assert.Equal(("xErrorActive", (int?)null), (box.MainOutputName, box.ConnectedSlot));
        // The round-trip oracle: what the text carries of the vendor's box comes back.
        Assert.NotEqual(StNetworkOracle.Gap, StNetworkOracle.Check("named output", 0, BodyLanguage.Fbd, One(Set(Capture(L("src")), T("out"))).Networks[0], Scope).Bucket);
    }

    [Fact]
    public void A_reader_names_the_output_of_an_FB_and_of_nothing_else()
    {
        Assert.Equal("Q", Box.NameOfConnectedOutput(true, 0, false, new[] { "Q", "ET" }));
        Assert.Equal("ET", Box.NameOfConnectedOutput(true, 1, false, new[] { "Q", "ET" }));
        Assert.Null(Box.NameOfConnectedOutput(true, 0, true, new[] { "ENO", "Q" }));   // read through its ENO
        Assert.Null(Box.NameOfConnectedOutput(false, 1, false, new[] { "", "" }));     // a function is read by its value
        Assert.Equal("", Box.NameOfConnectedOutput(true, 2, false, new[] { "a" }));    // read, and empty: refused by name
    }

    [Fact]
    public void A_named_output_the_text_cannot_carry_is_refused_by_name()
    {
        Assert.IsType<StNetworkUnspellableException>(
            Refused(() => StNetworkWriter.Write(One(Set(Capture(L("src")) with { MainOutputName = "" }, T("out"))), Scope)));
        Assert.Equal("a consumed box with no named connection",
            Refused(() => StNetworkWriter.Write(One(Set(Capture(L("src")) with { MainOutputName = null }, T("out"))), Scope)).Reason);
        // A named pin is the pin's own name.
        var named = Capture(L("src")) with { Outputs = new[] { Out("x", null, "xBusy") } };
        Assert.Equal(FbdMarker + "%NETWORK\nout := fbCap(xEnable := src, xBusy => x).xErrorActive;\n",
            StNetworkWriter.Write(One(Set(named, T("out"))), Scope));
    }

    // ── (b) the UNSUPPORTED network line ─────────────────────────────────────────────────────────

    /// <summary>A flag on a box input pin's coil bits has no spelling: the pull shows the network as its line, header and
    /// comment kept, its label under the line, beside a network that reads as usual. The strict writer refuses it by name.</summary>
    [Fact]
    public void A_network_the_text_cannot_spell_is_shown_as_its_UNSUPPORTED_line()
    {
        var nested = new Network(0, "Calc", "L1", "why\r\nit is", false,
            new Node[] { Set(Call("f", new[] { new Input("IN1", L("a"), SetBit) }, connected: 0, eno: false), T("out")) });
        var plain = new Network(1, null, null, null, false, new Node[] { Set(L("a"), T("done")) });
        var body = new NetworkBody(BodyLanguage.Ld, new[] { nested, plain });

        Assert.Equal(
            LdMarker +
            $"%NETWORK \"Calc\"\n// why\n// it is\n%UNSUPPORTED \"a coil flag on a pin\" #{NetworkHash.Of(nested)}\nL1:\n" +
            "%NETWORK\ndone := a;\n",
            StNetworkWriter.WritePulled(body, Scope));
        Assert.Equal("a coil flag on a pin", Refused(() => StNetworkWriter.Write(body, Scope)).Reason);
    }

    /// <summary>The line reads back into the network it stands for — no trees, the shape kept — and writes back the same
    /// text, so a pull pushed back unchanged pairs with the live network.</summary>
    [Fact]
    public void The_UNSUPPORTED_line_reads_back_and_writes_the_same_text()
    {
        var text = LdMarker + "%NETWORK \"Calc\"\n// why\n%UNSUPPORTED \"a flag on a box input pin\" #0badc0de\n";
        var read = StNetworkReader.Read(text, Scope);
        var net = Assert.Single(read.Networks);
        Assert.Equal(("a flag on a box input pin", "0badc0de", "Calc", "why", 0), (net.Unsupported, net.UnsupportedHash, net.Title, net.Comment, net.Trees.Count));
        Assert.Equal(text, StNetworkWriter.Write(read, Scope));
        Assert.True(StNetworkGate.Validate(text, Scope).Ok);
    }

    /// <summary>What a network's HEADER or comment cannot carry has no line to stand on: the body stays hidden.</summary>
    [Fact]
    public void A_header_the_text_cannot_carry_still_hides_the_body()
    {
        var body = new NetworkBody(BodyLanguage.Fbd, new[] { new Network(0, null, "a b", null, false, new Node[] { Set(L("a"), T("done")) }) });
        Assert.Equal("a label that is not an identifier", Refused(() => StNetworkWriter.WritePulled(body, Scope)).Reason);
    }

    // ── (c) the pairing ──────────────────────────────────────────────────────────────────────────

    static string Show(IReadOnlyList<NetworkMove> plan) =>
        string.Join(" ", plan.Select(m => m.Step switch
        {
            NetworkStep.Keep => $"K{m.Live}{m.Pushed}",
            NetworkStep.Rebuild => $"R{m.Live}{m.Pushed}",
            NetworkStep.Insert => $"I{m.Pushed}",
            _ => $"X{m.Live}",
        }));

    [Theory]
    [InlineData("ABCD", "ABCD", "K00 K11 K22 K33")]
    // The design's measured push: insert before #2, remove #3, edit #4 — #2 is kept although every position after
    // the insertion moved.
    [InlineData("ABCD", "AXBD'", "K00 I1 K12 R23 X3")]
    [InlineData("ABCD", "ABD", "K00 K11 X2 K32")]
    [InlineData("ABD", "ABCD", "K00 K11 I2 K23")]
    // `b` is `B` with another header (a title, DISABLED): its trees are kept, its header edited in place.
    [InlineData("ABCD", "AbCD", "K00 R11 K22 K33")]
    // Two networks holding the same rung, one disabled, both flipped (the TwinCAT fixture POU_PBD): two header edits in
    // place — not network 2 kept for network 1 and a copy of it built from nothing.
    [InlineData("Aa", "aA", "R00 R11")]
    [InlineData("ABCD", "ACD", "K00 X1 K21 K32")]
    [InlineData("ABCD", "BCDA", "X0 K10 K21 K32 I3")]
    // Equal texts are the same file: a tie takes the earliest.
    [InlineData("AA", "A", "K00 X1")]
    [InlineData("", "AB", "I0 I1")]
    [InlineData("AB", "", "X0 X1")]
    [InlineData("AB", "CD", "R00 R11")]
    // `*` marks a live network shown as its UNSUPPORTED line (gate 1b-4): its header is edited in place, but it is never
    // rebuilt from other trees — nothing of it is in the text to rebuild from — so the plan removes it and inserts the
    // pushed network (which the refusal of an unseen loss then judges), and a deletion beside an edit stays a deletion.
    [InlineData("A*", "a", "R00")]
    [InlineData("A*", "X", "X0 I0")]
    [InlineData("A*B", "B'", "X0 R10")]
    [InlineData("A*B", "XB", "X0 I0 K11")]
    public void Networks_are_aligned_by_text_in_order(string live, string pushed, string expected)
    {
        // One network per letter, a quote belonging to the letter before it: its text is the token, its trees the token
        // upper-cased — `b` is `B` with another header, `D'` another network than `D`; a `*` after it marks it shown as
        // its UNSUPPORTED line.
        static List<NetworkKey> Nets(string s) =>
            System.Text.RegularExpressions.Regex.Matches(s, @"([A-Za-z]'?)(\*?)")
                .Select(m => new NetworkKey(m.Groups[1].Value, m.Groups[1].Value.ToUpperInvariant(), Unshown: m.Groups[2].Length > 0))
                .ToList();
        var plan = NetworkPairing.Plan(Nets(live), Nets(pushed));
        Assert.Equal(expected, Show(plan));
        // Every pushed network is placed once, in order; every live network is kept, rebuilt or removed once.
        Assert.Equal(Enumerable.Range(0, Nets(pushed).Count),
            plan.Where(m => m.Pushed is not null).Select(m => m.Pushed!.Value));
        Assert.Equal(Enumerable.Range(0, Nets(live).Count),
            plan.Where(m => m.Live is not null).Select(m => m.Live!.Value).OrderBy(i => i));
    }

    /// <summary>A pushed model the writer cannot spell has no text: it pairs with nothing (its write refuses it by name).</summary>
    [Fact]
    public void A_network_with_no_text_pairs_with_nothing()
    {
        var plan = NetworkPairing.Plan(new[] { new NetworkKey("A", "A") }, new[] { new NetworkKey(null, null) });
        Assert.Equal("R00", Show(plan));
        var nested = new Network(0, null, null, null, false, new Node[] { Set(Call("f", new[] { new Input("IN1", L("a"), SetBit) }, connected: 0, eno: false), T("out")) });
        // The live one is shown as its UNSUPPORTED line; the same model PUSHED has no spelling, so the two never pair — and
        // a live UNSUPPORTED network is never rebuilt from other trees (gate 1b-4): it is removed, the pushed one inserted.
        Assert.Equal("X0 I0", Show(NetworkPairing.Plan(new[] { nested }, new[] { nested }, BodyLanguage.Fbd, Scope)));
    }

    // ── (c) gate 1b-4: no push erases what the text does not show ─────────────────────────────────

    static Network Numbered(int order, params Node[] trees) => new(order, null, null, null, false, trees);

    /// <summary>A symbol comment rides on the operand, never in the text (the 1b-1 refusal).</summary>
    static Assign Commented(string source, string target) =>
        Set(new Leaf(new Operand(source, Comment: "c"), Flags.None), T(target));

    static NetworkTextException? Loss(IReadOnlyList<Network> live, IReadOnlyList<Network> pushed)
    {
        var plan = NetworkPairing.Plan(live, pushed, BodyLanguage.Fbd, Scope);
        try { NetworkPairing.RefuseUnseenLoss("CODESYS", live, plan, BodyLanguage.Fbd, Scope); return null; }
        catch (NetworkTextException e) { return e; }
    }

    /// <summary>Review finding 1 (gate 1b-4): a moved network is a removal plus an insertion, and the inserted copy is
    /// built from text, which holds no symbol comment — moved as it is, or moved and edited, it would lose it with nothing
    /// in the diff. Refused, naming the network and the operands.</summary>
    [Fact]
    public void A_moved_network_holding_a_symbol_comment_is_refused()
    {
        var a = Numbered(0, Commented("a", "out"));
        var b = Numbered(1, Set(L("b"), T("x")));
        foreach (var pushed in new[] { new[] { b with { Order = 0 }, a with { Order = 1 } },
                                       new[] { b with { Order = 0 }, Numbered(1, Set(L("c"), T("out"))) } })
        {
            var e = Loss(new[] { a, b }, pushed);
            Assert.NotNull(e);
            Assert.Equal(ConflictCodes.NetworkUnsupported, e!.Code);
            Assert.Contains("network 1", e.Message);
            Assert.Contains("'a'", e.Message);
        }
        // Deleting it, with nothing inserted, is a deletion the diff shows: allowed.
        Assert.Null(Loss(new[] { a, b }, new[] { b with { Order = 0 } }));
    }

    /// <summary>Review finding 2 (gate 1b-4): a live network shown as its UNSUPPORTED line whose line is replaced by trees
    /// (or by nothing) under the same header would erase content Volt never showed — refused, for the reader's refusals and
    /// the writer's alike. Its header alone is edited in place, and the whole network may be deleted.</summary>
    [Fact]
    public void An_UNSUPPORTED_network_replaced_by_other_trees_is_refused()
    {
        var readerRefused = new Network(0, "T", null, null, false, Array.Empty<Node>(), "a vendor split point");
        var writerRefused = new Network(0, "T", null, null, false, new Node[] { Set(Call("f", new[] { new Input("IN1", L("a"), SetBit) }, connected: 0, eno: false), T("out")) });
        foreach (var live in new[] { readerRefused, writerRefused })
        {
            var e = Loss(new[] { live }, new[] { live with { Trees = new Node[] { Set(L("a"), T("done")) }, Unsupported = null } });
            Assert.NotNull(e);
            Assert.Contains("network 1", e!.Message);
            Assert.Contains("UNSUPPORTED", e.Message);
            Assert.NotNull(Loss(new[] { live }, new[] { live with { Trees = Array.Empty<Node>(), Unsupported = null } }));
            // The line pushed back as the pull showed it, under an edited title.
            var line = live with { Trees = Array.Empty<Node>(), Unsupported = live.Unsupported ?? "a coil flag on a pin",
                                   UnsupportedHash = NetworkHash.Of(live) };
            Assert.Null(Loss(new[] { live }, new[] { line with { Title = "edited" } }));
        }
        Assert.Null(Loss(new[] { readerRefused, Numbered(1, Set(L("a"), T("done"))) }, new[] { Numbered(0, Set(L("a"), T("done"))) }));
    }

    /// <summary>Review finding 3 (gate 1b-4): two networks whose text is the same but whose unseen content may differ —
    /// which one the engineer deleted is not in the text, so the deletion is refused rather than guessed.</summary>
    [Fact]
    public void Deleting_one_of_two_identically_shown_networks_with_unseen_content_is_refused()
    {
        var x = new Network(0, null, null, null, false, Array.Empty<Node>(), "a flag on a box input pin");
        var e = Loss(new[] { x, x with { Order = 1 } }, new[] { x });
        Assert.NotNull(e);
        Assert.Contains("the same text", e!.Message);
        // Two identical networks the text shows whole are the same file whichever goes.
        Assert.Null(Loss(new[] { Numbered(0, Set(L("a"), T("out"))), Numbered(1, Set(L("a"), T("out"))) },
                         new[] { Numbered(0, Set(L("a"), T("out"))) }));
        // …but not when one holds a symbol comment the other does not.
        Assert.NotNull(Loss(new[] { Numbered(0, Set(L("a"), T("out"))), Numbered(1, Commented("a", "out")) },
                            new[] { Numbered(0, Set(L("a"), T("out"))) }));
    }

    [Fact]
    public void A_pushed_UNSUPPORTED_line_with_no_live_pair_is_refused_by_name()
    {
        var line = new Network(2, null, null, null, false, Array.Empty<Node>(), "a flag on a box input pin");
        var e = Assert.Throws<NetworkTextException>(() => NetworkPairing.RefuseUnpairedUnsupported("CODESYS", line));
        Assert.Equal(ConflictCodes.NetworkUnsupported, e.Code);
        Assert.Contains("network 3", e.Message);
        NetworkPairing.RefuseUnpairedUnsupported("CODESYS", Net(Set(L("a"), T("done"))));   // a network to build: no refusal
    }

    [Fact]
    public void The_pairing_render_is_the_pull_render_without_a_position()
    {
        var nested = Set(Call("f", new[] { new Input("IN1", L("a"), SetBit) }, connected: 0, eno: false), T("out"));
        var at0 = new Network(0, null, null, null, false, new Node[] { nested });
        Assert.Equal(NetworkPairing.Render(at0, BodyLanguage.Fbd, Scope), NetworkPairing.Render(at0 with { Order = 7 }, BodyLanguage.Fbd, Scope));
        Assert.Contains($"%UNSUPPORTED \"a coil flag on a pin\" #{NetworkHash.Of(at0)}", NetworkPairing.Render(at0, BodyLanguage.Fbd, Scope));
    }

    static StNetworkUnspellableException Refused(Func<string> write) => Assert.Throws<StNetworkUnspellableException>(write);
}
