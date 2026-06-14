using System.Collections.Generic;
using VoltBridge.Core.Fbd;
using Xunit;

namespace VoltBridge.Core.Tests;

public class FbdTranspilerTests
{
    // CM_Carrier instance with a plain input, a nested OR on the second input,
    // and one wired output.
    private static FbdBody Body() => new("FBD", new[]
    {
        new FbdNetwork(null, null, false, new[]
        {
            new FbdBox("CM_Carrier", "aCM_Carrier[1]",
                new FbdSource[]
                {
                    new FbdOperand("THIS^"),
                    new FbdNestedBox(new FbdBox("OR", null,
                        new FbdSource[] { new FbdOperand("IO.xStart"), new FbdOperand("Vis.xStart") },
                        new string[0])),
                },
                new[] { "", "MACD.ascVisuStatusCarrier[1]" }),
        }),
    });

    private static (IReadOnlyList<string>, IReadOnlyList<string>)? Pins(string boxType) => boxType switch
    {
        "CM_Carrier" => (new[] { "IModule", "xStart" }, new[] { "xOut0", "ascVisuStatusCarrier" }),
        _ => null, // operators / functions render positionally
    };

    [Fact]
    public void FB_call_with_named_inputs_then_output_assignments_and_nested_OR()
    {
        var st = FbdTranspiler.ToSt(Body(), Pins);

        const string expected =
            "aCM_Carrier[1](IModule := THIS^, xStart := (IO.xStart OR Vis.xStart));\n" +
            "MACD.ascVisuStatusCarrier[1] := aCM_Carrier[1].ascVisuStatusCarrier;\n";

        Assert.Equal(expected, st);
    }
}
