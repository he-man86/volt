using System.Linq;
using Xunit;
using Volt.Contracts;
using Volt.Engine.Format.Task;
using Volt.Engine.Ide;
using Volt.Engine.Item;
using Volt.Engine.Sync;
using Volt.Tests.Shared;

namespace Volt.Engine.Tests;

/// <summary>
/// Pushing a `.task`, which is the first NON-SOURCE kind a push may write.
///
/// <para>Everything else reaching <c>ApplySetItem</c> is assembled ST, and a task is not: routing it through
/// the ST reader would refuse every task push as a malformed document, in the PRE-FLIGHT, before the item is
/// even resolved. So the ROUTING is what these pin (the descriptor's own layout has its own tests), along
/// with the two structural edits a workspace can express for a task that it cannot for a POU: one ADDED, and
/// one DELETED.</para>
/// </summary>
public class PushTaskTests
{
    private const string Body =
        "Type:      Cyclic\n" +
        "Interval:  20 ms\n" +
        "Priority:  5\n" +
        "Watchdog:  16 ms (sensitivity 2)\n" +
        "Calls:     PLC_PRG\n";

    private static FakeIde WithTask(string name = "MainTask") =>
        new(new FakeIde.Item(name, ItemKind.PlcTask, "Device/Plc Logic/Application/Task Configuration",
                             true, null, null, null, null));

    private static (string Version, string ProjectVersion) Ver(FakeIde ide, string full)
    {
        var refs = RefsService.Handle(ide);
        return (refs.Items[full], refs.ProjectVersion!);
    }

    private static PushResponse Push(FakeIde ide, string projectVersion, params PushOp[] ops) =>
        PushService.Handle(ide, new PushRequest { ExpectedProjectVersion = projectVersion, Ops = ops.ToList() });

    [Fact]
    public void A_task_is_PUSHABLE_at_all()
    {
        // `.task` used to be read-only by virtue of not being ST — access was derived from "is this a source
        // kind", so a descriptor could never be written however writable the vendor made it.
        var task = ItemKind.FileExtensions.Single(x => x.Ext == ItemKind.ExtFor(ItemKind.Kinds.Task));
        Assert.True(task.IsWritable);
        // …and it is still NOT source: not ST, never parsed as ST, and absent from the four
        // SOURCE_EXTENSIONS manifests the wiring check compares.
        Assert.False(task.IsSource);
        Assert.False(ItemKind.IsSourceKind(ItemKind.Kinds.Task));
    }

    [Fact]
    public void An_edited_task_reaches_the_driver_as_DATA_not_text()
    {
        var ide = WithTask();
        var (v, pv) = Ver(ide, "MainTask.task");
        var resp = Push(ide, pv, new SetItemOp { Name = "MainTask.task", IfVersion = v, SourceText = Body });

        Assert.True(resp.Accepted);
        Assert.Contains("writetask:MainTask", ide.Recorded);
        // The engine parsed and gated it, so the driver never sees the file layout.
        var written = ide.WrittenTasks["MainTask"];
        Assert.Equal("5", written.Priority);
        Assert.Equal("20", written.Interval);
        Assert.Equal("ms", written.IntervalUnit);
        Assert.Equal("16", written.Watchdog!.Time);
        Assert.Equal(new[] { "PLC_PRG" }, written.Calls);
    }

    /// <summary>A task the DRIVER refuses from its settings alone — a `Type:` its vendor does not name — is refused in the
    /// PRE-FLIGHT, before the batch's earlier ops land (review 2e+2g, low: CODESYS's unknown-type BAD_REQUEST was found
    /// only by the write, after a new POU earlier in the same push had been created). The driver is handed the settings
    /// the engine's own gate read, never the text.</summary>
    [Fact]
    public void A_task_the_driver_refuses_from_its_settings_is_refused_before_anything_lands()
    {
        var ide = new FakeIde(new FakeIde.Item("MainTask", ItemKind.PlcTask, "Device/Plc Logic/Application/Task Configuration",
                                               true, null, null, null, null))
        {
            ValidatesTask = t =>
            {
                if (t.Type == "Cyclicc") throw new BridgeException(BridgeErrorCodes.BadRequest, $"'{t.Type}' is not a task type");
            },
        };
        var (v, pv) = Ver(ide, "MainTask.task");

        var resp = Push(ide, pv,
            new SetItemOp { Name = "PRG_A.pou", IfVersion = null, ToFolder = "",
                            SourceText = "PROGRAM PRG_A\nVAR\nEND_VAR\nIMPLEMENTATION ST\nx := 2;\nEND_PROGRAM\n" },
            new SetItemOp { Name = "MainTask.task", IfVersion = v, SourceText = Body.Replace("Cyclic", "Cyclicc") });

        Assert.False(resp.Accepted);
        var refused = Assert.Single(resp.Conflicts!, c => c.Name == "MainTask.task");
        Assert.Equal(BridgeErrorCodes.BadRequest, refused.Code);
        Assert.Equal("Cyclicc", Assert.Single(ide.TasksValidated).Type);
        Assert.DoesNotContain(ide.Recorded, r => r.StartsWith("create:") || r.StartsWith("writetask:"));
    }

    [Fact]
    public void A_task_never_goes_through_the_ST_writer()
    {
        var ide = WithTask();
        var (v, pv) = Ver(ide, "MainTask.task");
        Push(ide, pv, new SetItemOp { Name = "MainTask.task", IfVersion = v, SourceText = Body });
        // `writecontent:` is the ST path. A descriptor taking it would mean the body was spliced as a POU.
        Assert.DoesNotContain(ide.Recorded, r => r.StartsWith("writecontent:"));
    }

    [Fact]
    public void A_NEW_task_file_creates_a_real_task()
    {
        // The workspace can express a task that did not exist. Nothing else in the push had to learn about it:
        // the create resolves the Task Configuration folder like any other placement.
        var ide = WithTask();
        var pv = RefsService.Handle(ide).ProjectVersion!;
        var resp = Push(ide, pv, new SetItemOp
        {
            Name = "FastTask.task",
            IfVersion = null,
            ToFolder = "Device/Plc Logic/Application/Task Configuration",
            SourceText = Body,
        });

        Assert.True(resp.Accepted);
        Assert.Contains("create:FastTask", ide.Recorded);
        Assert.Equal(ItemKind.PlcTask, ide.CreatedKinds["FastTask"]);
        Assert.Contains("writetask:FastTask", ide.Recorded);
    }

    [Fact]
    public void A_task_is_created_in_the_task_CONTAINER_even_when_it_is_named_in_another_LANGUAGE()
    {
        // MIGRATION, not editing: the task comes from an ENGLISH project and lands in a target whose container
        // the vendor named in German. A German CODESYS ships the Standard template with "Taskkonfiguration"
        // where the walk of an English project emits "Task Configuration", so resolving the pushed folder by
        // NAME found nothing, created a plain user folder in its place, and the vendor refused the create on a
        // node with no task facet — `node has no ScriptTaskConfigObject facet` — leaving the junk folder behind.
        // Found by `scripts/corpus-migration.ts` pushing a real project into the shipped blank.
        var ide = new FakeIde(new FakeIde.Item("MainTask", ItemKind.PlcTask,
                                               "Device/Plc Logic/Application/Taskkonfiguration",
                                               true, null, null, null, null));
        ide.TaskConfigFolders.Add("Device/Plc Logic/Application/Taskkonfiguration");
        var pv = RefsService.Handle(ide).ProjectVersion!;

        var resp = Push(ide, pv, new SetItemOp
        {
            Name = "FastTask.task",
            IfVersion = null,
            ToFolder = "Device/Plc Logic/Application/Task Configuration",
            SourceText = Body,
        });

        Assert.True(resp.Accepted);
        Assert.Equal(ItemKind.PlcTask, ide.CreatedKinds["FastTask"]);
        // The REAL container, resolved by kind…
        Assert.Equal("Device/Plc Logic/Application/Taskkonfiguration", ide.CreatedParents["FastTask"]);
        // …and no folder invented from the incoming name. This half is the damage: the folder outlived the
        // failed push and was left in the engineer's project.
        Assert.DoesNotContain("create:Task Configuration", ide.Recorded);
    }

    [Fact]
    public void A_DELETED_task_file_removes_the_task()
    {
        // This needed no task-specific code at all — it falls out of `.task` being pushable, which is the point:
        // a delete op was always generic, it just could never be BUILT for a read-only kind.
        var ide = WithTask();
        var (v, pv) = Ver(ide, "MainTask.task");
        var resp = Push(ide, pv, new DeleteItemOp { Name = "MainTask.task", IfVersion = v });

        Assert.True(resp.Accepted);
        Assert.Contains("delete:MainTask", ide.Recorded);
    }

    [Fact]
    public void A_RENAMED_task_file_renames_the_task_in_the_IDE()
    {
        var ide = WithTask();
        var (v, pv) = Ver(ide, "MainTask.task");
        var resp = Push(ide, pv, new SetItemOp
        {
            Name = "MainTask.task",
            ToName = "SlowTask.task",
            IfVersion = v,
            SourceText = Body,
        });

        Assert.True(resp.Accepted);
        // The IDE's own rename, so whatever references the task follows it.
        Assert.Contains("rename:MainTask->SlowTask", ide.Recorded);
        Assert.Contains("writetask:SlowTask", ide.Recorded);
    }

    /// <summary>A BODY THAT IS NOT CANONICAL IS WRITTEN (openspec <c>bridge-refusal-review</c> 2.13): hand-typed spacing
    /// reads into complete settings, which the IDE holds; the canonical text comes back on the next pull. It used to be
    /// refused in the pre-flight for its form.</summary>
    [Fact]
    public void A_BODY_THAT_IS_NOT_CANONICAL_IS_WRITTEN()
    {
        var ide = WithTask();
        var (v, pv) = Ver(ide, "MainTask.task");
        var resp = Push(ide, pv, new SetItemOp
        {
            Name = "MainTask.task",
            IfVersion = v,
            SourceText = "Type: Cyclic\nPriority: 5\nWatchdog: off\n",
        });

        Assert.True(resp.Accepted, string.Join(" | ", (resp.Conflicts ?? new()).Select(c => c.Code + ": " + c.Reason)));
        Assert.Contains("writetask:MainTask", ide.Recorded);
    }

    [Fact]
    public void A_FIELD_VOLT_CANNOT_ROUND_TRIP_stops_the_push()
    {
        var ide = WithTask();
        var (v, pv) = Ver(ide, "MainTask.task");
        var resp = Push(ide, pv, new SetItemOp
        {
            Name = "MainTask.task",
            IfVersion = v,
            SourceText = Body.TrimEnd('\n') + "\nCoreBinding: 2\n",
        });

        Assert.False(resp.Accepted);
        Assert.Contains("CoreBinding", resp.Conflicts![0].Reason);
        // The request's grammar, not Volt's broken invariant: BAD_REQUEST on the wire, never the INTERNAL_ERROR
        // default an uncoded exception falls to (openspec bridge-refusal-review D14).
        Assert.Equal(BridgeErrorCodes.BadRequest, resp.Conflicts![0].Code);
        Assert.Empty(ide.Recorded);
    }
}
