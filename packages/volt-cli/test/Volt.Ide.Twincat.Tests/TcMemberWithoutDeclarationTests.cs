using Volt.Contracts;
using Volt.Engine;
using Volt.Engine.Item;
using Xunit;

namespace Volt.Ide.Twincat.Tests;

/// <summary>
/// A MEMBER THE IDE HOLDS NO DECLARATION FOR IS UNREADABLE, NOT A VOLT BUG (openspec <c>bridge-refusal-review</c> V.1)
/// — the TwinCAT twin of <c>CodesysMemberWithoutDeclarationTests</c>. The IDE holds the item and Volt cannot read it
/// whole: <c>UNREADABLE</c>'s situation. It answered <c>INTERNAL_ERROR</c>.
/// </summary>
public class TcMemberWithoutDeclarationTests
{
    [Fact]
    public void A_method_whose_declaration_the_IDE_reports_blank_is_UNREADABLE_by_name()
    {
        var pou = new TcHiddenBodyWriteTests.Node("FB_A", ItemKind.PlcPou, "FUNCTION_BLOCK FB_A\nVAR\nEND_VAR", ";",
            new TcHiddenBodyWriteTests.Node("Step", ItemKind.PlcMethod, "", "x := 1;"));

        var ex = Assert.Throws<BridgeException>(() => TcUntouchablePouTests.BoundDriver().ReadContent(new ItemRef(pou)));

        Assert.Equal(BridgeErrorCodes.Unreadable, ex.ErrorCode);
        Assert.Contains("'Step'", ex.Message);
        Assert.Contains("no declaration", ex.Message);
    }
}
