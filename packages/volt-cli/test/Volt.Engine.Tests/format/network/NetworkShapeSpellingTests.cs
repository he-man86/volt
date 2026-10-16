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
/// written, read back to the model it came from (the model oracle), and its refusals stay by name. S1 and the pragma are
/// <see cref="NetworkPragmaTests"/>; S4 is <see cref="ShownPerNetworkTests"/>.
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
        Assert.Equal(Src("c := MOVE(EN := (x := y S= out R= (a AND b)), 1).ENO;"), NetworkTextWriter.Write(model, Scope));
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
    public void A_comparison_on_a_variable_named_R_stays_a_group()
    {
        var read = NetworkTextReader.Read(Src("out := (R = x);"), new NetworkScope(new[] { "R", "x", "out" }, Array.Empty<string>(), new Dictionary<string, string>()));
        Assert.True(read.Ok, string.Join("\n", read.Diagnostics.Select(d => d.Message)));
        Assert.Equal("EQ", Assert.IsType<Box>(Assert.IsType<Assign>(read.Body!.Networks[0].Trees[0]).Value).Type);
    }

    [Theory]
    [InlineData("VAR_TEMP g1 : BOOL; END_VAR\n  t1(IN := (g1 := go), PT := pt);\n  out := g1;", "is defined inside an assignment's pair")]
    [InlineData("t1(IN := (x := go PT := pt);", "closes after its value")]
    public void S2_a_pair_the_text_cannot_read_is_refused_by_name(string statements, string why)
    {
        var read = NetworkTextReader.Read(Src(statements), Scope);
        Assert.False(read.Ok);
        Assert.Contains(why, read.Diagnostics.First().Message);
    }

    // ── S3: a wire of unknown type ─────────────────────────────────────────────────────────────────

    /// <summary>S3a — WSM #10: a leaf feeding a wire is declared with the type the IDE-drawn leaf stores, read back onto the
    /// leaf (vendor-facts <c>nwl-leaf-wire-type</c>); its uses play no part (task 1.17's guess, deleted).</summary>
    [Fact]
    public void S3a_a_leaf_fed_wire_is_declared_with_the_leafs_stored_type()
    {
        var model = Fbd1(Def(46, LT("stFeedForward", "BOOL")), Fb("t1", new[] { In(Ref(46), "IN"), In(L("pt"), "PT") }, type: "TON"));
        Assert.Equal(Src("VAR_TEMP g46 : BOOL; END_VAR", "g46 := stFeedForward;", "t1(IN := g46, PT := pt);"), NetworkTextWriter.Write(model, Scope));
        Assert.Null(NetworkModelOracle.Check("S3a", model).Reason);
        var read = NetworkTextReader.Read(Src("VAR_TEMP g1 : INT; END_VAR", "g1 := x;", "out := g1;"), Scope);
        Assert.Equal("INT", Assert.IsType<Leaf>(Assert.IsType<Demux>(read.Body!.Networks[0].Trees[0]).Input).Operand.Type);
    }

    /// <summary>S3b — GeneralProgramFlags #4–#7: in LD a wire fed by nothing is fed by the left rail, a BOOL — `g := ;`.
    /// In FBD there is no rail: refused by name.</summary>
    [Fact]
    public void S3b_a_rail_fed_wire_is_BOOL_in_LD_and_refused_in_FBD()
    {
        var ton = Fb("t1", new[] { In(Op("AND", Ref(2), L("a")), "IN"), In(L("pt"), "PT") }, type: "TON")
            with { ConnectedSlot = 0, MainOutputIndex = 0, HasEnoOutput = false };
        Node[] trees = { Def(2, Empty), Set(ton, T("out")) };
        var ld = Ld1(trees);
        Assert.Equal(LdSrc("VAR_TEMP g2 : BOOL; END_VAR", "g2 := ;", "out := t1(IN := (g2 AND a), PT := pt);"),
            NetworkTextWriter.Write(ld, Scope));
        Assert.Null(NetworkModelOracle.Check("S3b", ld).Reason);
        Assert.Equal("a wire fed by the empty terminator in FBD",
            Assert.ThrowsAny<UnrepresentableBodyException>(() => NetworkTextWriter.Write(Fbd1(trees), Scope)).Reason);
    }

    // ── S5: a SUPER^ call ──────────────────────────────────────────────────────────────────────────

    /// <summary>S5 — ATD_TorqueControl #0: a derived FB calling its base through <c>SUPER^</c> — an instance no declaration
    /// names, whose type is the POU's EXTENDS (the scope's <c>StDeclaration.TypeOfCallTarget</c>).</summary>
    [Fact]
    public void S5_a_SUPER_call_is_the_backticked_instance_of_the_base()
    {
        var scope = NetworkScope.FromDeclarations("FUNCTION_BLOCK ATD_TorqueControl EXTENDS ATD_FQI\nVAR\n  ioAxis : INT;\nEND_VAR",
            _ => null, () => Array.Empty<string>(), _ => null, _ => false);
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

    [Fact]
    public void A_jump_below_the_top_level_stays_refused_by_name()
    {
        var jump = new Assign(L("a"), new[] { T("Done", JumpBit) }, JumpBit);
        var model = Fbd1(Fb("t1", new[] { In(jump, "IN") }, type: "TON"));
        Assert.Equal("a jump or return below the top level",
            Assert.ThrowsAny<UnrepresentableBodyException>(() => NetworkTextWriter.Write(model, Scope)).Reason);
    }
}
