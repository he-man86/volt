using System.Linq;
using VoltBridge.Core.Fbd;
using Xunit;

namespace VoltBridge.Core.Tests;

public class FbdXmlReaderTests
{
    // A minimal but schema-accurate TwinCAT NWL XmlArchive: one CM_Carrier FB box with
    // a THIS^ input, a nested OR box on its second input, and one assigned output.
    private const string Sample = """
    <o t="NWLImplementationObject">
      <v n="DefaultViewMode">"Fbd"</v>
      <l2 n="NetworkList" cet="Network">
        <o>
          <v n="Title">"N1"</v>
          <v n="OutCommented">false</v>
          <l2 n="NetworkItems" cet="BoxTreeBox">
            <o>
              <v n="BoxType">"CM_Carrier"</v>
              <o n="Instance" t="Operand"><v n="Operand">"aCM_Carrier[1]"</v></o>
              <o n="OutputItems" t="OutputItemList">
                <l2 n="OutputItems" cet="Operand">
                  <o><v n="Operand">""</v></o>
                  <o><v n="Operand">"MACD.ascVisuStatusCarrier[1]"</v></o>
                </l2>
              </o>
              <l2 n="InputItems" cet="BoxTreeOperand">
                <o><o n="Operand" t="Operand"><v n="Operand">"THIS^"</v></o><v n="Id">1L</v></o>
                <o t="BoxTreeBox">
                  <v n="BoxType">"OR"</v>
                  <o n="Instance" t="Operand"><n n="Operand" /></o>
                  <o n="OutputItems" t="OutputItemList"><l2 n="OutputItems"><n /></l2></o>
                  <l2 n="InputItems" cet="BoxTreeOperand">
                    <o><o n="Operand" t="Operand"><v n="Operand">"IO.xStart"</v></o><v n="Id">2L</v></o>
                    <o><o n="Operand" t="Operand"><v n="Operand">"Vis.xStart"</v></o><v n="Id">3L</v></o>
                  </l2>
                </o>
              </l2>
            </o>
          </l2>
        </o>
      </l2>
    </o>
    """;

    [Fact]
    public void Reads_box_instance_operands_outputs_and_nested_OR()
    {
        var body = FbdXmlReader.Read(Sample);

        Assert.Equal("FBD", body.Language);
        var net = Assert.Single(body.Networks);
        var box = Assert.Single(net.Boxes);

        Assert.Equal("CM_Carrier", box.Type);
        Assert.Equal("aCM_Carrier[1]", box.Instance);

        Assert.Equal(2, box.Inputs.Count);
        Assert.Equal("THIS^", Assert.IsType<FbdOperand>(box.Inputs[0]).Text);

        var or = Assert.IsType<FbdNestedBox>(box.Inputs[1]).Box;
        Assert.Equal("OR", or.Type);
        Assert.Null(or.Instance);                                  // operator → no instance
        Assert.Equal(new[] { "IO.xStart", "Vis.xStart" },
            or.Inputs.Select(i => Assert.IsType<FbdOperand>(i).Text));

        Assert.Equal(new[] { "", "MACD.ascVisuStatusCarrier[1]" }, box.Outputs);
    }
}
