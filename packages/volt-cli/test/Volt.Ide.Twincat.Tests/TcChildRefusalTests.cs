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

    /// <summary>openspec <c>push-keeps-what-landed</c> gate step 1, measured live 2026-10-03 (TcXaeShell, the e2e
    /// <c>push-keeps-what-landed.test.ts</c> 1.1 on the fixture): XAE refuses a METHOD named <c>Log</c> under a function
    /// block, as CODESYS does — and it reached the client as <c>INTERNAL_ERROR</c> because this classifier knew only
    /// "(SubType mismatch)". The vendor refusing a child by its NAME is a refusal, not a fault (parity with
    /// <c>CodesysChildRefusalTests</c>).</summary>
    [Fact]
    public void The_measured_Name_mismatch_is_a_refusal_with_the_vendors_words()
    {
        const string log =
            "TwinCAT PLC automation call (ITcSmTreeItem:CreateChild) failed: Creating the child named 'Log' is not possible " +
            "on node (Name mismatch)";
        Assert.Equal(log, BeckhoffDriver.ChildRefusal(new COMException(log)));
    }

    [Theory]
    [InlineData("Unbound tree item")]
    [InlineData("The RPC server is unavailable.")]
    public void Any_other_failure_is_not_a_refusal(string message) =>
        Assert.Null(BeckhoffDriver.ChildRefusal(new COMException(message)));
}
