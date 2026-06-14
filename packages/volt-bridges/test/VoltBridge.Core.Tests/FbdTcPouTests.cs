using System.Collections.Generic;
using VoltBridge.Core.Fbd;
using Xunit;

namespace VoltBridge.Core.Tests;

public class FbdTcPouTests
{
    private const string TcPou = """
    <TcPlcObject Version="1.1.0.1">
      <POU Name="POU">
        <Implementation><ST><![CDATA[]]></ST></Implementation>
        <Action Name="ACT_fbd" FolderPath="NewFolder1\">
          <Implementation>
            <NWL><XmlArchive><Data>
              <o t="NWLImplementationObject">
                <v n="DefaultViewMode">"Fbd"</v>
                <l2 n="NetworkList" cet="Network">
                  <o>
                    <l2 n="NetworkItems" cet="BoxTreeBox">
                      <o>
                        <v n="BoxType">"CM_Carrier"</v>
                        <o n="Instance" t="Operand"><v n="Operand">"aCM_Carrier[1]"</v></o>
                        <o n="OutputItems" t="OutputItemList">
                          <l2 n="OutputItems" cet="Operand">
                            <o><v n="Operand">""</v></o>
                            <o><v n="Operand">"MACD.x[1]"</v></o>
                          </l2>
                        </o>
                        <l2 n="InputItems" cet="BoxTreeOperand">
                          <o><o n="Operand" t="Operand"><v n="Operand">"THIS^"</v></o></o>
                          <o t="BoxTreeBox">
                            <v n="BoxType">"OR"</v>
                            <o n="Instance" t="Operand"><n n="Operand" /></o>
                            <o n="OutputItems" t="OutputItemList"><l2 n="OutputItems"><n /></l2></o>
                            <l2 n="InputItems" cet="BoxTreeOperand">
                              <o><o n="Operand" t="Operand"><v n="Operand">"A"</v></o></o>
                              <o><o n="Operand" t="Operand"><v n="Operand">"B"</v></o></o>
                            </l2>
                          </o>
                        </l2>
                      </o>
                    </l2>
                  </o>
                </l2>
              </o>
            </Data></XmlArchive></NWL>
          </Implementation>
        </Action>
      </POU>
    </TcPlcObject>
    """;

    private static (IReadOnlyList<string>, IReadOnlyList<string>)? Pins(string t) => t switch
    {
        "CM_Carrier" => (new[] { "IModule", "xStart" }, new[] { "o0", "x" }),
        _ => null,
    };

    [Fact]
    public void Extracts_and_transpiles_a_graphical_action_from_a_TcPOU()
    {
        var gb = TcPouReader.ReadGraphicalBody(TcPou, "ACT_fbd", Pins);

        Assert.NotNull(gb);
        Assert.Equal("FBD", gb!.Language);
        Assert.Equal(
            "aCM_Carrier[1](IModule := THIS^, xStart := (A OR B));\n" +
            "MACD.x[1] := aCM_Carrier[1].x;\n",
            gb.St);
    }

    [Fact]
    public void Returns_null_for_a_textual_action()
    {
        Assert.Null(TcPouReader.ReadGraphicalBody(TcPou, "POU", Pins));        // not an action
        Assert.Null(TcPouReader.FindChildBody(TcPou, "DoesNotExist"));
    }

    [Fact]
    public void Root_POU_body_in_FBD_is_transpiled_with_output_assignment()
    {
        const string tc = """
        <TcPlcObject>
          <POU Name="RootFbd">
            <Implementation>
              <NWL><XmlArchive><Data>
                <o t="NWLImplementationObject">
                  <v n="DefaultViewMode">"Fbd"</v>
                  <l2 n="NetworkList" cet="Network"><o>
                    <l2 n="NetworkItems" cet="BoxTreeBox"><o>
                      <v n="BoxType">"OR"</v>
                      <o n="Instance" t="Operand"><n n="Operand" /></o>
                      <o n="OutputItems" t="OutputItemList"><l2 n="OutputItems"><o><v n="Operand">"y"</v></o></l2></o>
                      <l2 n="InputItems" cet="BoxTreeOperand">
                        <o><o n="Operand" t="Operand"><v n="Operand">"a"</v></o></o>
                        <o><o n="Operand" t="Operand"><v n="Operand">"b"</v></o></o>
                      </l2>
                    </o></l2>
                  </o></l2>
                </o>
              </Data></XmlArchive></NWL>
            </Implementation>
          </POU>
        </TcPlcObject>
        """;

        var gb = TcPouReader.ReadGraphicalBody(tc, "RootFbd", Pins);   // the POU itself, not a child
        Assert.NotNull(gb);
        Assert.Equal("y := (a OR b);\n", gb!.St);
    }

    [Fact]
    public void CFC_and_SFC_are_marker_only_not_transpiled()
    {
        const string tc = """
        <TcPlcObject>
          <POU Name="P">
            <Action Name="ACT_CFC">
              <Implementation><CFC><XmlArchive><Data>
                <o t="CFCImplementationObject" />
              </Data></XmlArchive></CFC></Implementation>
            </Action>
            <Action Name="ACT_ST">
              <Implementation><ST><![CDATA[x := 1;]]></ST></Implementation>
            </Action>
          </POU>
        </TcPlcObject>
        """;

        var cfc = TcPouReader.ReadGraphicalBody(tc, "ACT_CFC", Pins);
        Assert.NotNull(cfc);
        Assert.Equal("CFC", cfc!.Language);
        Assert.Equal("", cfc.St);                                  // detected + safe, no ST yet

        Assert.Null(TcPouReader.ReadGraphicalBody(tc, "ACT_ST", Pins));   // textual → not graphical
    }
}
