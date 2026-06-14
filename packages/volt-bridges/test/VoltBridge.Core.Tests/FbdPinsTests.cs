using VoltBridge.Core.Fbd;
using Xunit;

namespace VoltBridge.Core.Tests;

public class FbdPinsTests
{
    [Fact]
    public void Parses_input_output_and_inout_pins_in_order()
    {
        const string decl = """
        FUNCTION_BLOCK CM_Carrier
        VAR_INPUT
            IModule : REFERENCE TO L_Module;
            xStart  : BOOL;
            xStop, xReset : BOOL;   // two on one line
        END_VAR
        VAR_OUTPUT
            xBusy : BOOL;
            ascStatus : ARRAY[1..2] OF scStatus;
        END_VAR
        VAR_IN_OUT
            scData : scCarrier;
        END_VAR
        VAR
            _local : INT := 0;      (* not a pin *)
        END_VAR
        """;

        var (inputs, outputs) = FbdPins.FromDeclaration(decl);

        Assert.Equal(new[] { "IModule", "xStart", "xStop", "xReset", "scData" }, inputs);
        Assert.Equal(new[] { "xBusy", "ascStatus", "scData" }, outputs);
    }
}
