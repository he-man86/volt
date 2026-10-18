using Volt.Contracts;
using Volt.Engine;
using Volt.Engine.Sync;
using Xunit;

namespace Volt.Ide.Twincat.Tests;

/// <summary>
/// A TWINCAT WINDOW WHOSE SOLUTION HAS NO FILE SAYS WHY IT IS NOT SERVED (openspec <c>twincat-unsaved-solution-named</c>,
/// option B). Measured 2026-10-18 on TcXaeShell 15.0 / 4024: a <c>.tsproj</c> opened with File > Open > Project where no
/// <c>.sln</c> holds it gives a solution with an empty <c>FullName</c> (XAE states its name, <c>TwinCAT Project14</c>), and
/// <c>File.SaveAll</c> on it opens a modal "Save File As" dialog, which blocks COM — and a build saves before it compiles (D45).
/// So the window stays rowless (no name to bind a workspace to, no push that cannot hang), and the refusal names the cause
/// instead of "waiting for an IDE project" while the project is open in front of the user.
/// </summary>
public class TcUnsavedSolutionTests
{
    private static BeckhoffDriver Unsaved()
    {
        var window = new TcAttachTests.Dte(new TcAttachTests.Project("TwinCAT Project14", new TcComTree.SysManager()));
        window.Solution.Unsaved = true;
        var driver = new BeckhoffDriver(new TcObjectModel { BindWindow = _ => window });
        driver.Connect(xaePid: 1);
        return driver;
    }

    [Fact]
    public void A_read_on_a_window_whose_solution_is_not_saved_says_so()
    {
        var driver = Unsaved();

        var ex = Assert.Throws<BridgeException>(() => RefsService.Handle(driver));

        Assert.Equal(BridgeErrorCodes.PlcDisconnected, ex.ErrorCode);
        Assert.Contains("solution is not saved", ex.Message);
        Assert.Contains("File > Save All", ex.Message);
    }

    [Fact]
    public void The_window_has_no_health_row()
    {
        Assert.Empty(Unsaved().BuildHealthResponse().Projects);
    }
}
