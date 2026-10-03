using System;
using System.Linq;
using Volt.Ide.Twincat;
using Xunit;

namespace Volt.Ide.Twincat.Tests;

/// <summary>
/// TWINCAT STATES THE SHELL AS THE PRODUCT AND THE BUILD AS THE PLATFORM (openspec ide-identity-report 2.2, design C).
///
/// <para><c>ideVersion</c> was <c>DTE.Version</c> — <c>15.0</c>, the SHELL's version, which says nothing about the
/// TwinCAT build a project runs on. Measured on TcXaeShell 15 / TwinCAT 3.1.4024.74 (DIALECT V5): the product is the
/// DTE's own <c>Name</c>/<c>Version</c>, the build is the open solution's <c>TcRemoteManager.Version</c> (empty with
/// no solution), and the vendor is the XAE exe's <c>CompanyName</c>, read through the XAE PID — the worker is out of
/// process, so its own process would name Volt's exe.</para>
/// </summary>
public class TcIdentityTests
{
    public sealed class RemoteManager
    {
        public string? Version { get; set; }
    }

    /// <summary>An XAE window as the attach reads it: name, shell version, and the remote manager behind GetObject.</summary>
    public sealed class Dte
    {
        public Dte(params TcAttachTests.Project[] projects) { Solution.Projects.Items.AddRange(projects); }
        public TcAttachTests.Solution Solution { get; } = new();
        public string Name { get; set; } = "TcXaeShell";
        public string Version { get; set; } = "15.0";
        public RemoteManager Remote { get; } = new() { Version = "3.1.4024.74" };
        public Exception? GetObjectFails { get; set; }
        public int GetObjectCalls { get; private set; }
        public object GetObject(string name)
        {
            GetObjectCalls++;
            if (GetObjectFails != null) throw GetObjectFails;
            Assert.Equal("TcRemoteManager", name);
            return Remote;
        }
    }

    private static TcAttachTests.Project Tc(string name) => new(name, new TcAttachTests.SysManager());

    private static BeckhoffDriver Attached(Dte window, Func<int, string?>? vendor = null, int pid = 4711)
    {
        var model = new TcObjectModel { BindWindow = _ => window, ReadXaeVendor = vendor ?? (_ => "Beckhoff") };
        var driver = new BeckhoffDriver(model);
        driver.Connect(xaePid: pid);
        return driver;
    }

    [Fact]
    public void The_shell_is_the_product_and_the_TwinCAT_build_is_the_ide_version()
    {
        var driver = Attached(new Dte(Tc("TwinCAT Project14")));

        Assert.Equal("TcXaeShell", driver.ProductName);
        Assert.Equal("15.0", driver.ProductVersion);
        Assert.Equal("Beckhoff", driver.ProductVendor);
        Assert.Equal("3.1.4024.74", driver.IdeVersion);
        // each row carries the platform version too — the tray's multi-instance label reads it
        Assert.All(driver.BuildHealthResponse().Projects, p => Assert.Equal("3.1.4024.74", p.Version));
    }

    [Fact]
    public void The_vendor_is_read_through_the_xae_pid_never_the_workers_own_process()
    {
        int? asked = null;
        var driver = Attached(new Dte(Tc("P")), pid => { asked = pid; return "Beckhoff"; }, pid: 9112);

        Assert.Equal(9112, asked);
        Assert.Equal("Beckhoff", driver.ProductVendor);
    }

    [Fact]
    public void An_empty_remote_manager_reads_null_never_the_shell_version()
    {
        var window = new Dte();          // no solution open: the remote manager states nothing
        window.Remote.Version = "";
        var driver = Attached(window);

        Assert.Null(driver.IdeVersion);
        Assert.Equal("15.0", driver.ProductVersion);
    }

    [Fact]
    public void A_remote_manager_that_throws_reads_null()
    {
        var window = new Dte(Tc("P")) { GetObjectFails = new InvalidOperationException("no TcRemoteManager") };
        var driver = Attached(window);

        Assert.Null(driver.IdeVersion);
        Assert.Equal("TcXaeShell", driver.ProductName);
    }

    [Fact]
    public void An_unreadable_xae_exe_leaves_the_vendor_null()
    {
        var driver = Attached(new Dte(Tc("P")), _ => throw new System.ComponentModel.Win32Exception(5, "Access is denied"));

        Assert.Null(driver.ProductVendor);
        Assert.Equal("3.1.4024.74", driver.IdeVersion);
    }

    [Fact]
    public void An_exe_that_states_no_company_reads_null()
    {
        Assert.Null(Attached(new Dte(Tc("P")), _ => "  ").ProductVendor);
    }

    /// <summary>The build belongs to the open SOLUTION, which can change inside one DTE: it is re-read with the
    /// snapshot, not frozen at bind.</summary>
    [Fact]
    public void The_build_follows_the_open_solution()
    {
        var window = new Dte(Tc("P"));
        var driver = Attached(window);
        window.Remote.Version = "3.1.4024.50";

        driver.SelectProject(new Volt.Contracts.ConnectRequest { Project = "P" });

        Assert.Equal("3.1.4024.50", driver.IdeVersion);
    }

    /// <summary>Review gate 2: the build read runs on the ~5 s health probe, so it is ONE GetObject per snapshot and the
    /// handle it returns is released every time — never one leaked RCW per poll.</summary>
    [Fact]
    public void Each_snapshot_reads_the_remote_manager_once_and_releases_it()
    {
        var window = new Dte(Tc("P"));
        var released = new System.Collections.Generic.List<object>();
        var model = new TcObjectModel { BindWindow = _ => window, ReadXaeVendor = _ => "Beckhoff", ReleaseCom = released.Add, Log = _ => { } };
        var driver = new BeckhoffDriver(model);
        driver.Connect(xaePid: 1);
        int before = window.GetObjectCalls;

        model.OwnSolution();
        model.OwnSolution();

        Assert.Equal(2, window.GetObjectCalls - before);
        Assert.Equal(window.GetObjectCalls, released.Count);
        Assert.All(released, r => Assert.Same(window.Remote, r));
    }

    /// <summary>Review gate 2: a field log names the TwinCAT build — at the first read and whenever it changes, not on
    /// every poll (the attach line names the shell, which is not the build).</summary>
    [Fact]
    public void The_build_is_logged_at_the_first_read_and_on_change_only()
    {
        var window = new Dte(Tc("P"));
        var log = new System.Collections.Generic.List<string>();
        var model = new TcObjectModel { BindWindow = _ => window, ReadXaeVendor = _ => "Beckhoff", Log = log.Add };
        var driver = new BeckhoffDriver(model);
        driver.Connect(xaePid: 1);
        model.OwnSolution();                      // unchanged: no second line
        window.Remote.Version = "";               // the solution closed
        model.OwnSolution();
        model.OwnSolution();

        var builds = log.Where(l => l.StartsWith("twincat build")).ToList();
        Assert.Equal(new[]
        {
            "twincat build (TcRemoteManager.Version): 3.1.4024.74",
            "twincat build (TcRemoteManager.Version): (none stated — no solution open, or unreadable)",
        }, builds);
    }
}
