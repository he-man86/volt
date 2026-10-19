using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Volt.Contracts;
using Volt.Ide.Twincat;
using Volt.Tests.Shared;
using Volt.Wire;
using Xunit;

namespace Volt.Ide.Twincat.Tests;

/// <summary>
/// THE DOUBLE-CLICK START SERVES THE FIRST XAE WINDOW IT CAN CLAIM (openspec twincat-double-click-next-free-xae). The
/// PLC Assist field log of 2026-10-19: a second bridge started by double-click took the first XAE (served or not),
/// attached to it, then found its pipe name taken and exited, the console window gone before anyone read why. Every
/// part that touches the machine (the ROT, the pipe-name claim, the window caption, the console, the wait between
/// scans, the attach and the stop) is injected; the pipe server and the bridge host are the real ones.
/// </summary>
[Collection(VoltLogTee.Name)]
public class TcWorkerStartTests
{
    private sealed class Run
    {
        // Letters only, so no pid a test looks for in a console line can appear inside a pipe name by chance.
        public readonly string Prefix = "volt.test.start." + new string(Guid.NewGuid().ToByteArray().Select(b => (char)('a' + b % 26)).ToArray()) + ".";
        public readonly HashSet<int> Held = new();
        public readonly List<int> Attached = new();
        public readonly List<int> Claimed = new();
        public readonly StringWriter Console = new();
        public readonly List<string> Log = new();
        public readonly List<TimeSpan> Waits = new();
        public int Enters;
        public int Scans;
        public Func<int, IReadOnlyList<int>> PidsAt = _ => Array.Empty<int>();
        public Action<int> OnScan = _ => { };
        public Action OnAttach = () => { };
        public Func<FakeIde> Driver = () => new FakeIde(Array.Empty<FakeIde.Item>());
        public Func<int, string> PipeName;
        public readonly Dictionary<int, string> Captions = new();
        private readonly Dictionary<string, int> _pidOf = new();

        public Run() => PipeName = pid => Prefix + pid;

        public WorkerStart Start() => new(new WorkerStart.Parts
        {
            Pids = () => { var n = Scans++; OnScan(n); return PidsAt(n); },
            PipeName = pid => { var name = PipeName(pid); _pidOf[name] = pid; return name; },
            Claim = name =>
            {
                var pid = _pidOf[name];
                if (Held.Contains(pid)) throw new PipeNameTakenException(name);
                Claimed.Add(pid);
                return PipeServer.TakeName(name);
            },
            Caption = pid => Captions.TryGetValue(pid, out var c) ? c : "",
            Attach = pid =>
            {
                Attached.Add(pid);
                OnAttach();
                return new WorkerStart.Attached(Driver(), () => { });
            },
            Console = Console,
            WaitForEnter = () => Enters++,
            Wait = Waits.Add,
            Stop = () => new NoWait(),
            Log = (level, m) => Log.Add(level + " " + m),
        });

        public string Out => Console.ToString();
    }

    private sealed class NoWait : WorkerStart.IStop
    {
        public void Wait() { }
        public void Dispose() { }
    }

    private static int Count(string text, string part)
    {
        int n = 0, at = 0;
        while ((at = text.IndexOf(part, at, StringComparison.Ordinal)) >= 0) { n++; at += part.Length; }
        return n;
    }

    [Fact]
    public void A_window_whose_pipe_name_is_held_is_passed_over_untouched_and_the_next_is_served()
    {
        var run = new Run { PidsAt = _ => new[] { 1234, 5678 } };
        run.Held.Add(1234);

        Assert.Equal(0, run.Start().RunDoubleClick());

        Assert.Equal(new[] { 5678 }, run.Attached);
        Assert.Equal(new[] { 5678 }, run.Claimed);
        Assert.Equal(0, run.Enters);
    }

    [Fact]
    public void Two_free_windows_serve_the_first_and_the_console_names_both_with_their_captions()
    {
        var run = new Run { PidsAt = _ => new[] { 1234, 5678 } };
        run.Captions[1234] = "Lift - TcXaeShell";
        run.Captions[5678] = "Line1 - TcXaeShell";

        Assert.Equal(0, run.Start().RunDoubleClick());

        Assert.Equal(new[] { 1234 }, run.Attached);
        var serving = run.Out.Split('\n').Single(l => l.Contains("Serving"));
        Assert.Contains("1234", serving);
        Assert.Contains("Lift - TcXaeShell", serving);
        var other = run.Out.Split('\n').Single(l => l.Contains("5678"));
        Assert.Contains("Line1 - TcXaeShell", other);
        Assert.DoesNotContain("already served", other);
    }

    [Fact]
    public void A_window_found_taken_before_the_served_one_is_named_as_served()
    {
        var run = new Run { PidsAt = _ => new[] { 1234, 5678 } };
        run.Captions[1234] = "Lift - TcXaeShell";
        run.Held.Add(1234);

        run.Start().RunDoubleClick();

        var taken = run.Out.Split('\n').Single(l => l.Contains("1234"));
        Assert.Contains("Lift - TcXaeShell", taken);
        Assert.Contains("already served by another Volt bridge", taken);
    }

    [Fact]
    public void Every_window_served_names_them_once_per_change_keeps_scanning_and_serves_the_first_freed()
    {
        var run = new Run
        {
            // scans 0-1: [1234]; scans 2-3: [1234, 5678]; from scan 4 the bridge on 5678 has stopped
            PidsAt = n => n < 2 ? new[] { 1234 } : new[] { 1234, 5678 },
        };
        run.Captions[1234] = "Lift - TcXaeShell";
        run.Captions[5678] = "Line1 - TcXaeShell";
        run.Held.Add(1234);
        run.Held.Add(5678);
        run.OnScan = n => { if (n == 4) run.Held.Remove(5678); };

        Assert.Equal(0, run.Start().RunDoubleClick());

        Assert.Equal(new[] { 5678 }, run.Attached);
        Assert.Equal(5, run.Scans);
        Assert.Equal(2, Count(run.Out, "already served by another Volt bridge:"));
        var lines = run.Out.Split('\n');
        Assert.Contains(lines, l => l.Contains("1234") && l.Contains("Lift - TcXaeShell"));
        Assert.Contains(lines, l => l.Contains("5678") && l.Contains("Line1 - TcXaeShell"));
        Assert.Equal(0, run.Enters);
    }

    [Fact]
    public void No_window_for_more_than_ten_minutes_is_still_scanning_and_serves_the_first_that_opens()
    {
        var run = new Run { PidsAt = n => n < 400 ? Array.Empty<int>() : new[] { 4242 } };

        Assert.Equal(0, run.Start().RunDoubleClick());

        Assert.True(run.Waits.Aggregate(TimeSpan.Zero, (a, w) => a + w) > TimeSpan.FromMinutes(10));
        Assert.Equal(new[] { 4242 }, run.Attached);
        Assert.Equal(1, Count(run.Out, "Looking for"));
    }

    [Fact]
    public void A_host_that_cannot_start_after_the_claim_says_why_and_waits_for_Enter()
    {
        // "anonymous" is the BCL's reserved name: the one bind failure forcible offline (PipeTransportTests).
        var run = new Run { PidsAt = _ => new[] { 1234 } };
        run.PipeName = _ => "anonymous";

        var rc = run.Start().RunDoubleClick();

        Assert.NotEqual(0, rc);
        Assert.Equal(1, run.Enters);
        Assert.Contains("anonymous", run.Out);
        Assert.Contains("Press Enter", run.Out);
        PipeServer.TakeName("anonymous").Dispose();   // the failed start released its claim
    }

    [Fact]
    public void A_failure_before_the_claim_says_why_and_waits_for_Enter()
    {
        var run = new Run { PidsAt = _ => throw new InvalidOperationException("the ROT is gone") };

        Assert.NotEqual(0, run.Start().RunDoubleClick());

        Assert.Equal(1, run.Enters);
        Assert.Contains("the ROT is gone", run.Out);
        Assert.Empty(run.Attached);
    }

    [Fact]
    public void A_supervised_start_on_a_held_name_exits_3_with_the_reason_in_the_log_and_never_attaches()
    {
        var run = new Run();
        run.Held.Add(1234);

        Assert.Equal(3, run.Start().RunSupervised(1234));

        Assert.Empty(run.Attached);
        Assert.Contains(run.Log, l => l.StartsWith("Error", StringComparison.Ordinal) && l.Contains("already served"));
        Assert.Equal(0, run.Enters);
    }

    // ── what the console says (openspec bridge-console-says-what-it-serves) ─────────────────────────────────────────

    /// <summary>For a double-click start the console window is the whole user interface, so every log line at Info and
    /// above is written to it as well; under <c>--xae-pid</c> the connector already writes the worker's stdout into the
    /// log, so the tee is off.</summary>
    [Fact]
    public void A_double_click_start_tees_the_log_at_Info_and_above_to_its_console()
    {
        var info = "tee-info-" + Guid.NewGuid().ToString("N");
        var debug = "tee-debug-" + Guid.NewGuid().ToString("N");
        var run = new Run { PidsAt = _ => new[] { 1234 } };
        run.OnAttach = () => { VoltLog.Info(info); VoltLog.Debug(debug); };

        run.Start().RunDoubleClick();

        Assert.Contains(info, run.Out);
        Assert.DoesNotContain(debug, run.Out);
        VoltLog.Info(info + "-after");
        Assert.DoesNotContain(info + "-after", run.Out);   // the tee ends with the start
    }

    [Fact]
    public void A_supervised_start_tees_nothing_to_its_console()
    {
        var info = "tee-info-" + Guid.NewGuid().ToString("N");
        var run = new Run();
        run.OnAttach = () => VoltLog.Info(info);

        run.Start().RunSupervised(1234);

        Assert.DoesNotContain(info, run.Out);
    }

    /// <summary>The pipe-up line is printed whatever the attach did, so it claims nothing about TwinCAT or the relay:
    /// the attach's own lines (the served solution, <c>Unsupported</c>) say that, through the tee.</summary>
    [Theory]
    [InlineData(false, null)]
    [InlineData(true, "TcXaeShell 15.0: the bridge cannot read XAE's Solution Explorer")]
    public void No_console_line_says_connected_and_the_pipe_up_line_says_only_that_the_pipe_is_up(bool connected, string? unsupported)
    {
        var run = new Run { PidsAt = _ => new[] { 1234 } };
        run.Driver = () => new FakeIde(Array.Empty<FakeIde.Item>()) { HealthConnected = connected, UnsupportedReason = unsupported };

        Assert.Equal(0, run.Start().RunDoubleClick());

        Assert.DoesNotContain("connected", run.Out, StringComparison.OrdinalIgnoreCase);
        var up = run.Out.Split('\n').Single(l => l.Contains(run.Prefix + "1234"));
        Assert.Contains("is up", up);
        Assert.Contains("Close this window to stop the bridge", up);
    }

    [Fact]
    public void A_supervised_start_on_a_free_name_attaches_and_serves()
    {
        var run = new Run();

        Assert.Equal(0, run.Start().RunSupervised(1234));

        Assert.Equal(new[] { 1234 }, run.Attached);
        Assert.Equal(0, run.Enters);
    }
}

/// <summary>The log tee is process-wide: while a start in this collection tees, a line another test logs in parallel
/// would land on its console. So nothing runs beside it.</summary>
[CollectionDefinition(Name, DisableParallelization = true)]
public sealed class VoltLogTee
{
    public const string Name = "VoltLog tee";
}
