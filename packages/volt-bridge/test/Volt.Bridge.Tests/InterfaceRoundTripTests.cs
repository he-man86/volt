using System.Collections.Generic;
using System.Linq;
using Volt.Bridge.Core.Workspace.SourceText;
using Xunit;

namespace Volt.Bridge.Tests;

/// <summary>
/// An INTERFACE carries its method/property signatures INSIDE the INTERFACE…END_INTERFACE block (not as
/// siblings after END_INTERFACE like an FB's methods). StAssembler and StSplitter must agree on that, or
/// an interface's members are lost on round-trip.
/// </summary>
public class InterfaceRoundTripTests
{
    [Fact]
    public void Interface_members_survive_assemble_then_split()
    {
        var result = new Dictionary<string, object?>
        {
            ["kind"] = "interface",
            ["declaration"] = "INTERFACE ITest",
            ["implementation"] = "",
            ["children"] = new List<object?>
            {
                new Dictionary<string, object?> { ["kind"] = "method", ["name"] = "DoIt", ["declaration"] = "METHOD DoIt : INT", ["implementation"] = "" },
            },
        };

        var st = StAssembler.Assemble(result);
        var split = StSplitter.SplitSt(st);

        Assert.Equal("interface", split.PouKind);
        Assert.Contains(split.Children, c => c.Name == "DoIt");   // member survived the round-trip
    }
}
