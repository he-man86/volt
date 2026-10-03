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

    /// <summary>Task 4.1: the TwinCAT identity as a client reads it — over the shared host's real pipe, the shell is
    /// the product and the build is <c>ideVersion</c>; the shell's <c>15.0</c> never reaches <c>ideVersion</c>, and
    /// with no build stated the field — top level AND every row's <c>version</c> — is ABSENT (null), not the shell version.</summary>
    [Fact]
    public void Health_through_the_pipe_carries_the_shell_as_product_and_the_build_as_ide_version()
    {
        var window = new Dte(Tc("TwinCAT Project14"));
        var h = HealthOverPipe(Attached(window, pid: 9112));

        Assert.Equal("TcXaeShell", h.GetProperty("productName").GetString());
        Assert.Equal("15.0", h.GetProperty("productVersion").GetString());
        Assert.Equal("Beckhoff", h.GetProperty("productVendor").GetString());
        Assert.Equal("3.1.4024.74", h.GetProperty("ideVersion").GetString());
        var rows = h.GetProperty("projects").EnumerateArray().ToList();
        Assert.NotEmpty(rows);                                                // Assert.All passes on an empty array
        Assert.All(rows, p => Assert.Equal("3.1.4024.74", p.GetProperty("version").GetString()));
        Assert.False(string.IsNullOrEmpty(h.GetProperty("bridgeVersion").GetString()));

        var empty = new Dte(Tc("TwinCAT Project14"));
        empty.Remote.Version = "";
        var none = HealthOverPipe(Attached(empty));
        Assert.False(none.TryGetProperty("ideVersion", out _));            // absent on the wire means null
        Assert.Equal("15.0", none.GetProperty("productVersion").GetString());
        // The rows too: the tray's multi-instance label reads a row's `version`, and with no build stated it is absent —
        // never the shell's 15.0 (or anything else) in its place.
        var noneRows = none.GetProperty("projects").EnumerateArray().ToList();
        Assert.NotEmpty(noneRows);
        Assert.All(noneRows, p => Assert.False(p.TryGetProperty("version", out _), $"row version is {p}"));
    }

    private static System.Text.Json.JsonElement HealthOverPipe(BeckhoffDriver driver)
    {
        var pipe = "volt.test." + Guid.NewGuid().ToString("N");
        using var host = new Volt.Engine.Host.BridgePipeHost(driver, pipe);
        host.Start();
        return new Volt.Wire.PipeClient(pipe).Call("health");
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

    /// <summary>The attach line is the dev loop's readiness signal: <c>ide.ps1 up -Vendor twincat</c> waits for the
    /// worker's log line matching its <c>Test-TwincatAttached</c> pattern. Step 2 of ide-identity-report reworded the
    /// line (<c>attached to TwinCAT …</c> → <c>attached to TcXaeShell 15.0 by Beckhoff (xae pid N)</c>) and the script
    /// kept waiting for the old words — found live 2026-10-03 (5.1): the worker attached on every one of ten tries
    /// and the script killed it and failed. The pattern is read FROM the script, so either side changing is caught.</summary>
    [Fact]
    public void The_attach_line_is_the_one_ide_ps1_waits_for()
    {
        var window = new Dte(Tc("P"));
        var log = new System.Collections.Generic.List<string>();
        var model = new TcObjectModel { BindWindow = _ => window, ReadXaeVendor = _ => "Beckhoff", Log = log.Add };
        new BeckhoffDriver(model).Connect(xaePid: 4242);

        var script = System.IO.File.ReadAllText(System.IO.Path.Combine(RepoScripts(), "ide.ps1"));
        var m = System.Text.RegularExpressions.Regex.Match(script,
            @"function Test-TwincatAttached[\s\S]*?-Pattern ""(?<p>[^""]+)""");
        Assert.True(m.Success, "ide.ps1 no longer has a Test-TwincatAttached -Pattern");
        var pattern = m.Groups["p"].Value.Replace("$xaePid", "4242");

        var attach = Assert.Single(log, l => l.StartsWith("attached to "));
        Assert.Equal("attached to TcXaeShell 15.0 by Beckhoff (xae pid 4242)", attach);
        Assert.Matches(pattern, attach);
    }

    private static string RepoScripts()
    {
        var dir = new System.IO.DirectoryInfo(System.AppContext.BaseDirectory);
        while (dir != null && !System.IO.File.Exists(System.IO.Path.Combine(dir.FullName, "scripts", "ide.ps1"))) dir = dir.Parent;
        return System.IO.Path.Combine(dir?.FullName ?? throw new System.InvalidOperationException("scripts/ide.ps1 not found"), "scripts");
    }
}
