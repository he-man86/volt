using System;
using System.IO;
using Xunit;
using Volt.Engine.Format.Network;
using Volt.Engine.PlcOpen;

namespace Volt.Cli.Tests;

/// <summary>
/// Ground-truth over REAL TwinCAT PLCopenXML, captured live from TcXaeShell via
/// ITcPlcIECProject.PlcOpenExport (fixtures/tc-fbd/PLC_PRG.plcopen.xml). Confirms TwinCAT's export
/// (which uses the SAME 3S/CODESYS addData extensions) flows through the shared CODESYS pipeline —
/// GraphReader → NetworkTextWriter — and that GraphWriter re-emits the vendor fbdcalltype on the way back.
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
        var ld = TestPlcOpen.FindOnlyGraphicalBody(LdTonFixture());
        Assert.NotNull(ld);
        var net = NetworkTextWriter.Write(GraphReader.ReadBody(ld!));
        Assert.Contains("T1(IN :=", net);            // the TON FB call is read
        Assert.Contains("done := T1.Q", net);         // boolean output Q → coil
        Assert.Contains("elapsed := T1.ET", net);     // the embedded non-boolean output assignment survives
    }

    [Fact]
    public void Real_TC_FBD_with_TON_reads_the_embedded_output_assignment()
    {
        // TwinCAT embeds a non-boolean block output (a timer's ET) as an <expression> in its pin in FBD too —
        // the boolean Q is a separate <outVariable>. The FBD reader read output NAMES only and DROPPED the
        // embedded assignment (the same data-loss bug LD had, found by probing the live round-trip). Captured
        // live; must surface `elapsed := t1.ET`.
        var fbd = TestPlcOpen.FindOnlyGraphicalBody(File.ReadAllText(
            Path.Combine(AppContext.BaseDirectory, "fixtures", "tc-fbd", "fbd_ton_embedded_output.plcopen.xml")))!;
        var net = NetworkTextWriter.Write(GraphReader.ReadBody(fbd));
        Assert.Contains("t1(IN :=", net);              // the TON FB call
        Assert.Contains("done := t1.Q", net);           // boolean output → separate outVariable
        Assert.Contains("elapsed := t1.ET", net);       // non-boolean output embedded in the pin — must survive
    }

    [Fact]
    public void Real_TC_LD_with_four_networks_splits_on_the_networktitle_markers()
    {
        // TC brackets a multi-network LD with ONE shared left/right power rail and delimits each network with a
        // vendorElement(networktitle) — it does NOT stride localIds. The reader must split on the markers. This
        // user-authored fixture is four single-rung networks all hanging off the one shared rail (localIds 0-16).
        var ld = TestPlcOpen.FindOnlyGraphicalBody(File.ReadAllText(
            Path.Combine(AppContext.BaseDirectory, "fixtures", "tc-ld", "ld_four_networks_shared_rails.plcopen.xml")))!;
        var body = GraphReader.ReadBody(ld);
        Assert.Equal(4, body.Networks.Count);
    }


    [Fact]
    public void Real_network_with_sr_negation_edge_branch_jump_label_reads_to_valid_st()
    {
        var fbd = TestPlcOpen.FindOnlyGraphicalBody(JumpFixture());
        Assert.NotNull(fbd);
        var net = NetworkTextWriter.Write(GraphReader.ReadBody(fbd!));

        Assert.Contains("SR_0(SET1 := NOT xtest, RESET := xtestr1 RISING)", net);  // SR FB + inlined operands + negation + edge
        Assert.Contains("out := SR_0.Q1", net);                                    // branch / fan-out...
        Assert.Contains("out2 := SR_0.Q1", net);                                   // ...same output, two sinks
        Assert.Contains("IF adfdsa THEN JMP jump12; END_IF", net);                 // conditional jump, inlined condition (valid ST)
        Assert.Contains("jump12:", net);                                           // label (valid ST)
    }

    [Fact]
    public void Real_jump_network_round_trips_through_plcopen()
    {
        var fbd = TestPlcOpen.FindOnlyGraphicalBody(JumpFixture())!;
        var g1 = GraphReader.ReadBody(fbd);
        var net1 = NetworkTextWriter.Write(g1);

        var xml2 = GraphWriter.WriteBody(g1).ToString();
        Assert.Contains("<jump", xml2);
        Assert.Contains("<label", xml2);
        Assert.Contains("negated=\"true\"", xml2);
        Assert.Contains("edge=\"rising\"", xml2);

        Assert.Equal(net1, GraphRoundTrip.ToNetworkText(g1));  // fixed point
    }

    [Fact]
    public void TwinCAT_plcopen_reads_through_the_shared_pipeline_to_VG()
    {
        var fbd = TestPlcOpen.FindOnlyGraphicalBody(Fixture());
        Assert.NotNull(fbd);
        var net = NetworkTextWriter.Write(GraphReader.ReadBody(fbd!));

        Assert.Matches(@"NETWORK \d+ FBD", net);   // language rides on the network marker
        // Literal operands are inlined into the operator statement (e.g. `xtest := (FALSE AND TRUE);`).
        Assert.Contains("FALSE", net);
        Assert.Contains("TRUE", net);
        Assert.Contains(" AND ", net);
        Assert.Contains(" OR ", net);
        foreach (var target in new[] { "xtest", "xtest1", "xtest3" })
            Assert.Contains(target, net);
    }

    [Fact]
    public void Networks_are_split_by_localId_index()
    {
        var body = GraphReader.ReadBody(TestPlcOpen.FindOnlyGraphicalBody(Fixture())!);
        Assert.Equal(3, body.Networks.Count);   // PLC_PRG's action is three FBD networks

        var net = NetworkTextWriter.Write(body);
        // one "NETWORK <n> <LANG>" header per network (don't count the END_NETWORK terminators)
        Assert.Equal(3, System.Text.RegularExpressions.Regex.Matches(net, @"(?m)^NETWORK \d").Count);

        // Each network is independent: its target carries its own inlined operator expression (valid ST),
        // never a `g1.Out1` pin suffix.
        Assert.Contains("xtest := (FALSE AND TRUE);", net);
        Assert.Contains("xtest1 := (TRUE AND TRUE);", net);
        Assert.Contains("xtest3 := (FALSE OR TRUE);", net);
        Assert.DoesNotContain(".Out1", net);
    }

    [Fact]
    public void Write_back_re_emits_the_vendor_fbdcalltype()
    {
        var fbd = TestPlcOpen.FindOnlyGraphicalBody(Fixture())!;
        var graph = GraphReader.ReadBody(fbd);

        var rewritten = GraphWriter.WriteBody(graph).ToString();

        // The operator boxes' CallType ("operator") must survive read → graph → write,
        // matching what TwinCAT/CODESYS export (so re-import keeps the vendor metadata).
        Assert.Contains("fbdcalltype", rewritten);
        Assert.Contains("operator", rewritten);
    }
}
