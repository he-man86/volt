using Volt.Engine.Item;
using Xunit;

namespace Volt.Ide.Twincat.Tests;

/// <summary>
/// A LINE IS THE BOUNDARY ONLY WHEN IT IS ONE (openspec <c>bridge-refusal-review</c> D9, task 4.9) — TwinCAT's half of
/// <c>CodesysStBodyLineTests</c>: an ST body holding <c>Implementation</c> on a line of its own is pulled as written.
/// </summary>
public class TcStBodyLineTests
{
    [Theory]
    [InlineData("x := a OR\n  Implementation;")]
    [InlineData("x := a\nImplementation OR b;")]
    [InlineData("x := a OR\nIMPLEMENTATION")]
    public void An_ST_body_holding_the_identifier_on_its_own_line_is_pulled_as_written(string body)
    {
        var read = new BeckhoffDriver(new TcObjectModel()).ReadContent(new ItemRef(
            new TcHiddenBodyWriteTests.Node("FB", ItemKind.PlcPou, "FUNCTION_BLOCK FB\nVAR\n\ta, b, x, implementation : BOOL;\nEND_VAR", body)));

        Assert.Equal(body, read.Body);
        Assert.Equal(StatedLanguage.St, read.Stated);
    }
}
