using System;
using Volt.Engine.Format.Task;
using Xunit;

namespace Volt.Engine.Tests.OneToOne;

/// <summary>
/// FINDING 4 — A TASK'S MEMBERS FOLDED, HIDDEN OR UNSPELLED, the shared FORMAT half (openspec <c>bridge-one-to-one</c>
/// proposal 4, design §1.2 "Task descriptor" and "One watchdog spelling", §1.1 "Tasks", §2.2).
///
/// <para>The descriptor has six labels. An external event is folded into <c>Event:</c> (a push then MOVES it to the
/// event member), a disabled watchdog's values are hidden (the vendor keeps them behind the flag: 3 tasks, <c>3200 µs</c>
/// on two), a call's comment has no place, and a watchdog unit after a TIME literal is dropped (<c>Descriptor.Unitize</c>)
/// — <c>3200 µs</c> could push back as <c>3200</c> in <c>ms</c>, a 1000× change. The design adds <c>External event:</c>,
/// <c>Watchdog: [off ]&lt;time&gt; &lt;unit&gt; (sensitivity &lt;n&gt;)</c> with <c>''</c> for an empty member,
/// <c>Calls: A // &lt;comment&gt;, B</c>, and one label per other task member where it differs from the measured value.</para>
///
/// <para>Each case is a FIXED POINT of the format — <c>Write(Read(text)) == text</c> — and reads the vendor's members
/// apart. Red until 3.1 (the format) — the vendor halves are the drivers' tests (<c>CodesysTaskMembersTests</c>,
/// <c>TcTaskDefMembersTests</c>).</para>
/// </summary>
public class TaskDescriptorMembersTests
{
    private const string Task = "3.1";

    private static string Desc(params string[] lines) => string.Join("\n", lines) + "\n";

    /// <summary><c>Write(Read(text))</c> states the same labels with the same values, in the same order. The column
    /// the values start at is the writer's (<c>Descriptor</c> padding), not a vendor member, so it is not compared.</summary>
    private static void FixedPoint(string text) =>
        Assert.Equal(Pairs(text), Pairs(TaskDescriptorFormat.Write(TaskDescriptorFormat.Read(text))));

    private static (string Label, string Value)[] Pairs(string text) =>
        System.Linq.Enumerable.ToArray(System.Linq.Enumerable.Select(
            System.Linq.Enumerable.Where(text.Replace("\r", "").Split('\n'), l => l.Trim().Length > 0),
            l => (l.Substring(0, l.IndexOf(':')).Trim(), l.Substring(l.IndexOf(':') + 1).Trim())));

    /// <summary>An external event is its own label, never folded into <c>Event:</c> (0 in the corpora; the fold is
    /// <c>CodesysObjectModel.Descriptors.cs:165-166/257</c>).</summary>
    [Fact]
    public void An_external_event_is_its_own_label()
    {
        ExpectRed.Until<TaskDescriptorException>(Task, "finding 4: an external event has no label",
            "'External event' is not a task field", () =>
        {
            var text = Desc("Type:      ExternalEvent", "Interval:  10 ms", "Priority:  1", "External event: CanRx",
                            "Watchdog:  off '' ms (sensitivity 1)");
            FixedPoint(text);
            Assert.Null(TaskDescriptorFormat.Read(text).Event);
        });
    }

    /// <summary>A disabled watchdog's values are the vendor's (measured kept across a reload, the non-default unit too,
    /// <c>watchdog-off-values</c>): spelled behind <c>off</c>, read apart.</summary>
    [Fact]
    public void A_disabled_watchdog_keeps_its_values()
    {
        ExpectRed.Until(Task, "finding 4: a disabled watchdog's values are hidden", () =>
        {
            var text = Desc("Type:      Cyclic", "Interval:  10 ms", "Priority:  1", "Watchdog:  off 123 µs (sensitivity 3)");
            FixedPoint(text);
            var w = TaskDescriptorFormat.Read(text).Watchdog;
            Assert.NotNull(w);
            Assert.Equal(("123", "µs", "3"), (w!.Time, w.Unit, w.Sensitivity));
        });
    }

    /// <summary>An EMPTY vendor member is spelled <c>''</c> — the census's CTP watchdog: time <c>''</c>, unit <c>ms</c>,
    /// sensitivity <c>1</c>, disabled.</summary>
    [Fact]
    public void An_empty_watchdog_member_is_spelled_as_an_empty_string()
    {
        ExpectRed.Until(Task, "finding 4: an empty watchdog member has no spelling", () =>
        {
            var text = Desc("Type:      Cyclic", "Interval:  10 ms", "Priority:  1", "Watchdog:  off '' ms (sensitivity 1)");
            FixedPoint(text);
            var w = TaskDescriptorFormat.Read(text).Watchdog;
            Assert.NotNull(w);
            Assert.Equal(("", "ms", "1"), (w!.Time, w.Unit, w.Sensitivity));
        });
    }

    /// <summary>The unit is a vendor member of its own and is never dropped after a TIME literal (<c>Unitize</c>'s fold,
    /// deleted for the watchdog): <c>t#4ms</c> in <c>ms</c> is spelled with its unit.</summary>
    [Fact]
    public void A_watchdog_unit_is_spelled_after_a_time_literal_too()
    {
        ExpectRed.Until(Task, "finding 4: the watchdog unit is dropped after a TIME literal", () =>
        {
            var settings = new TaskSettings("Cyclic", "10", "ms", "1", null, new TaskWatchdog("t#4ms", "µs", "1"),
                                            Array.Empty<string>());
            var text = TaskDescriptorFormat.Write(settings);
            Assert.Contains("t#4ms µs (sensitivity 1)", text);
            Assert.Equal(("t#4ms", "µs"), (TaskDescriptorFormat.Read(text).Watchdog!.Time, TaskDescriptorFormat.Read(text).Watchdog!.Unit));
        });
    }

    /// <summary>A call's comment (<c>TaskPOUCallObject.Commet</c>, 19 × <c>""</c> in the corpora) is spelled after
    /// <c>//</c>, only when non-empty; the call's NAME stays the name.</summary>
    [Fact]
    public void A_call_comment_is_spelled_after_the_call()
    {
        ExpectRed.Until(Task, "finding 4: a call comment has no spelling", () =>
        {
            var text = Desc("Type:      Cyclic", "Interval:  10 ms", "Priority:  1", "Watchdog:  off '' ms (sensitivity 1)",
                            "Calls:     PLC_PRG // runs first, Logger");
            FixedPoint(text);
            Assert.Equal(new[] { "PLC_PRG", "Logger" }, TaskDescriptorFormat.Read(text).Calls);
        });
    }

    /// <summary>A task member off the value measured on 13/13 tasks gets a label of its own, stating the vendor value
    /// (<c>Core: 1</c>); at the measured value it has none.</summary>
    [Theory]
    [InlineData("Core:      1")]
    [InlineData("Core2:     0")]
    [InlineData("Task group: Motion")]
    [InlineData("Allow empty: true")]
    [InlineData("Implicit:  true")]
    [InlineData("Within SPS time slicing: false")]
    [InlineData("Synch task: MainTask")]
    public void A_task_member_off_its_measured_value_is_labelled(string line)
    {
        ExpectRed.Until<TaskDescriptorException>(Task, $"finding 4: '{line.Split(':')[0]}' has no label",
            $"'{line.Split(':')[0]}' is not a task field", () =>
            FixedPoint(Desc("Type:      Cyclic", "Interval:  10 ms", "Priority:  1", "Watchdog:  off '' ms (sensitivity 1)", line)));
    }
}
