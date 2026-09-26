using System;
using System.Collections.Generic;
using System.Linq;
using Xunit;
using Volt.Engine.Format.Network;
using static Volt.Engine.Tests.NetworkModels;

namespace Volt.Engine.Tests;

/// <summary>
/// The convergence and real-project shapes of network text, in the v2 spelling (task 3.7: "convergence cases
/// rewritten to v2 input"). Each input is the v2 text for the SAME NWL shape its v1 case pinned — the v1 form
/// (<c>LET i</c> hoists, the <c>IF en</c> echo, <c>NETWORK 0 LD</c> headers) is refused now and has no fixed
/// point to converge to. Where a v1 case pinned a split-only spelling, its model and v2 text are pinned in
/// <see cref="SplitShapeGoldensTests"/> instead; each case below says which.
///
/// <para><b>Canonical, not merely convergent.</b> v1 asserted <c>Round(Round(x)) == Round(x)</c> because its
/// canonical form minted names the author could not predict. v2 mints none, so each input here IS the canonical
/// text: the gate accepts it (<c>Tokens(Write(Read(x))) == Tokens(x)</c>) and the writer gives back the same
/// bytes.</para>
///
/// <para><b>The scope is built from a declaration</b> (<see cref="NetworkScope.FromDeclarations"/>, task 3.9), the
/// way a driver builds it: <c>t1</c> is an instance because <c>t1 : TON</c> says so, not because a test listed it.</para>
/// </summary>
public class NetworkTextRoundTripTests
{
    const string Declaration = @"PROGRAM P
VAR
    t1 : TON;
    ctu : CTU;
    fb : FB_Sample;
    Config : FB_Config;
END_VAR";

    static readonly NetworkScope Scope =
        NetworkScope.FromDeclarations(Declaration, _ => null, () => Array.Empty<string>());

    static void Canonical(string text, BodyLanguage lang)
    {
        var r = NetworkTextGate.Validate(text, lang, Scope);
        Assert.True(r.Ok, string.Join("\n", r.Diagnostics.Select(d => $"{d.Line}:{d.Column} {d.Code} {d.Message}")));
        Assert.Equal(text, NetworkTextWriter.Write(r.Body!, Scope));
    }

    static string F(params string[] lines) => Src(lines);
    static string Ld(params string[] lines) => LdSrc(lines);

    /// <summary>The v1 convergence theory's shapes, each as the one v2 text it now has.</summary>
    public static TheoryData<string, string> Converging() => new()
    {
        // FB call with named literal pins: v1 hoisted each literal to `LET i`.
        { "fb-literal-pins", F("Config(xFASTSystemInTaskMidPrio := FALSE, xLogErrorTypeInformation := TRUE, xLogErrorTypeWarning := TRUE);") },
        // Nested groups: v1 hoisted each operand and named each group.
        { "nested-groups", F("result := ((A AND B) OR C);") },
        // An FB call and the reads of its outputs, three items.
        { "fb-call-and-its-outputs", F("t1(IN := start, PT := pt);", "running := t1.Q;", "elapsed := t1.ET;") },
        { "title", Src("out := (a OR b);").Replace("*)\nNETWORK\n", "*)\nNETWORK TITLE: \"my title\"\n") },
        { "ld-group", Ld("out := (a AND b);") },
        { "negated-operand", F("out := (NOT a AND b);") },
        // v1 `t1(CLK := i1 RISING)`: the edge is a flag on the operand.
        { "edge-on-a-pin", F("t1(CLK := R_EDGE(clk));") },
        { "set-coil", F("out S= (a OR b);") },
        { "reset-coil", F("out R= (a OR b);") },
        // v1 `LET g1` feeding three coils: ONE Assign with three targets, a chain.
        { "one-value-three-coils", F("plain :=", "latched S=", "cleared R= (a OR b);") },
        { "negated-pin-operand", F("fb(IN := NOT x);") },
        { "move-assign", F("dst := MOVE(src);") },
        { "named-output-of-a-function", F("fc_MeanValue(20, oMeanValue => measured);") },
        { "named-output-of-an-fb", F("t1(IN := a, PT := pt, ET => elapsed);") },
        { "consumed-function-with-named-output", F("dst := f(src, oErr => err);") },
        // v1 `IF en1 THEN dst := MOVE(src); END_IF`: an enabled MOVE writing its own result pin.
        { "enabled-move-result-pin", Ld("MOVE(EN := rung, src, => dst);") },
        // …with the rung continuing from its ENO into a coil (v1 `coil := en1`), one item.
        { "enabled-move-continuing-into-a-coil", Ld("coil := MOVE(EN := rung, src, => dst).ENO;") },
        { "enabled-move-continuing-into-a-set-coil", Ld("latched S= MOVE(EN := rung, src, => dst).ENO;") },
        { "enabled-move-continuing-into-two-coils", Ld("a :=", "b S= MOVE(EN := rung, src, => dst).ENO;") },
        // v1 `LET i1 := NOT x; fb(IN := i1);`: the negation on the operand.
        { "negated-operand-into-a-pin", F("fb(IN := NOT x);") },
        { "empty-network", F() },
        { "label-only", Src().Replace("*)\nNETWORK\n", "*)\nNETWORK LABEL: myLabel\n") },
        { "jump", F("JMP myLabel;") },
        { "conditional-jump", F("IF cond THEN JMP myLabel; END_IF;") },
        { "negated-conditional-jump", F("IF NOT cond THEN JMP myLabel; END_IF;") },
        { "return", F("RETURN;") },
        { "conditional-return", F("IF done THEN RETURN; END_IF;") },
        // The en-chain InlineData (v1 L56-67) is pinned by model in SplitShapeGoldensTests ("RoundTrip.en/*").
    };

    [Theory]
    [MemberData(nameof(Converging))]
    public void Network_text_is_canonical(string name, string text)
    {
        _ = name;
        Canonical(text, text.StartsWith(LdMarker, StringComparison.Ordinal) ? BodyLanguage.Ld : BodyLanguage.Fbd);
    }

    /// <summary>The shapes a real project contains (Lenze_MID-S100: 152 of 373 networks were once pulled as text
    /// Volt's own reader refused), in v2. Each is exact canonical text.</summary>
    public static TheoryData<string, string> RealProjectShapes() => new()
    {
        // AN UNCONNECTED PIN is an empty slot and reads back as the terminator the vendor holds; `???` is the
        // vendor's own marker for an unfilled slot and is CONTENT, never a spelling of "unconnected".
        { "empty-first-slot-of-a-MUL", Ld("( * iRPM * 6);") },
        { "named-pins-with-nothing-on-them", F("ctu(CU := a, RESET := , PV := );") },
        { "a-leading-positional-slot", F("f(, a);") },
        { "a-trailing-positional-slot", F("f(a, );") },
        { "a-rung-nothing-drives", Ld("coil := ;") },
        { "an-item-wired-to-nothing", Ld(";") },
        // AN UNNAMED INSTANCE CARRIES ITS TYPE (`??? : TYPE`).
        { "unnamed-instance", F("??? : L_TT1P_FlexCamBase(xEnable := , Axis := );") },
        { "unnamed-instance-and-marker-target", F("??? : TON(IN := a, PT := t);", "??? := ioAxis.xVirtual;") },
        { "marker-in-a-group", F("out := (??? AND a);") },
        { "marker-on-a-named-pin", F("t1(IN := ???, PT := pt);") },
        { "marker-as-a-coil", Ld("??? := a;") },
        // v1 `IF en1 THEN ??? := NOT(a); END_IF` behind an unconnected enable: the NOT box with EN shown, unwired.
        { "marker-behind-an-unconnected-enable", Ld("??? := NOT(EN := , a);") },
        // A POSITIONAL CALL STANDS ALONE (34 networks).
        { "a-call-standing-alone", Ld("MOVE(a, b);") },
        // A NOT BOX IS NOT THE NEGATION MODIFIER: parentheses decide.
        { "the-NOT-box", F("out := NOT(a);") },
        { "the-NOT-modifier", F("out := NOT a;") },
        // A QUOTE IN A TITLE is ST's `$"`.
        { "a-quote-in-a-title", Ld("out := a;").Replace("*)\nNETWORK\n", "*)\nNETWORK TITLE: \"Muting of alarm $\"No bunch$\"\"\n") },
        // A DOTTED NAME AN ENGINEER SPACED OUT is one operand, verbatim between backticks.
        { "a-spaced-dotted-name", F("out := `scSimulationDowntimes .uiMaxSimulationEvents`;") },
        // A COMMENT THEY INDENTED: `//` and one space are syntax, the rest is text.
        { "an-indented-comment", F("out := a;").Replace("*)\nNETWORK\n", "*)\nNETWORK\n  //     indented on purpose\n") },
        // DISABLED IN A TITLE is text, not the header keyword.
        { "DISABLED-in-a-title", Ld("out := a;").Replace("*)\nNETWORK\n", "*)\nNETWORK TITLE: \"DISABLED during commissioning\"\n") },
        // The IDE's own header layout: label, title, then the comment lines.
        { "label-title-and-comment", Ld("out := (a AND b);").Replace("*)\nNETWORK\n",
            "*)\nNETWORK LABEL: Guard TITLE: \"interlock\"\n  // holds the drive off while the guard is open\n  // second line of the same comment\n") },
        // A single-consumer wire (v1 L139) and an opaque leaf (v1 L144): SplitShapeGoldensTests, by model.
    };

    [Theory]
    [MemberData(nameof(RealProjectShapes))]
    public void A_real_projects_shapes_round_trip_byte_for_byte(string name, string text)
    {
        _ = name;
        Canonical(text, text.StartsWith(LdMarker, StringComparison.Ordinal) ? BodyLanguage.Ld : BodyLanguage.Fbd);
    }

    /// <summary>A RUNG WITH NOTHING ON IT reads back as the TERMINATOR the vendor holds, not as a null: a null would
    /// make the in-place archive writer refuse the RValue as removed and lose the rung (census 1.2: the empty
    /// terminator is the one "unconnected").</summary>
    [Fact]
    public void An_empty_right_hand_side_is_a_rung_with_nothing_on_it()
    {
        var text = Ld("coil := ;");

        var r = NetworkTextGate.Validate(text, BodyLanguage.Ld, Scope);

        Assert.True(r.Ok);
        var assign = Assert.IsType<Assign>(r.Body!.Networks.Single().Trees.Single());
        Assert.Equal(new[] { "coil" }, assign.Targets.Select(t => t.Text));
        Assert.IsType<Terminator>(assign.Value);
    }
}
