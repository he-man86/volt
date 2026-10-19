using System;
using System.Collections.Generic;
using Volt.Ide.Twincat;
using Xunit;

namespace Volt.Ide.Twincat.Tests;

/// <summary>
/// A WORKER BINDS ITS OWN XAE WINDOW WITHOUT CALLING INTO ANY OTHER (TwinCAT e2e profile, 2026-10-18). The bind asked
/// <c>MainWindow.HWnd</c> of EVERY DTE in the ROT to find the one whose window pid is ours — other engineers' XAE windows
/// too — and a busy one is retried without limit by <c>ComMessageFilter</c>: a connect stalled 269 s and 469 s on a
/// window this worker does not serve. The ROT's display name already states the window's pid
/// (<c>!TcXaeShell.DTE.15.0:&lt;pid&gt;</c>), so a DTE whose name states another pid is never bound and never asked; only a
/// name that states no pid is asked, as before.
/// </summary>
public class TcBindByPidTests
{
    private sealed class Window
    {
        public Window(int pid) => Pid = pid;
        public int Pid { get; }
    }

    private sealed class Rot
    {
        public readonly List<string> Bound = new();
        public readonly List<int> Asked = new();
        public readonly List<int> Released = new();
        public readonly List<RotInstances.RotEntry> Entries = new();

        public Rot Add(string name, int pid)
        {
            Entries.Add(new RotInstances.RotEntry(name, () => { Bound.Add(name); return new Window(pid); }));
            return this;
        }

        public object? Pick(int pid) => RotInstances.PickWindow(pid, Entries,
            dte => { Asked.Add(((Window)dte).Pid); return ((Window)dte).Pid; },
            dte => Released.Add(((Window)dte).Pid));

        public List<int> Pids() => RotInstances.PidsFromNames(Entries,
            dte => { Asked.Add(((Window)dte).Pid); return ((Window)dte).Pid; },
            dte => Released.Add(((Window)dte).Pid));
    }

    /// <summary>The double-click scan lists the XAE windows from the ROT NAMES (openspec
    /// twincat-double-click-next-free-xae): a name that states its pid is the pid, and that DTE is never bound —
    /// one busy XAE must not stall the scan of all of them.</summary>
    [Fact]
    public void The_scan_lists_pids_from_the_names_and_binds_no_entry_whose_name_states_one()
    {
        var rot = new Rot().Add("!TcXaeShell.DTE.15.0:111", 111).Add("!TcXaeShell.DTE.15.0:222", 222);

        Assert.Equal(new[] { 111, 222 }, rot.Pids());
        Assert.Empty(rot.Bound);
        Assert.Empty(rot.Asked);
    }

    [Fact]
    public void The_scan_binds_asks_and_releases_an_entry_whose_name_states_no_pid()
    {
        var rot = new Rot().Add("!VisualStudio.DTE.17.0", 333).Add("!TcXaeShell.DTE.15.0:111", 111).Add("!TcXaeShell.DTE.15.0:111", 111);

        Assert.Equal(new[] { 333, 111 }, rot.Pids());
        Assert.Equal(new[] { "!VisualStudio.DTE.17.0" }, rot.Bound);
        Assert.Equal(new[] { 333 }, rot.Asked);
        Assert.Equal(new[] { 333 }, rot.Released);
    }

    [Fact]
    public void Another_xae_whose_name_states_its_pid_is_never_bound_nor_asked()
    {
        var rot = new Rot().Add("!TcXaeShell.DTE.15.0:111", 111).Add("!TcXaeShell.DTE.15.0:222", 222);

        var picked = rot.Pick(222);

        Assert.Equal(222, Assert.IsType<Window>(picked).Pid);
        Assert.Equal(new[] { "!TcXaeShell.DTE.15.0:222" }, rot.Bound);
        Assert.Equal(new[] { 222 }, rot.Asked);   // the one candidate is confirmed, nothing else is asked
        Assert.Empty(rot.Released);
    }

    [Fact]
    public void A_name_that_states_no_pid_is_asked_as_before_and_released_when_it_is_not_ours()
    {
        var rot = new Rot().Add("!VisualStudio.DTE.17.0", 111).Add("!VisualStudio.DTE.17.0", 222);

        var picked = rot.Pick(222);

        Assert.Equal(222, Assert.IsType<Window>(picked).Pid);
        Assert.Equal(new[] { 111, 222 }, rot.Asked);
        Assert.Equal(new[] { 111 }, rot.Released);
    }

    [Fact]
    public void A_name_stating_our_pid_whose_window_is_another_is_not_taken()
    {
        var rot = new Rot().Add("!TcXaeShell.DTE.15.0:222", 333);

        Assert.Null(rot.Pick(222));
        Assert.Equal(new[] { 333 }, rot.Released);
    }

    [Theory]
    [InlineData("!TcXaeShell.DTE.15.0:4242", 4242)]
    [InlineData("!TcXaeShell64.DTE.17.0:4242", 4242)]
    [InlineData("!VisualStudio.DTE.17.0:4242", 4242)]
    [InlineData("!VisualStudio.DTE.17.0", null)]
    [InlineData("!TcXaeShell.DTE.15.0:", null)]
    [InlineData("!TcXaeShell.DTE.15.0:12a", null)]
    public void The_pid_is_the_number_after_the_last_colon(string name, int? pid) =>
        Assert.Equal(pid, RotInstances.PidInName(name));
}
