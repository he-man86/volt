using System;
using System.Runtime.InteropServices;
using Volt.Ide.Twincat;
using Xunit;

namespace Volt.Ide.Twincat.Tests;

/// <summary>THE DRIVER, NOT THE ENGINE, TELLS TWINCAT'S REFUSAL OF A CHILD FROM A FAULT (openspec
/// <c>push-without-header-check</c> 5Qa review). The push words a refused member as a fact about the POU's declaration
/// (DIALECT C2k); it used to word every failed create that way, an "Unbound tree item" included.</summary>
public class TcChildRefusalTests
{
    // Verbatim from `scripts/tc-function-members.log` (TcXaeShell, 2026-10-02).
    private const string Measured =
        "TwinCAT PLC automation call (ITcSmTreeItem:CreateChild) failed: Creating the child type 'TREEITEMTYPE_PLCMETHOD' " +
        "is not possible on parent node type 'TREEITEMTYPE_PLCPOUFB' (SubType mismatch)";

    [Fact]
    public void The_measured_SubType_mismatch_is_a_refusal_with_the_vendors_words() =>
        Assert.Equal(Measured, BeckhoffDriver.ChildRefusal(new COMException(Measured)));

    [Theory]
    [InlineData("Unbound tree item")]
    [InlineData("The RPC server is unavailable.")]
    public void Any_other_failure_is_not_a_refusal(string message) =>
        Assert.Null(BeckhoffDriver.ChildRefusal(new COMException(message)));
}
