using System;
using System.Collections.Generic;
using System.Linq;
using Volt.Contracts;
using Volt.Engine.Format.Network;
using Volt.Tests.Shared;
using Xunit;

namespace Volt.Ide.Codesys.Tests;

/// <summary>
/// openspec <c>ld-fbd-coverage</c> 1b.4 on CODESYS: the push pairs the live networks with the pushed ones by TEXT
/// (<see cref="NetworkPairing"/>), through the aspect's own list API — so a network whose text did not change keeps its
/// very vendor object wherever a network was inserted or removed before it, and a network the push cannot build (S4, a
/// pushed <c>UNSUPPORTED</c> line) is refused only when ITS text changed. Through <c>CodesysNetworkWriter.Write</c>, the
/// production entry point, asserting on the vendor objects the doubles hold.
/// </summary>
public class CodesysNetworkPairingTests
{
    static Nwl.BoxTreeAssign Rung(string target, string source)
    {
        var a = new Nwl.BoxTreeAssign { RValue = Nwl.Leaf(source) };
        a.Outputs.List.Add(new Nwl.Operand { OperandExpr = target, IsLValue = true });
        return a;
    }

    /// <summary>census 1.6's Lenze box: an FB call whose main output is slot 1 (<c>xErrorActive</c>), read by a coil.</summary>
    static Nwl.BoxTreeAssign S4Rung(string feed = "src")
    {
        var outputs = new Nwl.OutputItemList();
        outputs.AppendOutputItem(new Nwl.Operand { OperandExpr = "", IsLValue = true });   // xBusy, unwired
        outputs.List.Add(null!);                                                             // the connected slot
        var box = new Nwl.BoxTreeBox
        {
            BoxType = "L_FirstFASTErrCapture",
            Instance = new Nwl.Operand { OperandExpr = "fbCap", IsInstance = true },
            InputItemList = new object[] { Nwl.Leaf(feed) },
            InputParams = new Nwl.ParamList { Names = new[] { "xEnable" }, Types = new[] { "BOOL" } },
            OutputParams = new Nwl.ParamList { Names = new[] { "xBusy", "xErrorActive" }, Types = new[] { "BOOL", "BOOL" } },
            Outputs = outputs,
            MainOutputIndex = 1,
        };
        var a = new Nwl.BoxTreeAssign { RValue = box };
        a.Outputs.List.Add(new Nwl.Operand { OperandExpr = "out", IsLValue = true });
        return a;
    }

    /// <summary>The <c>%UNSUPPORTED "…" #hash</c> line a pulled text shows (its hash is the network's).</summary>
    static string LineOf(string text) =>
        System.Text.RegularExpressions.Regex.Match(text, "%UNSUPPORTED \"[^\"]*\" #[0-9a-f]{8}").Value;

    /// <summary>A rung whose AND box carries a SET bit on an input pin, which the text has no spelling for (a coil bit
    /// on a pin — a negated pin is S6's spelling since ld-fbd-coverage 2.3, an edge on one 2R.5's).</summary>
    static Nwl.BoxTreeAssign PinFlagRung()
    {
        var and = new Nwl.BoxTreeBox
        {
            BoxType = "AND",
            InputItemList = new object[] { Nwl.Leaf("a"), Nwl.Leaf("b") },
            InputFlags = new object[] { new Nwl.Flags(), new Nwl.Flags { Set = true } },
        };
        var a = new Nwl.BoxTreeAssign { RValue = and };
        a.Outputs.List.Add(new Nwl.Operand { OperandExpr = "y", IsLValue = true });
        return a;
    }

    static (Nwl.NWLImplementationObject Impl, List<Nwl.Network> Nets) Live(params Nwl.BoxTreeAssign[] rungs)
    {
        var impl = new Nwl.NWLImplementationObject { DefaultViewMode = "Fbd" };
        var nets = rungs.Select(r => new Nwl.Network().With(r)).ToList();
        impl.NetworkList.AddRange(nets);
        return (impl, nets);
    }

    sealed class Holder
    {
        public Holder(object implementation) => Implementation = implementation;
        public object Implementation { get; }
    }

    /// <summary>The body as the pull shows it, its text edited as an engineer would, read back as the push reads it.</summary>
    static (NetworkBody Body, NetworkScope Scope) Pushed(Nwl.NWLImplementationObject impl, Func<string, string> edit)
    {
        var shown = CodesysNetworkReader.ReadShown(impl, BodyLanguage.Fbd);
        var scope = new NetworkScope(new[] { "a", "b", "c", "d", "e", "src", "out", "y", "o1", "o2", "o3", "o4", "o5" },
            Array.Empty<string>(), new Dictionary<string, string> { ["fbCap"] = "L_FirstFASTErrCapture" });
        var text = edit(StNetworkWriter.WritePulled(shown, scope));
        return (StNetworkReader.Read(text, scope), scope);
    }

    static void Write(Nwl.NWLImplementationObject impl, (NetworkBody Body, NetworkScope Scope) pushed) =>
        CodesysNetworkWriter.Write(new Holder(impl), pushed.Body, pushed.Scope);

    static string Net(string line) => "%NETWORK\n" + line + "\n";

    /// <summary>The design's case: insert a network before #2, remove #3, edit #4 — #1 and #2 keep their vendor objects,
    /// untouched; the inserted one is a new object; one live network is rebuilt and one removed.</summary>
    [Fact]
    public void An_insertion_and_a_removal_keep_every_unchanged_network_untouched()
    {
        var (impl, nets) = Live(Rung("o1", "a"), Rung("o2", "b"), Rung("o3", "c"), Rung("o4", "d"));
        Write(impl, Pushed(impl, t => t
            .Replace(Net("o2 := b;"), Net("o5 := e;") + Net("o2 := b;"))
            .Replace(Net("o3 := c;"), "")
            .Replace("o4 := d;", "o4 := e;")));

        Assert.Equal(4, impl.NetworkList.Count);
        Assert.Same(nets[0], impl.NetworkList[0]);
        Assert.Same(nets[1], impl.NetworkList[2]);
        Assert.Empty(nets[0].Calls);
        Assert.Empty(nets[1].Calls);
        Assert.DoesNotContain(impl.NetworkList[1], nets);
        Assert.Equal(new[] { "RemoveNetwork(3)", "InsertNetwork(1)" }, impl.Calls);
        var after = StNetworkWriter.WritePulled(CodesysNetworkReader.ReadShown(impl, BodyLanguage.Fbd), NetworkScope.Empty);
        Assert.Equal("%LANGUAGE FBD\n" + Net("o1 := a;") + Net("o5 := e;") + Net("o2 := b;") + Net("o4 := e;"), after);
    }

    /// <summary>S4 is spelled `.xErrorActive` on pull, and an UNCHANGED S4 network is kept — even when a network is
    /// inserted before it, which positional pairing turned into a refused "change" of the S4 network.</summary>
    [Fact]
    public void An_unchanged_S4_network_is_kept_beside_an_insertion()
    {
        var (impl, nets) = Live(S4Rung(), Rung("o1", "a"));
        var pushed = Pushed(impl, t =>
        {
            // The call's whole output list is its pragma (ld-fbd-coverage 2.3), the connection its `.name`.
            Assert.Contains("fbCap(xEnable := src, xErrorActive => w1);\nout := w1;", t);
            return t.Replace("%LANGUAGE FBD\n", "%LANGUAGE FBD\n" + Net("o5 := e;"));
        });
        Write(impl, pushed);

        Assert.Equal(3, impl.NetworkList.Count);
        Assert.Same(nets[0], impl.NetworkList[1]);
        Assert.Empty(nets[0].Calls);
        Assert.Equal(new[] { "InsertNetwork(0)" }, impl.Calls);
    }

    /// <summary>…and a CHANGED one is refused by name, before the list changes: the box's main output index is read-only
    /// on a box Volt builds (N21), so the consumer would read another output.</summary>
    [Fact]
    public void A_changed_S4_network_is_refused_naming_the_network_and_the_output()
    {
        var (impl, nets) = Live(Rung("o1", "a"), S4Rung());
        var pushed = Pushed(impl, t => t.Replace("xEnable := src", "xEnable := a").Replace("o1 := a;", "o1 := b;"));

        var ex = Assert.Throws<Volt.Engine.BridgeException>(() => Write(impl, pushed));
        Assert.Equal(Volt.Contracts.BridgeErrorCodes.Unsupported, ex.ErrorCode);
        Assert.Contains("network 2 changed", ex.Message);
        Assert.Contains("'xErrorActive'", ex.Message);
        Assert.Empty(impl.Calls);
        Assert.Empty(nets[0].Calls);
        Assert.Empty(nets[1].Calls);
    }

    /// <summary>A network the text cannot spell pulls as its UNSUPPORTED line, its body editable beside it; pushed back
    /// unchanged it is kept, its title can be edited, and deleting the whole network removes it.</summary>
    [Fact]
    public void An_UNSUPPORTED_network_is_kept_retitled_or_removed_but_never_built()
    {
        var (impl, nets) = Live(PinFlagRung(), Rung("o1", "a"));
        var shown = Pushed(impl, t =>
        {
            Assert.Matches("%NETWORK\n%UNSUPPORTED \"a coil flag on a pin\" #[0-9a-f]{8}\n", t);
            return t.Replace("o1 := a;", "o1 := b;");
        });
        Write(impl, shown);
        Assert.Same(nets[0], impl.NetworkList[0]);
        Assert.Empty(nets[0].Calls);
        Assert.Contains("RemoveNetworkItem", nets[1].Calls);

        Write(impl, Pushed(impl, t => t.Replace("%NETWORK\n%UNSUPPORTED", "%NETWORK \"kept\"\n%UNSUPPORTED")));
        Assert.Equal("kept", nets[0].Title);
        Assert.Empty(nets[0].Calls);

        Write(impl, Pushed(impl, t => t.Substring(0, t.IndexOf("%NETWORK", StringComparison.Ordinal)) +
                                      t.Substring(t.IndexOf("%NETWORK", t.IndexOf("%NETWORK", StringComparison.Ordinal) + 1, StringComparison.Ordinal))));
        Assert.Single(impl.NetworkList);
        Assert.Same(nets[1], impl.NetworkList[0]);
    }

    /// <summary>Gate 1b-4, review finding 1: a MOVED network is a removal plus an insertion, and the inserted copy is
    /// built from the text, which holds no symbol comment — refused before the list changes, moved as it is or moved and
    /// edited (positional pairing rebuilt both slots, and the symbol-comment refusal fired).</summary>
    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public void A_moved_network_holding_a_symbol_comment_is_refused(bool edited)
    {
        var commented = new Nwl.BoxTreeAssign { RValue = new Nwl.BoxTreeOperand { Operand = new Nwl.Operand { OperandExpr = "a", StoredSymbolComment = "c" } } };
        commented.Outputs.List.Add(new Nwl.Operand { OperandExpr = "o1", IsLValue = true });
        var (impl, nets) = Live(commented, Rung("o2", "b"));
        var pushed = Pushed(impl, t => "%LANGUAGE FBD\n" + Net("o2 := b;") + Net(edited ? "o1 := c;" : "o1 := a;"));

        var ex = Assert.Throws<NetworkTextException>(() => Write(impl, pushed));
        Assert.Equal(ConflictCodes.NetworkUnsupported, ex.Code);
        Assert.Contains("network 1", ex.Message);
        Assert.Contains("'a'", ex.Message);
        Assert.Empty(impl.Calls);
        Assert.Empty(nets[0].Calls);
        Assert.Empty(nets[1].Calls);
    }

    /// <summary>Gate 1b-4, review finding 2: an UNSUPPORTED network whose line is replaced by trees under the same header
    /// (or emptied) was paired as an in-place rebuild that removed every item — content Volt never showed. Refused.</summary>
    [Theory]
    [InlineData("y := a;")]
    [InlineData("")]
    public void An_UNSUPPORTED_line_replaced_under_its_header_is_refused(string replacement)
    {
        var (impl, nets) = Live(PinFlagRung(), Rung("o1", "a"));
        var pushed = Pushed(impl, t => t.Replace("%NETWORK\n" + LineOf(t) + "\n",
                                                 "%NETWORK \"kept\"\n" + (replacement.Length > 0 ? replacement + "\n" : "")));
        var ex = Assert.Throws<NetworkTextException>(() => Write(impl, pushed));
        Assert.Equal(ConflictCodes.NetworkUnsupported, ex.Code);
        Assert.Contains("network 1", ex.Message);
        Assert.Empty(impl.Calls);
        Assert.Empty(nets[0].Calls);
    }

    /// <summary>Gate 1b-4, review finding 3: two networks shown as the same UNSUPPORTED line hold content the text does
    /// not tell apart; deleting one of them is refused rather than the tie-break picking which.</summary>
    [Fact]
    public void Deleting_one_of_two_identical_UNSUPPORTED_lines_is_refused()
    {
        var (impl, nets) = Live(PinFlagRung(), PinFlagRung());
        var pushed = Pushed(impl, t =>
        {
            var block = Net(LineOf(t));
            Assert.Equal("%LANGUAGE FBD\n" + block + block, t);
            return "%LANGUAGE FBD\n" + block;
        });
        var ex = Assert.Throws<NetworkTextException>(() => Write(impl, pushed));
        Assert.Contains("the same text", ex.Message);
        Assert.Empty(impl.Calls);
    }

    /// <summary>An UNSUPPORTED line that pairs with no live network — edited, or copied in as a new network — holds
    /// nothing to build from: refused by name, before the list changes.</summary>
    [Theory]
    [InlineData("a flag on an output pin")]
    [InlineData(null)]
    public void An_UNSUPPORTED_line_with_no_live_pair_is_refused(string? edited)
    {
        var (impl, nets) = Live(PinFlagRung(), Rung("o1", "a"));
        var pushed = Pushed(impl, t => edited is not null
            ? t.Replace("a coil flag on a pin", edited)
            : t + Net(LineOf(t)));

        var ex = Assert.Throws<NetworkTextException>(() => Write(impl, pushed));
        Assert.Equal(ConflictCodes.NetworkUnsupported, ex.Code);
        Assert.Empty(impl.Calls);
        Assert.Empty(nets[0].Calls);
    }
}
