using System.Collections.Generic;
using System.Runtime.InteropServices;
using Volt.Contracts;
using Volt.Ide.Twincat;
using Xunit;

namespace Volt.Ide.Twincat.Tests;

/// <summary>
/// ATTACHING TO A TWINCAT XAE MEANS SERVING WHAT IT HAS OPEN — as it does on CODESYS.
///
/// <para><b>It used to mean acquiring the DTE and stopping.</b> <c>BeckhoffDriver.Connect</c> bound the window and
/// resolved no project, so the bridge reported <c>idle</c> and refused every sync op until a LOCAL client sent
/// <c>select</c>. The connector's reconciler assumes the opposite ("a bridge SERVES BY DEFAULT"), and a consumer with
/// no local client — the relay, which deliberately does not carry <c>connect</c> — got nothing: measured against
/// production 2026-09-26, TcXaeShell 15.0 serving `TwinCAT Project14`, <c>health</c> polled 60 s and never left
/// <c>idle</c>, and everything worked the moment a <c>select</c> was sent by hand
/// (openspec <c>twincat-bind-without-a-local-client</c>).</para>
///
/// <para>Two things the one-line fix would still have missed, each pinned here: the attached project must be the
/// standing selection, or a DTE drop is never recovered (recovery re-establishes only a selection); and a project
/// opened AFTER the attach must be taken up, or that bridge stays idle with no <c>select</c> ever coming.</para>
///
/// <para>The doubles are plain C# objects reached through <c>dynamic</c>, exactly as the driver reaches the COM ones
/// (<see cref="TcSystemManagerTests"/>); the window is reached through <c>TcObjectModel.BindWindow</c>.</para>
/// </summary>
public class TcAttachTests
{
    public sealed class SysManager
    {
        public object LookupTreeItem(string path) =>
            throw new COMException($"Item '{path}' not found", unchecked((int)0x98510001));
    }

    public sealed class Project
    {
        public Project(string name, object obj) { Name = name; Object = obj; }
        public string Name { get; }
        public object Object { get; }
    }

    public sealed class Projects
    {
        public readonly List<Project> Items = new();
        public int Count => Items.Count;
        public object Item(int i) => Items[i - 1];
    }

    public sealed class Solution
    {
        public Projects Projects { get; } = new();
        public int Count => Projects.Count;
        public bool Saved => true;
    }

    /// <summary>An XAE window: its solution, and the version the attach reads.</summary>
    public sealed class Dte
    {
        public Dte(params Project[] projects) { Solution.Projects.Items.AddRange(projects); }
        public Solution Solution { get; } = new();
        public string Version => "15.0";
    }

    private static Project Tc(string name) => new(name, new SysManager());

    private static (BeckhoffDriver Driver, TcObjectModel Model) Attached(Dte window)
    {
        var model = new TcObjectModel { BindWindow = _ => window };
        var driver = new BeckhoffDriver(model);
        driver.Connect(xaePid: 1);
        return (driver, model);
    }

    [Fact]
    public void The_attach_serves_the_windows_first_TwinCAT_project_with_no_select()
    {
        // a C# ADS client ahead of it in the solution is no TwinCAT project, and is passed over
        var (driver, _) = Attached(new Dte(new Project("AdsClient", new object()), Tc("TwinCAT Project14"), Tc("Other")));

        Assert.True(driver.IsConnected);
        Assert.Equal("TwinCAT Project14", driver.ServedProjectName);
    }

    [Fact]
    public void A_named_select_still_serves_another_project_of_the_window()
    {
        var (driver, _) = Attached(new Dte(Tc("TwinCAT Project14"), Tc("Other")));

        driver.SelectProject(new ConnectRequest { Project = "Other" });

        Assert.Equal("Other", driver.ServedProjectName);
    }

    [Fact]
    public void The_attached_project_is_recovered_after_the_window_re_registers()
    {
        var window = new Dte(Tc("TwinCAT Project14"), Tc("Other"));
        var (driver, model) = Attached(window);

        // TcXaeShell re-registers its DTE with a fresh object: the held one is dead, the pid finds the new one
        var reborn = new Dte(Tc("TwinCAT Project14"), Tc("Other"));
        model.BindWindow = _ => reborn;
        driver.Recover();

        Assert.True(driver.IsConnected);
        Assert.Equal("TwinCAT Project14", driver.ServedProjectName);
    }

    [Fact]
    public void A_project_opened_after_the_attach_is_served_once_the_health_poll_sees_it()
    {
        var window = new Dte();
        var (driver, model) = Attached(window);
        Assert.False(driver.IsConnected);

        window.Solution.Projects.Items.Add(Tc("TwinCAT Project14"));
        model.EnsureAttached();

        Assert.Equal("TwinCAT Project14", driver.ServedProjectName);
    }

    [Fact]
    public void An_explicit_pick_is_never_replaced_by_the_attach()
    {
        var (driver, model) = Attached(new Dte(Tc("TwinCAT Project14"), Tc("Other")));
        driver.SelectProject(new ConnectRequest { Project = "Other" });

        model.EnsureAttached();
        driver.Recover();

        Assert.Equal("Other", driver.ServedProjectName);
    }
}
