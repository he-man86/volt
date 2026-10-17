using System;
using Volt.Engine.Format.Task;
using Volt.Engine.Item;
using Volt.Tests.Shared;
using Xunit;

namespace Volt.Ide.Twincat.Tests;

/// <summary>
/// THE TWINCAT DRIVER'S HALF OF THE BRIDGE-ONE-TO-ONE RED TESTS (openspec <c>bridge-one-to-one</c> §2.2), marked red
/// (<see cref="ExpectRed"/>) until the step-3 task that closes each:
/// <list type="bullet">
/// <item>finding 4 — a <c>TaskDef</c> member other than <c>Priority</c> / <c>CycleTime</c> is never read
/// (<c>TcTaskSchedule.cs:53-63</c>): a task that does not auto-start pulls like one that does;</item>
/// <item>finding 8 — the fallbacks: a whitespace body read as none (<c>BeckhoffDriver.Content.cs:313</c>), a missing
/// declaration or implementation read as <c>""</c> (<c>TcObjectModel.cs:503/512</c>).</item>
/// </list>
/// </summary>
public class TcOneToOneRedTests
{
    // ── finding 4: TaskDef members ──────────────────────────────────────────────────────────────────────────────────

    /// <summary>The system task's <c>TaskDef</c> as <c>TIRT^PlcTask</c> answers it (<c>TcTaskScheduleTests</c>'
    /// measured document), with one member set.</summary>
    private static string SysTask(string autoStart) =>
        "<?xml version=\"1.0\"?><TreeItem><ItemName>PlcTask</ItemName><PathName>TIRT^PlcTask</PathName>" +
        "<TaskDef><Priority>20</Priority><AmsPort>350</AmsPort><CycleTime>100000</CycleTime>" +
        TcTaskScheduleTests.MeasuredTaskDefRest.Replace("<AutoStart>true</AutoStart>", $"<AutoStart>{autoStart}</AutoStart>") +
        "</TaskDef></TreeItem>";

    /// <summary>A <c>TaskDef</c> member off the value measured on the corpus task gets a label of its own (design §1.1
    /// tasks): <c>AutoStart false</c> is a different task from <c>AutoStart true</c>, and must pull differently.</summary>
    [Fact]
    public void A_taskdef_member_off_its_measured_value_is_spelled()
    {
        var calls = new[] { "MAIN" };
        var on = TaskDescriptorFormat.Write(TcTaskSchedule.Read(SysTask("true"), calls));
        var off = TaskDescriptorFormat.Write(TcTaskSchedule.Read(SysTask("false"), calls));
        // At its measured value (true) the member adds no line; off it, exactly ONE line more — the AutoStart label
        // with the value as the vendor holds it — and every other line unchanged. (The label's spelling is 3.3's to
        // choose; that it names AutoStart and carries `false` is not.)
        var onLines = on.Replace("\r\n", "\n").Split('\n');
        var offLines = off.Replace("\r\n", "\n").Split('\n');
        Assert.Equal(onLines.Length + 1, offLines.Length);
        var extra = Assert.Single(offLines, l => !System.Linq.Enumerable.Contains(onLines, l));
        Assert.Matches(new System.Text.RegularExpressions.Regex(
            @"^auto\s*start\s*:\s*false$", System.Text.RegularExpressions.RegexOptions.IgnoreCase), extra);
    }

    // ── finding 8: the fallbacks ────────────────────────────────────────────────────────────────────────────────────

    private static ItemContent Read(TcHiddenBodyWriteTests.Node node) =>
        new BeckhoffDriver(new TcObjectModel()).ReadContent(TcRefs.LooseRef(node));

    /// <summary>A whitespace-only ST body is stored characters: spelled, never read as "no body".</summary>
    [Fact]
    public void A_whitespace_only_body_is_spelled_not_read_as_none()
    {
        var read = Read(new TcHiddenBodyWriteTests.Node("FB_Blank", ItemKind.PlcPou, "FUNCTION_BLOCK FB_Blank\nVAR\nEND_VAR", "\t\n"));
        Assert.NotNull(read.Body);
        Assert.Contains("\t", read.Body);
    }

    /// <summary>A POU whose <c>DeclarationText</c> answers nothing is refused by name — never read as <c>""</c>, which
    /// writes an emptied POU into the workspace (<c>TcObjectModel.ReadDeclaration</c>).</summary>
    [Fact]
    public void A_missing_declaration_is_refused_by_name()
    {
        var node = new TcHiddenBodyWriteTests.Node("FB_NoDecl", ItemKind.PlcPou, null!, "x := 1;");
        var ex = Assert.ThrowsAny<Exception>(() => Read(node));
        Assert.Contains("FB_NoDecl", ex.Message);
    }

    /// <summary>A POU whose <c>ImplementationText</c> answers nothing is refused by name — a POU has a body slot, so
    /// "no text" there is no empty body (<c>TcObjectModel.ReadImplementation</c>'s <c>?? ""</c>).</summary>
    [Fact]
    public void A_missing_implementation_on_a_pou_is_refused_by_name()
    {
        var node = new TcHiddenBodyWriteTests.Node("FB_NoBody", ItemKind.PlcPou, "FUNCTION_BLOCK FB_NoBody\nVAR\nEND_VAR", null!);
        var ex = Assert.ThrowsAny<Exception>(() => Read(node));
        Assert.Contains("FB_NoBody", ex.Message);
    }
}
