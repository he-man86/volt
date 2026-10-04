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
    // Verbatim from `tc-function-members.log` (deleted; `git show b2496efb4b:packages/volt-cli/scripts/tc-function-members.log`) (TcXaeShell, 2026-10-02).
    private const string Measured =
        "TwinCAT PLC automation call (ITcSmTreeItem:CreateChild) failed: Creating the child type 'TREEITEMTYPE_PLCMETHOD' " +
        "is not possible on parent node type 'TREEITEMTYPE_PLCPOUFB' (SubType mismatch)";

    /// <summary>The vendor's SENTENCE, not the automation wrapper around it (openspec <c>bridge-refusal-review</c> 8.4): the
    /// live refusal reads "TwinCAT PLC automation call (ITcSmTreeItem:CreateChild) failed: &lt;sentence&gt;\nPath: 'TIPC^…'
    /// (ITcSmTreeItem:CreateChild." (measured 2026-10-04, refusals/matrix NOT_ATTEMPTED), while CODESYS's refusal is the
    /// sentence alone — so the same refused member reached the client in two message shapes. The wrapper names the COM
    /// call and an internal tree path, neither of which is the IDE's reason.</summary>
    [Fact]
    public void The_measured_SubType_mismatch_is_a_refusal_with_the_vendors_words() =>
        Assert.Equal("Creating the child type 'TREEITEMTYPE_PLCMETHOD' is not possible on parent node type " +
                     "'TREEITEMTYPE_PLCPOUFB' (SubType mismatch)",
                     BeckhoffDriver.ChildRefusal(new COMException(Measured)));

    /// <summary>openspec <c>push-keeps-what-landed</c> gate step 1, measured live 2026-10-03 (TcXaeShell, the e2e
    /// <c>push-keeps-what-landed.test.ts</c> 1.1 on the fixture): XAE refuses a METHOD named <c>Log</c> under a function
    /// block, as CODESYS does — and it reached the client as <c>INTERNAL_ERROR</c> because this classifier knew only
    /// "(SubType mismatch)". The vendor refusing a child by its NAME is a refusal, not a fault (parity with
    /// <c>CodesysChildRefusalTests</c>).</summary>
    [Fact]
    public void The_measured_Name_mismatch_is_a_refusal_with_the_vendors_words()
    {
        // Verbatim from the live matrix (2026-10-04): the wrapper, the sentence, and the tree path after it.
        const string log =
            "TwinCAT PLC automation call (ITcSmTreeItem:CreateChild) failed: Creating the child named 'Log' is not possible " +
            "on node (Name mismatch)\nPath: 'TIPC^Untitled1^Untitled1 Project^VltE2E_ref_na_b' (ITcSmTreeItem:CreateChild.";
        Assert.Equal("Creating the child named 'Log' is not possible on node (Name mismatch)",
                     BeckhoffDriver.ChildRefusal(new COMException(log)));
    }

    /// <summary>…and the driver says WHICH refusal it is (openspec <c>push-keeps-what-landed</c> design D2).</summary>
    [Fact]
    public void The_driver_says_whether_the_kind_or_the_name_is_refused()
    {
        Assert.Equal(Volt.Engine.Ide.ChildRefusalCause.Kind, BeckhoffDriver.Refusal(new COMException(Measured))!.Value.Cause);
        Assert.Equal(Volt.Engine.Ide.ChildRefusalCause.Name,
            BeckhoffDriver.Refusal(new COMException("Creating the child named 'Log' is not possible on node (Name mismatch)"))!.Value.Cause);
    }

    [Theory]
    [InlineData("Unbound tree item")]
    [InlineData("The RPC server is unavailable.")]
    public void Any_other_failure_is_not_a_refusal(string message) =>
        Assert.Null(BeckhoffDriver.ChildRefusal(new COMException(message)));
}
