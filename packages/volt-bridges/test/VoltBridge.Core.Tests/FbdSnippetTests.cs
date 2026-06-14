using VoltBridge.Core.Fbd;
using Xunit;

namespace VoltBridge.Core.Tests;

public class FbdSnippetTests
{
    [Fact]
    public void Strips_position_breakpoint_and_assert_markers()
    {
        // Shape taken from a real CODESYS GetImplementationSnippet() result.
        const string snippet =
            "{nobp}{p 2}{bp}{p 170}FB(IModule := {p 8}THIS^, xStart := {p 73}({p 10}A OR {p 71}B));\r\n" +
            "{p 5}Out := FB.xStartLED;\r\n" +
            "{p 170}{ assert(hastype(variable:FB, FB), '$'FB$' is not an instance of $'FB$'.')'};\r\n";

        const string expected =
            "FB(IModule := THIS^, xStart := (A OR B));\n" +
            "Out := FB.xStartLED;\n";

        Assert.Equal(expected, FbdSnippet.CleanImplementation(snippet));
    }
}
