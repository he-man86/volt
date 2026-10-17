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
/// openspec <c>ld-fbd-coverage</c> 2.3, the census shapes the text could not spell (tasks 0.1, design "1.1"): each is
/// written, read back to the model it came from (the model oracle), and its refusals stay by name — in the grammar of
/// <c>readability.md</c> (2R.3: S1's stored slot is lost on rebuild, B7; S3's types are the split's feeder's, B6). S4 is
/// <see cref="ShownPerNetworkTests"/>.
/// </summary>
public class NetworkShapeSpellingTests
{
    static readonly NetworkScope Scope = new(new[] { "a", "b", "c", "out", "x", "y", "go", "pt" }, Array.Empty<string>(),
        new Dictionary<string, string> { ["t1"] = "TON" });

    // ── S2: an assign below the top level ─────────────────────────────────────────────────────────

    /// <summary>Lenze <c>Dryer</c> #1: a coil drawn on a box's input pin — the Assign item is the TON's IN, and its value
    /// passes through to the pin.</summary>
    [Fact]
    public void S2_an_assign_below_the_top_level_is_an_assignment_in_its_own_pair()
    {
        var ton = Fb("t1", new[] { In(Set(L("go"), T("x")), "IN"), In(L("pt"), "PT") }, type: "TON");
        var model = Fbd1(ton);
        Assert.Equal(Src("t1(IN := (x := go), PT := pt);"), NetworkTextWriter.Write(model, Scope));
        Assert.Null(NetworkModelOracle.Check("S2 pin", model).Reason);
    }

    [Fact]
    public void S2_several_targets_and_the_coil_kinds_ride_in_the_pair()
    {
        var nested = new Assign(Op("AND", L("a"), L("b")), new[] { T("x"), T("y", SetBit), T("out", ResetBit) }, Flags.None);
        var model = Fbd1(Set(Call("MOVE", new[] { In(L("1")) }, en: nested, connected: 0, eno: true), T("c")));
        Assert.Equal(Src("MOVE 1 EN (x := y S= out R= a AND b)", "c := ENO;"), NetworkTextWriter.Write(model, Scope));
        Assert.Null(NetworkModelOracle.Check("S2 chain", model).Reason);
    }

    [Fact]
    public void S2_reads_back_as_one_assign_item_in_the_pin()
    {
        var read = NetworkTextReader.Read(Src("t1(IN := (x S= NOT a), PT := pt);"), Scope);
        Assert.True(read.Ok, string.Join("\n", read.Diagnostics.Select(d => d.Message)));
        var pin = Assert.IsType<Box>(read.Body!.Networks[0].Trees[0]).Inputs[0];
        var assign = Assert.IsType<Assign>(pin.Value);
        Assert.Equal(("x", true), (assign.Targets.Single().Text, assign.Targets.Single().Flags!.Set));
        Assert.True(Assert.IsType<Leaf>(assign.Value).Flags.Negated);
    }

    [Fact]
    public void A_comparison_on_a_variable_named_R_is_its_word()
    {
        var read = NetworkTextReader.Read(Src("out := R EQ x;"), new NetworkScope(new[] { "R", "x", "out" }, Array.Empty<string>(), new Dictionary<string, string>()));
        Assert.True(read.Ok, string.Join("\n", read.Diagnostics.Select(d => d.Message)));
        Assert.Equal("EQ", Assert.IsType<Box>(Assert.IsType<Assign>(read.Body!.Networks[0].Trees[0]).Value).Type);
    }

    [Theory]
    [InlineData("t1(IN := (split1 S= go), PT := pt);", "never a coil")]
    [InlineData("t1(IN := (x := go PT := pt);", "closes after its value")]
    public void S2_a_pair_the_text_cannot_read_is_refused_by_name(string statements, string why)
    {
        var read = NetworkTextReader.Read(Src(statements), Scope);
        Assert.False(read.Ok);
        Assert.Contains(why, read.Diagnostics.First().Message);
    }

    // ── S3: a split of unknown type (B6: no type is written) ───────────────────────────────────────

    /// <summary>S3a — WSM #10: a leaf feeding a split. B6: its type is the leaf's own, so the text writes none — the leaf's
    /// stored type is the push's derivation (lost on rebuild where it differs, B7), and a text read stores none.</summary>
    [Fact]
    public void S3a_a_leaf_fed_split_writes_no_type()
    {
        var model = Fbd1(Def(46, LT("stFeedForward", "BOOL")), Fb("t1", new[] { In(Ref(46), "IN"), In(L("pt"), "PT") }, type: "TON"));
        Assert.Equal(Src("split46 := stFeedForward;", "t1(IN := split46, PT := pt);"), NetworkTextWriter.Write(model, Scope));
        Assert.Null(NetworkModelOracle.Check("S3a", model).Reason);
        var read = NetworkTextReader.Read(Src("split1 := x;", "out := split1;"), Scope);
        Assert.Null(Assert.IsType<Leaf>(Assert.IsType<Demux>(read.Body!.Networks[0].Trees[0]).Input).Operand.Type);
    }

    /// <summary>S3b — GeneralProgramFlags #4–#7: in LD a split fed by nothing is fed by the left rail — `split2 := ;`. With
    /// no type to write (B6), FBD's split fed by nothing is that text too.</summary>
    [Fact]
    public void S3b_a_rail_fed_split_is_its_empty_feed_in_LD_and_FBD_alike()
    {
        var ton = Fb("t1", new[] { In(Op("AND", Ref(2), L("a")), "IN"), In(L("pt"), "PT") }, type: "TON")
            with { ConnectedSlot = 0, MainOutputIndex = 0, HasEnoOutput = false };
        Node[] trees = { Def(2, Empty), Set(ton, T("out")) };
        var ld = Ld1(trees);
        Assert.Equal(LdSrc("split2 := ;", "out := t1(IN := split2 AND a, PT := pt);"),
            NetworkTextWriter.Write(ld, Scope));
        Assert.Null(NetworkModelOracle.Check("S3b", ld).Reason);
        Assert.Null(NetworkModelOracle.Check("S3b FBD", Fbd1(trees)).Reason);
    }

    // ── S5: a SUPER^ call ──────────────────────────────────────────────────────────────────────────

    /// <summary>S5 — ATD_TorqueControl #0: a derived FB calling its base through <c>SUPER^</c> — an instance no declaration
    /// names, whose type is the POU's EXTENDS (the scope's <c>StDeclaration.TypeOfCallTarget</c>).</summary>
    [Fact]
    public void S5_a_SUPER_call_is_the_backticked_instance_of_the_base()
    {
        var scope = NetworkScope.FromDeclarations("FUNCTION_BLOCK ATD_TorqueControl EXTENDS ATD_FQI\nVAR\n  ioAxis : INT;\nEND_VAR",
            _ => null, () => Array.Empty<string>(), _ => null, _ => false, _ => null);
        var call = Fb("SUPER^", new[] { In(L("ioAxis"), "ioAxis") }, type: "ATD_FQI");
        Assert.Equal(Src("`SUPER^`(ioAxis := ioAxis);"), NetworkTextWriter.Write(Fbd1(call), scope));
        var read = NetworkTextReader.Read(Src("`SUPER^`(ioAxis := ioAxis);"), scope);
        Assert.True(read.Ok, string.Join("\n", read.Diagnostics.Select(d => d.Message)));
        var box = Assert.IsType<Box>(read.Body!.Networks[0].Trees[0]);
        Assert.Equal(("ATD_FQI", "SUPER^", CallKind.FunctionBlock), (box.Type, box.Instance!.Text, box.Kind));
        // Without an EXTENDS there is no base to call: refused by name, as before.
        Assert.Equal("an FB instance the declarations do not name",
            Assert.ThrowsAny<UnrepresentableBodyException>(() => NetworkTextWriter.Write(Fbd1(call), Scope)).Reason);
    }

    /// <summary>A jump is a coil, and a coil nests (2R.5): a jump below the top level is written where it stands.</summary>
    [Fact]
    public void A_jump_below_the_top_level_is_a_nested_coil()
    {
        var jump = new Assign(L("a"), new[] { T("Done", JumpBit) }, JumpBit);
        var model = Fbd1(Fb("t1", new[] { In(jump, "IN") }, type: "TON"));
        var text = NetworkTextWriter.Write(model, Scope);
        Assert.Contains("t1(IN := (JMP Done := a));", text);
        Assert.True(NetworkTextReader.Read(text, Scope).Ok);
    }
}
