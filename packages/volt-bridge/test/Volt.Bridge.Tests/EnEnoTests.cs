using System;
using System.IO;
using System.Xml.Linq;
using Volt.Bridge.Core.Graphical;
using Volt.Bridge.Core.Graphical.Vg;
using Xunit;

namespace Volt.Bridge.Tests;

public class EnEnoTests
{
    private static string Fixture() => File.ReadAllText(
        Path.Combine(AppContext.BaseDirectory, "fixtures", "tc-fbd", "fbd_en_eno.plcopen.xml"));

    [Fact]
    public void EnEno_reads_as_IF_parses_back_and_is_a_fixed_point()
    {
        var g0 = PlcOpenReader.ReadBody(PlcOpenDocument.FindFbdLdBody(Fixture())!);
        var vg0 = VgWriter.Write(g0);

        // VgParser is the exact inverse of VgWriter (the VG-text fixed point).
        var vg1 = VgWriter.Write(VgParser.Parse(vg0));
        // And the parsed graph survives a full PLCopen round-trip (the convergence the push-gate checks).
        var vg2 = GraphicalRoundTrip.ToVg(VgParser.Parse(vg0));

        File.WriteAllText(Path.Combine(Path.GetTempPath(), "eneno_rt.txt"),
            "=== vg0 (read) ===\n" + vg0 + "\n=== vg1 (parse→write) ===\n" + vg1 + "\n=== vg2 (parse→plcopen→write) ===\n" + vg2);
        Assert.Equal(vg0, vg1);
        Assert.Equal(vg0, vg2);
    }

    [Fact]
    public void Pushing_over_an_existing_EnEno_body_is_not_refused_as_multi_output()
    {
        // An EN/ENO box is stateless with ENO + its value output. The "stateless function with multiple outputs"
        // guard (PlcOpenDocument.ValidateExisting) must NOT count ENO, or overwriting an existing EN/ENO body is
        // wrongly refused. Found LIVE on TwinCAT: the create slipped through (no existing body), the re-push hit it.
        var fbd = PlcOpenDocument.FindFbdLdBody(Fixture())!;
        var ns = fbd.Name.Namespace;
        var miniDoc = new XElement(ns + "pou", new XAttribute("name", "P"),
            new XElement(ns + "body", new XElement(fbd))).ToString();
        var newBody = PlcOpenWriter.WriteBody(PlcOpenReader.ReadBody(fbd));
        var spliced = PlcOpenDocument.SpliceFbdLdBody(miniDoc, newBody);   // must not throw
        Assert.Contains("ENO", spliced);
    }
}
