using System;
using System.IO;
using Volt.Bridge.Core.Graphical;
using Volt.Bridge.Core.Graphical.Vg;
using Xunit;

namespace Volt.Bridge.Tests;

/// <summary>
/// Ground-truth over REAL TwinCAT PLCopenXML, captured live from TcXaeShell via
/// ITcPlcIECProject.PlcOpenExport (fixtures/tc-fbd/PLC_PRG.plcopen.xml). Confirms TwinCAT's export
/// (which uses the SAME 3S/CODESYS addData extensions) flows through the shared CODESYS pipeline —
/// PlcOpenReader → VgWriter — and that PlcOpenWriter re-emits the vendor fbdcalltype on the way back.
/// </summary>
public class PlcOpenTcFixtureTests
{
    private static string Fixture() => File.ReadAllText(
        Path.Combine(AppContext.BaseDirectory, "fixtures", "tc-fbd", "PLC_PRG.plcopen.xml"));

    private static string JumpFixture() => File.ReadAllText(
        Path.Combine(AppContext.BaseDirectory, "fixtures", "tc-fbd", "PLC_PRG_jump_sr.plcopen.xml"));

    private static string LdTonFixture() => File.ReadAllText(
        Path.Combine(AppContext.BaseDirectory, "fixtures", "tc-ld", "ld_ton_rung_two_networks.plcopen.xml"));

    [Fact]
    public void Real_TC_LD_with_TON_reads_the_embedded_output_assignment()
    {
        // Real TwinCAT LD ground truth: a TON rung with a non-boolean ET output assigned via an <expression>
        // EMBEDDED in the block's output pin. The reader used to read output-pin NAMES only and silently DROP
        // this assignment (real data loss); it must now surface `elapsed := T1.ET`.
        var ld = PlcOpenDocument.FindFbdLdBody(LdTonFixture());
        Assert.NotNull(ld);
        var vg = VgWriter.Write(PlcOpenReader.ReadBody(ld!));
        Assert.Contains("T1(IN :=", vg);            // the TON FB call is read
        Assert.Contains("done := T1.Q", vg);         // boolean output Q → coil
        Assert.Contains("elapsed := T1.ET", vg);     // the embedded non-boolean output assignment survives
    }

    [Fact]
    public void Real_TC_FBD_with_TON_reads_the_embedded_output_assignment()
    {
        // TwinCAT embeds a non-boolean block output (a timer's ET) as an <expression> in its pin in FBD too —
        // the boolean Q is a separate <outVariable>. The FBD reader read output NAMES only and DROPPED the
        // embedded assignment (the same data-loss bug LD had, found by probing the live round-trip). Captured
        // live; must surface `elapsed := t1.ET`.
        var fbd = PlcOpenDocument.FindFbdLdBody(File.ReadAllText(
            Path.Combine(AppContext.BaseDirectory, "fixtures", "tc-fbd", "fbd_ton_embedded_output.plcopen.xml")))!;
        var vg = VgWriter.Write(PlcOpenReader.ReadBody(fbd));
        Assert.Contains("t1(IN :=", vg);              // the TON FB call
        Assert.Contains("done := t1.Q", vg);           // boolean output → separate outVariable
        Assert.Contains("elapsed := t1.ET", vg);       // non-boolean output embedded in the pin — must survive
    }


    [Fact]
    public void Real_network_with_sr_negation_edge_branch_jump_label_reads_to_valid_st()
    {
        var fbd = PlcOpenDocument.FindFbdLdBody(JumpFixture());
        Assert.NotNull(fbd);
        var vg = VgWriter.Write(PlcOpenReader.ReadBody(fbd!));

        Assert.Contains("i1 := xtest;", vg);                                      // operands are named leaves
        Assert.Contains("i2 := xtestr1;", vg);
        Assert.Contains("SR_0(SET1 := NOT i1, RESET := i2 RISING)", vg);          // SR FB + negation + edge
        Assert.Contains("out := SR_0.Q1", vg);                                    // branch / fan-out...
        Assert.Contains("out2 := SR_0.Q1", vg);                                   // ...same output, two sinks
        Assert.Contains("i1 := adfdsa;", vg);                                     // jump condition is a named leaf
        Assert.Contains("IF i1 THEN JMP jump12; END_IF", vg);                     // conditional jump (valid ST)
        Assert.Contains("jump12:", vg);                                           // label (valid ST)
    }

    [Fact]
    public void Real_jump_network_round_trips_through_plcopen()
    {
        var fbd = PlcOpenDocument.FindFbdLdBody(JumpFixture())!;
        var g1 = PlcOpenReader.ReadBody(fbd);
        var vg1 = VgWriter.Write(g1);

        var xml2 = PlcOpenWriter.WriteBody(g1).ToString();
        Assert.Contains("<jump", xml2);
        Assert.Contains("<label", xml2);
        Assert.Contains("negated=\"true\"", xml2);
        Assert.Contains("edge=\"rising\"", xml2);

        Assert.Equal(vg1, VgWriter.Write(PlcOpenReader.ReadBody(PlcOpenWriter.WriteBody(g1))));  // fixed point
    }

    [Fact]
    public void TwinCAT_plcopen_reads_through_the_shared_pipeline_to_VG()
    {
        var fbd = PlcOpenDocument.FindFbdLdBody(Fixture());
        Assert.NotNull(fbd);
        var vg = VgWriter.Write(PlcOpenReader.ReadBody(fbd!));

        Assert.Matches(@"NETWORK \d+ FBD", vg);   // language rides on the network marker
        // Literals are now named leaves (i* := FALSE/TRUE), combined by a single operator per statement.
        Assert.Contains(":= FALSE;", vg);
        Assert.Contains(":= TRUE;", vg);
        Assert.Contains(" AND ", vg);
        Assert.Contains(" OR ", vg);
        foreach (var target in new[] { "xtest", "xtest1", "xtest3" })
            Assert.Contains(target, vg);
    }

    [Fact]
    public void Networks_are_split_by_localId_index()
    {
        var body = PlcOpenReader.ReadBody(PlcOpenDocument.FindFbdLdBody(Fixture())!);
        Assert.Equal(3, body.Networks.Count);   // PLC_PRG's action is three FBD networks

        var vg = VgWriter.Write(body);
        // one "NETWORK <n> <LANG>" header per network (don't count the END_NETWORK terminators)
        Assert.Equal(3, System.Text.RegularExpressions.Regex.Matches(vg, @"(?m)^NETWORK \d").Count);

        // Each network is independent: its target sits with its own gate (gates renumber per network).
        // The gate is an operator → its result is referenced directly (valid ST), not `g1.Out1`.
        Assert.Contains("xtest := g1;", vg);
        Assert.Contains("xtest1 := g1;", vg);
        Assert.Contains("xtest3 := g1;", vg);
    }

    [Fact]
    public void Write_back_re_emits_the_vendor_fbdcalltype()
    {
        var fbd = PlcOpenDocument.FindFbdLdBody(Fixture())!;
        var graph = PlcOpenReader.ReadBody(fbd);

        var rewritten = PlcOpenWriter.WriteBody(graph).ToString();

        // The operator boxes' CallType ("operator") must survive read → graph → write,
        // matching what TwinCAT/CODESYS export (so re-import keeps the vendor metadata).
        Assert.Contains("fbdcalltype", rewritten);
        Assert.Contains("operator", rewritten);
    }
}
