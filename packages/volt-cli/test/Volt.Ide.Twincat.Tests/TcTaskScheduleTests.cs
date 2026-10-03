using System;
using System.Collections.Generic;
using Volt.Contracts;
using Volt.Engine;
using Volt.Engine.Format.Task;
using Volt.Ide.Twincat;
using Xunit;

namespace Volt.Ide.Twincat.Tests;

/// <summary>
/// The TwinCAT `.task` translation, against XML MEASURED off a live TcXaeShell 15.0 rather than composed here —
/// the fixture strings below are what `probe-tc-task.ps1` (deleted; `git show b2496efb4b:packages/volt-cli/scripts/probe-tc-task.ps1`) printed for `TwinCAT Project14`. A hand-written
/// approximation of a vendor document is the failure `vendor-serialization-needs-identity-gate` records: it makes
/// the test agree with the code and neither agree with the IDE.
/// </summary>
public class TcTaskScheduleTests
{
    // WHY THERE IS NO CODESYS TWIN OF THIS FILE, and why that is not a parity gap.
    //
    // A review flagged it as one: seven offline tests for TwinCAT's task write, none for CODESYS's. The
    // asymmetry is real and it is deliberate, because the two implementations are not the same SHAPE. TwinCAT's
    // half is a PURE translation — XML in, `TaskSettings` out, tick/ns arithmetic — so it is worth pinning
    // offline, and this file does. CODESYS's half is reflection glue over live scripting objects
    // (`ScriptTaskObject`, and `PerformWithWriteableCopy`, whose callback takes a vendor type not referenced at
    // compile time). A hand-rolled double for that would encode what the author BELIEVES those objects do — and
    // the measured surprises there (DIALECT C19: `priority` is a string; the `pous` list discards mutations) are
    // precisely the things such a double would get wrong and then assert.
    //
    // Both vendors ARE covered where it counts: `test/e2e/items/task-writable.test.ts` drives create, edit,
    // call-list rewrite, delete and the canonical-form refusal against a LIVE IDE, with no vendor gate — six
    // tests, run on both bridges. The shared format itself is pinned in `Volt.Engine.Tests`. What is left here
    // is the part only TwinCAT has: two tree items and two units.

    /// <summary>`TIRT^PlcTask`, verbatim, trimmed to the elements this translation reads plus the module context
    /// it verifies against. Priority 20, CycleTime 100000 ticks of 100ns = 10ms.</summary>
    private const string SysTaskXml =
        "<?xml version=\"1.0\"?><TreeItem><ItemName>PlcTask</ItemName><PathName>TIRT^PlcTask</PathName>" +
        "<ItemType>1</ItemType><ObjectId>#x02010030</ObjectId>" +
        "<TaskDef><Priority>20</Priority><AmsPort>350</AmsPort><CycleTime>100000</CycleTime>" +
        "<AutoStart>true</AutoStart><ExceedWarning>0</ExceedWarning></TaskDef>" +
        "<TcModuleInstance><Module><Name>ADT</Name><Contexts><Context><Id>1</Id><Name>PlcTask</Name>" +
        "<Priority>20</Priority><CycleTime>10000000</CycleTime></Context></Contexts></Module></TcModuleInstance>" +
        "</TreeItem>";

    /// <summary>The PLC-side item (type 621). One field, and it is a tree PATH.</summary>
    private const string PlcTaskXml =
        "<TreeItem><ItemName>PlcTask</ItemName><ItemType>621</ItemType>" +
        "<ItemSubTypeName>TREEITEMTYPE_PLCTASK</ItemSubTypeName>" +
        "<PlcTaskDef><LinkedTask>TIRT^PlcTask</LinkedTask></PlcTaskDef><VSProperties /></TreeItem>";

    private static string Xml(string priority, string cycleTicks) =>
        $"<TreeItem><TaskDef><Priority>{priority}</Priority><CycleTime>{cycleTicks}</CycleTime></TaskDef></TreeItem>";

    [Fact]
    public void The_linked_system_task_is_read_off_the_plc_item()
    {
        Assert.Equal("TIRT^PlcTask", TcTaskSchedule.LinkedTaskPath(PlcTaskXml));
        // A POU's metadata has no LinkedTask — null, not an invented path.
        Assert.Null(TcTaskSchedule.LinkedTaskPath("<TreeItem><ItemName>PLC_PRG</ItemName></TreeItem>"));
    }

    /// <summary>The whole point of the change: a TwinCAT `.task` reads like a CODESYS one.</summary>
    [Fact]
    public void A_task_renders_in_the_shared_format()
    {
        var body = TaskDescriptorFormat.Write(TcTaskSchedule.Read(SysTaskXml, new[] { "PLC_PRG" }));
        Assert.Equal(
            "Type:      Cyclic\n" +
            "Interval:  10 ms\n" +
            "Priority:  20\n" +
            // No `Event:` line — the shared format omits an empty value, exactly as the CODESYS corpus files do.
            "Watchdog:  off\n" +
            "Calls:     PLC_PRG\n",
            body.Replace("\r\n", "\n"));
    }

    /// <summary>Canonical by construction — what the driver renders is what a push accepts back, with no
    /// intervening edit. Without this, every pulled TwinCAT task would be refused by
    /// <see cref="TaskDescriptorFormat.Gate"/> the moment anyone pushed it.</summary>
    [Fact]
    public void What_is_rendered_survives_the_push_gate()
    {
        var settings = TcTaskSchedule.Read(SysTaskXml, new[] { "PLC_PRG" });
        var reparsed = TaskDescriptorFormat.Gate(TaskDescriptorFormat.Write(settings));
        // Back through the vendor patch, the numbers the IDE started with.
        Assert.Contains("<Priority>20</Priority>", TcTaskSchedule.SysTaskPatch(reparsed));
        Assert.Contains("<CycleTime>100000</CycleTime>", TcTaskSchedule.SysTaskPatch(reparsed));
    }

    /// <summary>The cycle time picks the largest EXACT unit, and comes back to the same tick count. A 10ms task
    /// reading `10000 µs` would be correct and unreadable; one reading `10 ms` when it is really 10.5 would be
    /// readable and wrong.</summary>
    [Theory]
    [InlineData("100000", "10 ms")]      // the fixture
    [InlineData("10000000", "1000 ms")]  // ms is the largest unit rendered; a second is 1000 of them
    [InlineData("35000", "3500 µs")]     // 3.5ms: not whole ms
    [InlineData("15", "1500 ns")]        // not a whole µs
    public void The_cycle_time_round_trips_through_its_unit(string ticks, string rendered)
    {
        var settings = TcTaskSchedule.Read(Xml("20", ticks), Array.Empty<string>());
        Assert.Equal(rendered, Volt.Engine.Format.St.Descriptor.Unitize(settings.Interval, settings.IntervalUnit));
        Assert.Contains($"<CycleTime>{ticks}</CycleTime>", TcTaskSchedule.SysTaskPatch(settings));
    }

    /// <summary>A field TwinCAT has no way to schedule is REFUSED, not dropped. Dropping it is the silent
    /// divergence this vendor gap was held open to avoid: the file would keep saying `Freewheeling` and the
    /// machine would keep running a cyclic task.
    ///
    /// <para>AND THE CODE SAYS WHICH KIND OF REFUSAL IT IS. Every case here answered BAD_REQUEST, which tells
    /// the engineer their file is malformed — for `Freewheeling`, an event source, a watchdog or a `t#4ms`
    /// interval it is not, and no edit they make can teach this vendor to schedule it. Those are UNSUPPORTED.
    /// A missing unit really is a bad request: `10` means nothing, and adding `ms` fixes it.</para></summary>
    [Theory]
    [InlineData("Type:      Freewheeling\nInterval:  10 ms\nPriority:  20\nWatchdog:  off\n", "Freewheeling", BridgeErrorCodes.Unsupported)]
    // Case-exact, as CODESYS looks up its type names: `cyclic` was accepted here and refused there (review 2e+2g, low).
    [InlineData("Type:      cyclic\nInterval:  10 ms\nPriority:  20\nWatchdog:  off\n", "`Type: cyclic`", BridgeErrorCodes.Unsupported)]
    [InlineData("Type:      Cyclic\nInterval:  10 ms\nPriority:  20\nEvent:     E_Stop\nWatchdog:  off\n", "E_Stop", BridgeErrorCodes.Unsupported)]
    [InlineData("Type:      Cyclic\nInterval:  10 ms\nPriority:  20\nWatchdog:  10 ms (sensitivity 1)\n", "watchdog", BridgeErrorCodes.Unsupported)]
    [InlineData("Type:      Cyclic\nInterval:  t#4ms\nPriority:  20\nWatchdog:  off\n", "t#4ms", BridgeErrorCodes.Unsupported)]
    [InlineData("Type:      Cyclic\nInterval:  150 ns\nPriority:  20\nWatchdog:  off\n", "100ns ticks", BridgeErrorCodes.Unsupported)]
    [InlineData("Type:      Cyclic\nInterval:  10\nPriority:  20\nWatchdog:  off\n", "unit", BridgeErrorCodes.BadRequest)]
    [InlineData("Type:      Cyclic\nInterval:  10 ms\nPriority:  soon\nWatchdog:  off\n", "Priority", BridgeErrorCodes.BadRequest)]
    public void A_field_twincat_cannot_express_is_refused(string body, string mentions, string code)
    {
        var ex = Assert.Throws<BridgeException>(() => TcTaskSchedule.SysTaskPatch(TaskDescriptorFormat.Read(body)));
        Assert.Equal(code, ex.ErrorCode);
        Assert.Contains(mentions, ex.Message, StringComparison.OrdinalIgnoreCase);
    }

    /// <summary>openspec bridge-refusal-review 3.9, DIALECT C19c: TwinCAT's <c>ConsumeXml</c> refuses NO priority — it
    /// stores a UINT16 and coerces anything else silently (<c>-1</c> -> 65535, <c>65536</c> -> 0, <c>99999999999</c> -> 59391,
    /// <c>abc</c> -> 0; <c>scripts/tc-refusal-measure-priority.log</c>). Passed through escaped, the read-back would catch
    /// it only after the system task was overwritten with the coerced number, so the patch keeps refusing it BEFORE the
    /// write — now by the range TwinCAT holds, not merely "a whole number", which let <c>-1</c> through.</summary>
    [Theory]
    [InlineData("-1")]
    [InlineData("65536")]
    [InlineData("99999999999")]
    [InlineData("1.5")]
    [InlineData("0x")]
    [InlineData("0x10000")]
    public void A_priority_TwinCAT_would_coerce_is_refused_before_the_write(string priority)
    {
        var body = $"Type:      Cyclic\nInterval:  10 ms\nPriority:  {priority}\nWatchdog:  off\n";
        var ex = Assert.Throws<BridgeException>(() => TcTaskSchedule.SysTaskPatch(TaskDescriptorFormat.Read(body)));
        Assert.Equal(BridgeErrorCodes.BadRequest, ex.ErrorCode);
        Assert.Contains("0..65535", ex.Message);
    }

    [Theory]
    [InlineData("0", "0")]
    [InlineData("65535", "65535")]
    [InlineData("+3", "3")]
    [InlineData("007", "7")]
    [InlineData(" 7 ", "7")]
    [InlineData("0x10", "16")]   // measured: TwinCAT stores 0x10 as 16, the number it states (review 3a+3b)
    public void A_priority_in_range_is_written_as_its_number(string priority, string written)
    {
        var settings = TaskDescriptorFormat.Read($"Type:      Cyclic\nInterval:  10 ms\nPriority:  {priority}\nWatchdog:  off\n");
        Assert.Contains($"<Priority>{written}</Priority>", TcTaskSchedule.SysTaskPatch(settings));
    }

    /// <summary>The read-back compares the NUMBER: <c>Priority: 007</c> is written as <c>7</c> and TwinCAT reads back
    /// <c>7</c>, which matched the string <c>007</c> never — a landed write reported as one TwinCAT declined.</summary>
    [Fact]
    public void The_read_back_compares_the_priority_as_a_number()
    {
        var want = TcTaskSchedule.Read(SysTaskXml, new[] { "PLC_PRG" }) with { Priority = "020" };
        Assert.True(TcTaskSchedule.Matches(SysTaskXml, want));
    }

    /// <summary>The push PRE-FLIGHT asks the very patch the write builds (<c>ICodeStore.ValidateTask</c>), so a task TwinCAT
    /// cannot hold is refused before the batch's first write, not after its earlier ops landed (review 2e+2g, low).</summary>
    [Fact]
    public void The_pre_flight_refuses_what_the_write_refuses()
    {
        var driver = new BeckhoffDriver(new TcObjectModel());
        var freewheeling = TaskDescriptorFormat.Read("Type:      Freewheeling\nInterval:  10 ms\nPriority:  20\nWatchdog:  off\n");

        var ex = Assert.Throws<BridgeException>(() => driver.ValidateTask(freewheeling));
        Assert.Equal(BridgeErrorCodes.Unsupported, ex.ErrorCode);
        driver.ValidateTask(freewheeling with { Type = "Cyclic" });   // a task TwinCAT holds passes
    }

    /// <summary>The read-back that makes the write safe. It checks BOTH copies the system task publishes —
    /// TaskDef in ticks and the module context in nanoseconds — because a write that moved one and not the
    /// other is precisely the failure nobody could see from the file.</summary>
    [Fact]
    public void The_read_back_rejects_a_schedule_that_only_half_moved()
    {
        var want = TcTaskSchedule.Read(SysTaskXml, new[] { "PLC_PRG" });
        Assert.True(TcTaskSchedule.Matches(SysTaskXml, want));

        // TaskDef moved to 20ms, the module context left at 10ms.
        var halfMoved = SysTaskXml.Replace("<CycleTime>100000</CycleTime>", "<CycleTime>200000</CycleTime>");
        var wantTwenty = TcTaskSchedule.Read(halfMoved.Replace("<CycleTime>10000000</CycleTime>", "<CycleTime>20000000</CycleTime>"),
                                             new[] { "PLC_PRG" });
        Assert.False(TcTaskSchedule.Matches(halfMoved, wantTwenty));

        // And the everyday case: the vendor accepted the call and changed nothing.
        Assert.False(TcTaskSchedule.Matches(SysTaskXml, wantTwenty));
    }

    /// <summary>A system task with no TaskDef is unreadable, and says so. It must not render as a task whose
    /// priority is the empty string — that body would hash identically for every such task.</summary>
    [Fact]
    public void A_system_task_without_a_schedule_is_not_invented()
    {
        var ex = Assert.Throws<InvalidOperationException>(
            () => TcTaskSchedule.Read("<TreeItem><ItemName>PlcTask</ItemName></TreeItem>", Array.Empty<string>()));
        Assert.Contains("TaskDef", ex.Message);
    }
}
