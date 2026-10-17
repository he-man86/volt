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

    /// <summary>The solution — named, as XAE's is, by its <c>.sln</c> file: the first project's name unless a test
    /// names it (the default layout, where the solution and its system project share a name).</summary>
    public sealed class Solution
    {
        public Projects Projects { get; } = new();
        public string? Name { get; set; }
        public string FullName => Name ?? (Projects.Count > 0 ? $@"C:\p\{Projects.Items[0].Name}.sln" : "");
        public int Count => Projects.Count;
        public bool Saved => true;
    }

    /// <summary>An XAE window: its solution, and the version the attach reads.</summary>
    public sealed class Dte
    {
        public Dte(params Project[] projects) { Solution.Projects.Items.AddRange(projects); }
        public Solution Solution { get; } = new();
        public string Version => "15.0";
        /// <summary>The window list the build-output read reaches the Output window through; none unless a test sets one.</summary>
        public object? Windows { get; set; }
    }

    private static Project Tc(string name) => new(name, new TcComTree.SysManager());

    private static (BeckhoffDriver Driver, TcObjectModel Model) Attached(Dte window)
    {
        var model = new TcObjectModel { BindWindow = _ => window };
        var driver = new BeckhoffDriver(model);
        driver.Connect(xaePid: 1);
        return (driver, model);
    }

    /// <summary>THE SOLUTION IS THE PROJECT (openspec multi-application-tree, design §1): one workspace serves every
    /// system project of the window, named by the <c>.sln</c> as the engineer sees it — a C# ADS client in it is no
    /// TwinCAT project, and is passed over.</summary>
    [Fact]
    public void The_attach_serves_the_windows_solution_with_no_select()
    {
        var window = new Dte(new Project("AdsClient", new object()), Tc("TwinCAT Project14"), Tc("Other"));
        window.Solution.Name = @"C:\p\Line.sln";
        var (driver, _) = Attached(window);

        Assert.True(driver.IsConnected);
        Assert.Equal("Line", driver.ServedProjectName);
    }

    /// <summary>A select names the solution; a system project's name is a part of it, not a project to serve.</summary>
    [Fact]
    public void A_select_of_a_system_projects_name_serves_nothing()
    {
        var window = new Dte(Tc("TwinCAT Project14"), Tc("Other"));
        window.Solution.Name = @"C:\p\Line.sln";
        var (driver, _) = Attached(window);

        driver.SelectProject(new ConnectRequest { Project = "Other" });

        Assert.Null(driver.ServedProjectName);
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
    public void An_explicit_pick_survives_the_attach_and_a_recovery()
    {
        var window = new Dte(Tc("TwinCAT Project14"), Tc("Other"));
        window.Solution.Name = @"C:\p\Line.sln";
        var (driver, model) = Attached(window);
        driver.SelectProject(new ConnectRequest { Project = "Line" });

        model.EnsureAttached();
        driver.Recover();

        Assert.Equal("Line", driver.ServedProjectName);
    }
}
