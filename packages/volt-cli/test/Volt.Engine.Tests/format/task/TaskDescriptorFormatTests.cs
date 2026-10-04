using System.Collections.Generic;
using Xunit;
using Volt.Engine.Format.Task;

namespace Volt.Engine.Tests;

/// <summary>
/// The `.task` format, both directions.
///
/// <para>It was a renderer inside the CODESYS driver for as long as `.task` was read-only — no C# test executes
/// that assembly, so the only oracle was a live run. Now that a task can be PUSHED, the two directions are a
/// pair and the round trip is a property that can be proven offline, which is the whole reason the format moved
/// into the engine.</para>
///
/// <para><b>The bodies below are real.</b> They are the exact files `volt pull` produced for the corpus
/// projects, padding and all, because these bytes are hashed into the item version: a change here is a diff in
/// every user's repo, and a test written from imagination would not notice.</para>
/// </summary>
public class TaskDescriptorFormatTests
{
    // lenze-mid MainTask: a µs watchdog, a TIME-LITERAL interval (no unit to append), five calls.
    private const string LenzeMain =
        "Type:      Cyclic\n" +
        "Interval:  t#4ms\n" +
        "Priority:  1\n" +
        "Watchdog:  3200 µs (sensitivity 2)\n" +
        "Calls:     Simulation, General, Mach1_MotionControl, MachineStateSetting, FirstErrorCapture\n";

    // lenze-mid OEE_Task: a BARE-NUMBER interval, which is the arm that gets its unit appended.
    private const string LenzeOee =
        "Type:      Cyclic\n" +
        "Interval:  20 ms\n" +
        "Priority:  5\n" +
        "Watchdog:  16 ms (sensitivity 2)\n" +
        "Calls:     ProductionDataInputs\n";

    [Theory]
    [InlineData(LenzeMain)]
    [InlineData(LenzeOee)]
    // A task with no watchdog spells it `off` rather than omitting the line.
    [InlineData("Type:      Cyclic\nInterval:  20 ms\nPriority:  5\nWatchdog:  off\n")]
    // …and one that drives nothing omits `Calls` ENTIRELY: an empty `Calls:` would read as an unnamed callee.
    [InlineData("Type:      Freewheeling\nPriority:  8\nWatchdog:  off\n")]
    // An event task carries the triggering variable.
    [InlineData("Type:      Event\nPriority:  3\nEvent:     GVL.Trigger\nWatchdog:  off\n")]
    public void A_real_task_file_is_a_fixed_point(string body) =>
        Assert.Equal(body, TaskDescriptorFormat.Write(TaskDescriptorFormat.Read(body)));

    [Fact]
    public void The_parts_are_read_back_as_parts_not_as_one_string()
    {
        var t = TaskDescriptorFormat.Read(LenzeMain);
        Assert.Equal("Cyclic", t.Type);
        Assert.Equal("1", t.Priority);
        // A TIME literal keeps its letters and gains NO unit — `Unitize` only joins a bare number, so splitting
        // `t#4ms` into a value and a unit would invent one and then render it back doubled.
        Assert.Equal("t#4ms", t.Interval);
        Assert.Equal("", t.IntervalUnit);
        Assert.Equal("3200", t.Watchdog!.Time);
        Assert.Equal("µs", t.Watchdog!.Unit);
        Assert.Equal("2", t.Watchdog!.Sensitivity);
        Assert.Equal(new[] { "Simulation", "General", "Mach1_MotionControl", "MachineStateSetting", "FirstErrorCapture" },
                     t.Calls);
    }

    [Fact]
    public void A_bare_number_interval_keeps_its_unit_apart()
    {
        var t = TaskDescriptorFormat.Read(LenzeOee);
        Assert.Equal("20", t.Interval);
        Assert.Equal("ms", t.IntervalUnit);
    }

    [Fact]
    public void An_off_watchdog_is_absent_rather_than_zeroed()
    {
        // The vendor keeps stale numbers behind a disabled flag; `null` is how this model says "off" so those
        // numbers can never be written back as if they were live.
        Assert.Null(TaskDescriptorFormat.Read("Type:      Cyclic\nPriority:  5\nWatchdog:  off\n").Watchdog);
    }

    [Fact]
    public void A_FIELD_VOLT_DOES_NOT_KNOW_IS_REFUSED_not_dropped()
    {
        // The failure that matters: a push must never silently discard something the engineer wrote. A field
        // this format cannot round-trip is a field the next pull would delete.
        var ex = Assert.Throws<TaskDescriptorException>(() =>
            TaskDescriptorFormat.Read("Type:      Cyclic\nPriority:  5\nCoreBinding: 2\n"));
        Assert.Contains("CoreBinding", ex.Message);
    }

    /// <summary>A LABEL WRITTEN TWICE IS REFUSED, BY NAME AND LINE (bridge-refusal-review 1+2d review). Read keeps one
    /// value per field, so the earlier line would be dropped without a word — a second `Calls:` line would stop the task
    /// calling a program while the push reported success. The canonical-form gate used to catch it by accident.</summary>
    [Theory]
    [InlineData("Type: Cyclic\nPriority: 5\nCalls: A\nCalls: B\n", "Calls", 4)]
    [InlineData("Type: Cyclic\nPriority: 5\nPriority: 7\n", "Priority", 3)]
    public void A_LABEL_WRITTEN_TWICE_IS_REFUSED_not_last_wins(string body, string label, int line)
    {
        var ex = Assert.Throws<TaskDescriptorException>(() => TaskDescriptorFormat.Gate(body));
        Assert.Contains($"line {line}", ex.Message);
        Assert.Contains($"'{label}'", ex.Message);
    }

    [Theory]
    [InlineData("Priority:  5\n", "Type")]                                   // no kind
    [InlineData("Type:      Cyclic\n", "Priority")]                          // no priority
    public void The_fields_a_task_cannot_do_without_are_required(string body, string missing)
    {
        Assert.Contains(missing, Assert.Throws<TaskDescriptorException>(() => TaskDescriptorFormat.Read(body)).Message);
    }

    /// <summary>EVERY `.task` REFUSAL IS CODED BAD_REQUEST (openspec <c>bridge-refusal-review</c> D14). A malformed
    /// descriptor is the request's grammar, not Volt's broken invariant; uncoded, it fell through
    /// <c>PushService.ConflictFor</c>'s coded-error check and reached the wire as INTERNAL_ERROR. One row per throw site.</summary>
    [Theory]
    [InlineData("Type: Cyclic\nPriority 5\n", "line 2")]                                     // no colon
    [InlineData("Type: Cyclic\nPriority: 5\nPriority: 6\n", "written twice")]                // repeated label
    [InlineData("Type: Cyclic\nPriority: 5\nCoreBinding: 2\n", "CoreBinding")]               // unknown label
    [InlineData("Priority: 5\n", "Type")]                                                    // no Type
    [InlineData("Type: Cyclic\n", "Priority")]                                               // no Priority
    [InlineData("Type: Cyclic\nPriority: 5\nWatchdog: 3200 µs\n", "sensitivity")]            // watchdog, no parens
    [InlineData("Type: Cyclic\nPriority: 5\nWatchdog: 3200 µs (sens 2)\n", "(sens 2)")]      // watchdog, wrong word
    public void Every_refusal_is_coded_BAD_REQUEST(string body, string named)
    {
        var ex = Assert.Throws<TaskDescriptorException>(() => TaskDescriptorFormat.Gate(body));
        Assert.Contains(named, ex.Message);
        var coded = Assert.IsAssignableFrom<Volt.Contracts.ICodedError>(ex);
        Assert.Equal(Volt.Contracts.BridgeErrorCodes.BadRequest, coded.ErrorCode);
    }

    [Fact]
    public void A_malformed_watchdog_says_what_it_expected()
    {
        var ex = Assert.Throws<TaskDescriptorException>(() =>
            TaskDescriptorFormat.Read("Type:      Cyclic\nPriority:  5\nWatchdog:  3200 µs\n"));
        Assert.Contains("sensitivity", ex.Message);
    }

    /// <summary>A NON-CANONICAL DESCRIPTOR IS READ, NOT REFUSED (openspec <c>bridge-refusal-review</c> 2.13). Hand-typed
    /// spacing reads into the same settings the canonical text does; the settings are written and the canonical text
    /// comes back on the next pull — and is the same descriptor, so the push adopts it as layout.</summary>
    [Fact]
    public void The_gate_reads_a_non_canonical_body_and_its_canonical_text_is_the_same_descriptor()
    {
        const string typed = "Type: Cyclic\nPriority: 5\nWatchdog: off\n";
        var settings = TaskDescriptorFormat.Gate(typed);
        Assert.Equal("5", settings.Priority);
        Assert.True(TaskDescriptorFormat.SameDescriptor(typed, TaskDescriptorFormat.Write(settings)));
        Assert.False(TaskDescriptorFormat.SameDescriptor(typed, typed.Replace("Priority: 5", "Priority: 6")));
    }

    [Fact]
    public void The_gate_accepts_what_a_pull_actually_wrote()
    {
        Assert.Equal("1", TaskDescriptorFormat.Gate(LenzeMain).Priority);
        // …and tolerates a lost trailing newline, which an editor can do on its own and is not drift worth refusing.
        Assert.Equal("5", TaskDescriptorFormat.Gate(LenzeOee.TrimEnd('\n')).Priority);
    }

    [Fact]
    public void Calls_survive_order_and_spacing()
    {
        var t = TaskDescriptorFormat.Read("Type:      Cyclic\nPriority:  1\nWatchdog:  off\nCalls:     A,  B ,C\n");
        Assert.Equal(new[] { "A", "B", "C" }, t.Calls);
        // Order is the CALL ORDER — the sequence the task runs them in, so it is content, not a set.
        Assert.Equal("Calls:     A, B, C\n",
                     TaskDescriptorFormat.Write(t with { Type = "Cyclic" }).Split(new[] { "Watchdog:  off\n" }, System.StringSplitOptions.None)[1]);
    }

    [Fact]
    public void Settings_edited_in_the_workspace_render_back()
    {
        // What a user actually does: change the interval and add a POU to the call list.
        var t = TaskDescriptorFormat.Read(LenzeOee);
        var edited = t with { Interval = "50", Calls = new List<string>(t.Calls) { "NewPou" } };
        Assert.Equal(
            "Type:      Cyclic\nInterval:  50 ms\nPriority:  5\nWatchdog:  16 ms (sensitivity 2)\n" +
            "Calls:     ProductionDataInputs, NewPou\n",
            TaskDescriptorFormat.Write(edited));
    }
}
