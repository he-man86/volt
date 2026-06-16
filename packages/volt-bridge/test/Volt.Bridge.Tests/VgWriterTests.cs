using System.Linq;
using System.Xml.Linq;
using Volt.Bridge.Core.Graphical;
using Volt.Bridge.Core.Graphical.Vg;
using Xunit;

namespace Volt.Bridge.Tests;

public class VgWriterTests
{
    private const string Ns = "http://www.plcopen.org/xml/tc6_0200";

    private static string ToVg(string fbdInner)
    {
        var xml = $"<FBD xmlns=\"{Ns}\">{fbdInner}</FBD>";
        var fbd = XElement.Parse(xml);
        var body = PlcOpenReader.ReadBody(fbd);
        return VgWriter.Write(body);
    }

    [Fact]
    public void Real_CONFIG_fb_call_renders_as_a_call_with_named_pins()
    {
        // The actual <FBD> body CODESYS exported for the Hauzer CONFIG POU.
        var vg = ToVg("""
            <vendorElement localId="10000000000"><position x="0" y="0"/></vendorElement>
            <inVariable localId="10000000001"><connectionPointOut/><expression>FALSE</expression></inVariable>
            <inVariable localId="10000000002"><connectionPointOut/><expression>TRUE</expression></inVariable>
            <inVariable localId="10000000003"><connectionPointOut/><expression>TRUE</expression></inVariable>
            <block localId="10000000004" typeName="L_EATP_FAST_Config" instanceName="Config">
              <inputVariables>
                <variable formalParameter="xFASTSystemInTaskMidPrio"><connectionPointIn><connection refLocalId="10000000001"/></connectionPointIn></variable>
                <variable formalParameter="xLogErrorTypeInformation"><connectionPointIn><connection refLocalId="10000000002"/></connectionPointIn></variable>
                <variable formalParameter="xLogErrorTypeWarning"><connectionPointIn><connection refLocalId="10000000003"/></connectionPointIn></variable>
              </inputVariables>
              <outputVariables><variable formalParameter="eFASTSystemTaskContext"><connectionPointOut/></variable></outputVariables>
            </block>
            """);

        Assert.Equal(
            "NETWORK 1 FBD\n" +
            "  VAR_TEMP\n" +
            "    i1 : BOOL;\n" +
            "    i2 : BOOL;\n" +
            "    i3 : BOOL;\n" +
            "  END_VAR\n" +
            "  i1 := FALSE;\n" +
            "  i2 := TRUE;\n" +
            "  i3 := TRUE;\n" +
            "  Config(xFASTSystemInTaskMidPrio := i1, xLogErrorTypeInformation := i2, xLogErrorTypeWarning := i3);\n" +
            "END_NETWORK\n",
            vg);
    }

    [Fact]
    public void Nested_operators_become_one_statement_each_so_topology_is_unambiguous()
    {
        // (A AND B) OR C  ->  result
        var vg = ToVg("""
            <inVariable localId="1"><expression>A</expression></inVariable>
            <inVariable localId="2"><expression>B</expression></inVariable>
            <inVariable localId="3"><expression>C</expression></inVariable>
            <block localId="4" typeName="AND">
              <inputVariables>
                <variable formalParameter="IN1"><connectionPointIn><connection refLocalId="1"/></connectionPointIn></variable>
                <variable formalParameter="IN2"><connectionPointIn><connection refLocalId="2"/></connectionPointIn></variable>
              </inputVariables>
              <outputVariables><variable formalParameter="OUT"><connectionPointOut/></variable></outputVariables>
            </block>
            <block localId="5" typeName="OR">
              <inputVariables>
                <variable formalParameter="IN1"><connectionPointIn><connection refLocalId="4"/></connectionPointIn></variable>
                <variable formalParameter="IN2"><connectionPointIn><connection refLocalId="3"/></connectionPointIn></variable>
              </inputVariables>
              <outputVariables><variable formalParameter="OUT"><connectionPointOut/></variable></outputVariables>
            </block>
            <outVariable localId="6"><expression>result</expression><connectionPointIn><connection refLocalId="5"/></connectionPointIn></outVariable>
            """);

        Assert.Equal(
            "NETWORK 0 FBD\n" +
            "  VAR_TEMP\n" +
            "    i1 : BOOL;\n" +
            "    i2 : BOOL;\n" +
            "    i3 : BOOL;\n" +
            "    g1 : BOOL;\n" +
            "    g2 : BOOL;\n" +
            "  END_VAR\n" +
            "  i1 := A;\n" +
            "  i2 := B;\n" +
            "  i3 := C;\n" +
            "  g1 := (i1 AND i2);\n" +
            "  g2 := (g1 OR i3);\n" +
            "  result := g2;\n" +
            "END_NETWORK\n",
            vg);
    }

    [Fact]
    public void Fb_with_multiple_outputs_reads_each_output_by_pin()
    {
        // t1 = TON; Q -> running, ET -> elapsed
        var vg = ToVg("""
            <inVariable localId="1"><expression>start</expression></inVariable>
            <inVariable localId="2"><expression>pt</expression></inVariable>
            <block localId="3" typeName="TON" instanceName="t1">
              <inputVariables>
                <variable formalParameter="IN"><connectionPointIn><connection refLocalId="1"/></connectionPointIn></variable>
                <variable formalParameter="PT"><connectionPointIn><connection refLocalId="2"/></connectionPointIn></variable>
              </inputVariables>
              <outputVariables>
                <variable formalParameter="Q"><connectionPointOut/></variable>
                <variable formalParameter="ET"><connectionPointOut/></variable>
              </outputVariables>
            </block>
            <outVariable localId="4"><expression>running</expression><connectionPointIn><connection refLocalId="3" formalParameter="Q"/></connectionPointIn></outVariable>
            <outVariable localId="5"><expression>elapsed</expression><connectionPointIn><connection refLocalId="3" formalParameter="ET"/></connectionPointIn></outVariable>
            """);

        Assert.Equal(
            "NETWORK 0 FBD\n" +
            "  VAR_TEMP\n" +
            "    i1 : BOOL;\n" +
            "    i2 : BOOL;\n" +
            "  END_VAR\n" +
            "  i1 := start;\n" +
            "  i2 := pt;\n" +
            "  t1(IN := i1, PT := i2);\n" +
            "  running := t1.Q;\n" +
            "  elapsed := t1.ET;\n" +
            "END_NETWORK\n",
            vg);
    }
}
