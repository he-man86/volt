using System;
using System.Runtime.InteropServices;
using Xunit;

namespace Volt.Ide.Twincat.Tests;

/// <summary>
/// <c>dirty</c> IS WHAT THE IDE ANSWERS FOR THE SERVED ROW, AND NOTHING ELSE (openspec <c>wire-final-shape</c> 3.3, measured
/// in 2.5): the served solution's <c>!Saved</c>. A <c>Saved</c> read that throws said nothing, and a row the worker does
/// not serve is never asked — both carry no <c>dirty</c>, where they read <c>false</c> (<c>servedDirty ?? false</c>).
/// </summary>
public class TcDirtyTests
{
    private static TcAttachTests.Project Tc(string name) => new(name, new TcComTree.SysManager());

    private static (BeckhoffDriver Driver, TcAttachTests.Dte Window) Attached()
    {
        var window = new TcAttachTests.Dte(Tc("TwinCAT Project14"));
        var model = new TcObjectModel { BindWindow = _ => window };
        var driver = new BeckhoffDriver(model);
        driver.Connect(xaePid: 1);
        return (driver, window);
    }

    private static Volt.Contracts.ProjectEntry Row(BeckhoffDriver driver) => Assert.Single(driver.ProbeProjects().Rows);

    [Theory]
    [InlineData(true, false)]
    [InlineData(false, true)]
    public void The_served_row_states_dirty_as_the_solution_answers(bool saved, bool dirty)
    {
        var (driver, window) = Attached();
        window.Solution.SavedRead = () => saved;

        Assert.Equal(dirty, Row(driver).Dirty);
    }

    [Fact]
    public void A_saved_state_the_IDE_does_not_answer_gives_the_row_no_dirty()
    {
        var (driver, window) = Attached();
        window.Solution.SavedRead = () => throw new COMException("The message filter indicated that the application is busy.", unchecked((int)0x8001010A));

        Assert.Null(Row(driver).Dirty);
    }

    [Fact]
    public void A_row_the_worker_does_not_serve_is_never_asked_and_carries_no_dirty()
    {
        var (driver, window) = Attached();
        window.Solution.SavedRead = () => false;
        driver.SelectProject(new Volt.Contracts.ConnectRequest { Project = "Another solution" });   // serves nothing now

        var row = Row(driver);
        Assert.Equal(Volt.Contracts.HealthStatus.Idle, row.Status);
        Assert.Null(row.Dirty);
    }
}
