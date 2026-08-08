using System;
using System.IO;
using System.Xml.Linq;
using Volt.Engine.Body;
using Xunit;

namespace Volt.Cli.Tests;

public class EnEnoTests
{
    private static string Fixture() => File.ReadAllText(
        Path.Combine(AppContext.BaseDirectory, "fixtures", "tc-fbd", "fbd_en_eno.plcopen.xml"));

    [Fact]
    public void EnEno_reads_as_IF_parses_back_and_is_a_fixed_point()
    {
        var g0 = GraphReader.ReadBody(TestPlcOpen.FindOnlyGraphicalBody(Fixture())!);
        var vg0 = NetworkTextWriter.Write(g0);

        // NetworkTextReader is the exact inverse of NetworkTextWriter (the VG-text fixed point).
        var vg1 = NetworkTextWriter.Write(NetworkTextReader.Parse(vg0));
        // And the parsed graph survives a full PLCopen round-trip (the convergence the push-gate checks).
        var vg2 = GraphRoundTrip.ToVg(NetworkTextReader.Parse(vg0));

        File.WriteAllText(Path.Combine(Path.GetTempPath(), "eneno_rt.txt"),
            "=== vg0 (read) ===\n" + vg0 + "\n=== vg1 (parse→write) ===\n" + vg1 + "\n=== vg2 (parse→plcopen→write) ===\n" + vg2);
        Assert.Equal(vg0, vg1);
        Assert.Equal(vg0, vg2);
    }

    [Fact]
    public void Pushing_over_an_existing_EnEno_body_is_not_refused_as_multi_output()
    {
        // An EN/ENO box is stateless with ENO + its value output. The "stateless function with multiple outputs"
        // guard (GraphSplice.ValidateExisting) must NOT count ENO, or overwriting an existing EN/ENO body is
        // wrongly refused. Found LIVE on TwinCAT: the create slipped through (no existing body), the re-push hit it.
        var fbd = TestPlcOpen.FindOnlyGraphicalBody(Fixture())!;
        var ns = fbd.Name.Namespace;
        var miniDoc = new XElement(ns + "pou", new XAttribute("name", "P"),
            new XElement(ns + "body", new XElement(fbd))).ToString();
        var newBody = GraphWriter.WriteBody(GraphReader.ReadBody(fbd));
        var spliced = TestPlcOpen.SpliceOnlyGraphicalBody(miniDoc, newBody);   // must not throw
        Assert.Contains("ENO", spliced);
    }

    [Fact]
    public void Unconnected_EN_is_dropped_so_the_box_renders_as_a_plain_call()
    {
        // A function box whose EN input is UNCONNECTED (PLCopen `refLocalId=0`) is unconditionally enabled — it
        // must render as a plain call, NOT `LET en := ; IF en THEN …` (an empty producer = malformed VG). Verified
        // live on the Lenze LD project (Alarms_V5_1_100 with EN → refLocalId 0).
        var doc =
            "<project xmlns=\"http://www.plcopen.org/xml/tc6_0200\"><types><pous><pou name=\"p\" pouType=\"program\"><body><FBD>" +
            "<inVariable localId=\"1\"><connectionPointOut/><expression>x</expression></inVariable>" +
            "<block localId=\"2\" typeName=\"FC_Do\"><inputVariables>" +
            "<variable formalParameter=\"EN\"><connectionPointIn><connection refLocalId=\"0\"/></connectionPointIn></variable>" +
            "<variable formalParameter=\"IN\"><connectionPointIn><connection refLocalId=\"1\"/></connectionPointIn></variable>" +
            "</inputVariables><inOutVariables/>" +
            "<outputVariables><variable formalParameter=\"OUT\"><connectionPointOut/></variable></outputVariables>" +
            "<addData><data name=\"http://www.3s-software.com/plcopenxml/fbdcalltype\"><CallType>function</CallType></data></addData>" +
            "</block>" +
            "<outVariable localId=\"3\"><connectionPointIn><connection refLocalId=\"2\" formalParameter=\"OUT\"/></connectionPointIn><expression>y</expression></outVariable>" +
            "</FBD></body></pou></pous></types></project>";
        var vg = NetworkTextWriter.Write(GraphReader.ReadBody(TestPlcOpen.FindOnlyGraphicalBody(doc)!));
        File.WriteAllText(Path.Combine(Path.GetTempPath(), "unconnected_en.txt"), vg);
        Assert.DoesNotContain("LET en", vg);   // no empty/broken EN wire
        Assert.DoesNotContain("IF en", vg);    // not EN-guarded
        Assert.Contains("FC_Do(", vg);         // rendered as a plain call
        Assert.Equal(vg, NetworkTextWriter.Write(NetworkTextReader.Parse(vg)));            // VG-text fixed point
        Assert.Equal(vg, GraphRoundTrip.ToVg(NetworkTextReader.Parse(vg)));   // PLCopen convergence
    }

    [Fact]
    public void Unconnected_EN_in_an_LD_body_is_dropped_too()
    {
        // The LD read path (contact/coil lowering via CombineIn) resolves an unconnected EN to a NULL source
        // (vs the FBD path's `refLocalId=0` Conn) — the same drop must apply, else an LD box renders
        // `LET en := ; IF en THEN …`. This is the form the Lenze project actually hit (LD networks).
        var doc =
            "<project xmlns=\"http://www.plcopen.org/xml/tc6_0200\"><types><pous><pou name=\"p\" pouType=\"program\"><body><LD>" +
            "<leftPowerRail localId=\"1\"><connectionPointOut formalParameter=\"none\"/></leftPowerRail>" +
            "<inVariable localId=\"2\"><connectionPointOut/><expression>x</expression></inVariable>" +
            "<block localId=\"3\" typeName=\"FC_Do\"><inputVariables>" +
            "<variable formalParameter=\"EN\"><connectionPointIn><connection refLocalId=\"0\"/></connectionPointIn></variable>" +
            "<variable formalParameter=\"IN\"><connectionPointIn><connection refLocalId=\"2\"/></connectionPointIn></variable>" +
            "</inputVariables><inOutVariables/>" +
            "<outputVariables><variable formalParameter=\"OUT\"><connectionPointOut/></variable></outputVariables>" +
            "<addData><data name=\"http://www.3s-software.com/plcopenxml/fbdcalltype\"><CallType>function</CallType></data></addData>" +
            "</block>" +
            "<coil localId=\"4\"><connectionPointIn><connection refLocalId=\"3\" formalParameter=\"OUT\"/></connectionPointIn><variable>y</variable></coil>" +
            "</LD></body></pou></pous></types></project>";
        var vg = NetworkTextWriter.Write(GraphReader.ReadBody(TestPlcOpen.FindOnlyGraphicalBody(doc)!));
        Assert.DoesNotContain("LET en", vg);   // no empty/broken EN wire
        Assert.DoesNotContain("IF en", vg);    // not EN-guarded
        Assert.Equal(vg, NetworkTextWriter.Write(NetworkTextReader.Parse(vg)));   // VG-text fixed point
    }

    [Fact]
    public void EnEno_on_a_function_block_round_trips()
    {
        // An EN-gated FB call: `IF en THEN inst(IN := x); END_IF`, its value outputs read separately via inst.Pin.
        var vg =
            "NETWORK 0 FBD\n" +
            "  LET en1 := a;\n" +
            "  IF en1 THEN t1(IN := x, PT := y); END_IF\n" +
            "  done := t1.Q;\n" +
            "END_NETWORK\n";
        var once = NetworkTextWriter.Write(NetworkTextReader.Parse(vg));
        File.WriteAllText(Path.Combine(Path.GetTempPath(), "eneno_fb.txt"), once);
        Assert.Equal(once, NetworkTextWriter.Write(NetworkTextReader.Parse(once)));            // VG-text fixed point
        Assert.Equal(once, GraphRoundTrip.ToVg(NetworkTextReader.Parse(once)));   // PLCopen convergence
    }
}
