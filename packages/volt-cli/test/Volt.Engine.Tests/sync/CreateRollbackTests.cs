using System;
using System.Linq;
using Volt.Contracts;
using Volt.Engine.Item;
using Volt.Engine.Sync;
using Xunit;

namespace Volt.Engine.Tests;

/// <summary>
/// A REFUSED CREATE LEAVES NOTHING BEHIND.
///
/// <para>The create site has always said so — <i>"a refused push must not leave an orphaned, unlisted stub POU
/// behind that blocks the next create"</i> — and it validates the pushed TEXT before creating anything. Text is
/// the half that is knowable up front. TwinCAT's graphical create resolves the body through a PLCopen import,
/// and the importer can return FEWER networks than were pushed, because PLCopen has no element for an empty one
/// (D25). The refusal is correct and it arrives from INSIDE the content write — after the item exists.</para>
///
/// <para><b>Measured on a live XAE.</b> Pushing a two-network LD body whose second network holds only a label
/// was refused with <c>the number of networks changes (1 -&gt; 2)</c>, and left this in the project:</para>
/// <code>
///   PROGRAM VltProbeLadder
///   VAR
///   END_VAR
///
///   NETWORK 0 FBD
///   END_NETWORK
/// </code>
/// <para>An empty shell wearing the engineer's POU name, which the next pull materializes as though they had
/// written it. A corpus migration read that shell back as five separate losses — declaration, language, two
/// labels, a whole network — and it was never a silent success: it was a refusal whose wreckage looked like
/// one. Diagnosing it as data loss cost real time, which is why the shape is pinned here rather than described
/// in a comment.</para>
///
/// <para>An UPDATE is deliberately not rolled back. The item was the engineer's before the push and stays
/// theirs; deleting it because a write failed would be the far worse bug.</para>
/// </summary>
public class CreateRollbackTests
{
    private const string Decl = "FUNCTION_BLOCK FB_New\nVAR\nEND_VAR";
    private const string Source = Decl + "\n(* @volt-implementation *)\nn := 1;\n\nEND_FUNCTION_BLOCK\n";

    /// <summary>A fake that creates happily and refuses every content write — the shape of the live failure,
    /// where the refusal can only come from the vendor's own import.</summary>
    private static FakeIde Refusing(params FakeIde.Item[] items) =>
        new(items)
        {
            RefuseContentWrite = _ => new BridgeException(
                BridgeErrorCodes.Unsupported,
                "the number of networks changes (1 -> 2), which Volt cannot do through the archive"),
        };

    private static PushResponse Push(FakeIde ide, string name, string source, string? ifVersion)
    {
        var refs = RefsService.Handle(ide);
        return PushService.Handle(ide, new PushRequest
        {
            ExpectedProjectVersion = refs.ProjectVersion,
            Ops = new() { new SetItemOp { Name = name, ToFolder = "", SourceText = source, IfVersion = ifVersion } },
        });
    }

    /// <summary>Every refusal reason on a response, safe on an ACCEPTED one (where `Conflicts` is null).</summary>
    private static string Reasons(PushResponse res) =>
        res.Conflicts is null ? "(none)" : string.Join(" | ", res.Conflicts.Select(c => c.Reason));

    /// <summary>THE REGRESSION. Before the rollback the item survived its own refusal.</summary>
    [Fact]
    public void An_item_whose_content_write_is_refused_is_not_left_in_the_project()
    {
        var ide = Refusing();

        var res = Push(ide, "FB_New.fb", Source, null);
        Assert.False(res.Accepted, "the push must be refused");

        Assert.False(ide.Exists("FB_New"),
            "the create was rolled back — an item refused on its content must not survive as an empty shell");
    }

    /// <summary>THE REFUSAL IS WHAT REACHES THE ENGINEER, unchanged. A rollback that replaced the vendor's
    /// reason with its own would leave them looking for a mistake in what they pushed.</summary>
    [Fact]
    public void The_original_refusal_survives_the_rollback()
    {
        var ide = Refusing();

        // A refusal is a CONFLICT on the response, not an exception — that is the wire contract, so a push of
        // many ops can report which one failed and why rather than losing the batch to a stack trace.
        var res = Push(ide, "FB_New.fb", Source, null);

        Assert.False(res.Accepted);
        var reason = Reasons(res);
        Assert.Contains("the number of networks changes", reason);
    }

    /// <summary>AN UPDATE IS NEVER ROLLED BACK. The item existed before this push; a failed write leaves it
    /// exactly as it was, and deleting it would turn a refused edit into data loss.</summary>
    [Fact]
    public void An_existing_item_survives_a_refused_write()
    {
        var ide = Refusing(new FakeIde.Item("FB_New", ItemKind.PlcPouFb, "", true, Decl, "n := 0;", null, null));

        var refs = RefsService.Handle(ide);
        var res = Push(ide, "FB_New.fb", Source, refs.Items["FB_New.fb"]);

        Assert.False(res.Accepted, "the write was refused");
        Assert.True(ide.Exists("FB_New"), "a refused UPDATE must leave the engineer's item alone");
    }

    /// <summary>And an ordinary create still lands. A rollback that fired on success would delete every new
    /// item, which is the failure this test exists to make impossible to ship.</summary>
    [Fact]
    public void A_create_that_succeeds_is_untouched()
    {
        var ide = new FakeIde();

        var res = Push(ide, "FB_New.fb", Source, null);

        Assert.True(res.Accepted);
        Assert.True(ide.Exists("FB_New"));
    }

    // ── the same rule for a TASK ─────────────────────────────────────────────────────────────────────────

    /// <summary>A task's settings are refused when a vendor cannot express one — TwinCAT has no spelling for a
    /// CODESYS TIME literal, so `Interval: t#4ms` is rejected rather than rounded into a number that means
    /// something else.</summary>
    private static FakeIde RefusingTask() =>
        new()
        {
            RefuseTaskWrite = _ => new BridgeException(
                BridgeErrorCodes.Unsupported,
                "TwinCAT cannot schedule `Interval: t#4ms` — TwinCAT needs a whole number and a unit"),
        };

    /// <summary>CANONICAL, exactly — column alignment, `Watchdog:` and all.
    ///
    /// <para>My first draft was not, and the format gate refused it BEFORE the task path was ever reached. Both
    /// rollback tests below passed anyway, because "the task was rolled back" and "no task was ever created"
    /// assert the same absence. The positive control at the end is what exposed that, and is why it exists.</para></summary>
    private const string TaskSource =
        "Type:      Cyclic\nInterval:  t#4ms\nPriority:  10\nWatchdog:  off\nCalls:     PLC_PRG\n";

    /// <summary>THE REGRESSION, and it is worse than the item one: a task with no schedule is IN THE CALL CHAIN
    /// and runs nothing.
    ///
    /// <para>Measured — migrating `bakon-nano` into a blank TwinCAT project refused `RecipeTask.task` on its
    /// interval and left the task behind. The recovery pull then hit `CONFLICT in 1 file(s)` on that very file:
    /// the workspace had dropped it as refused while the IDE still held the shell.</para></summary>
    [Fact]
    public void A_task_whose_settings_are_refused_is_not_left_in_the_project()
    {
        var ide = RefusingTask();

        var res = Push(ide, "RecipeTask.task", TaskSource, null);

        Assert.False(res.Accepted, "the task push must be refused");
        Assert.False(ide.Exists("RecipeTask"),
            "the task create was rolled back — a task with no schedule must not survive its own refusal");
    }

    /// <summary>An EXISTING task survives a refused settings write, exactly as an existing item does.</summary>
    [Fact]
    public void An_existing_task_survives_a_refused_write()
    {
        var ide = RefusingTask();
        ide.AddTask("RecipeTask");

        var refs = RefsService.Handle(ide);
        var res = Push(ide, "RecipeTask.task", TaskSource, refs.Items["RecipeTask.task"]);

        Assert.False(res.Accepted);
        Assert.True(ide.Exists("RecipeTask"), "a refused UPDATE must leave the engineer's task alone");
    }

    /// <summary>THE POSITIVE CONTROL, and it is not optional.
    ///
    /// <para>A rollback test asserts an item is ABSENT, which is also what a test that never created one
    /// asserts. Without this, "the task was rolled back" and "the push never reached the task path" are the
    /// same green. This one fails if a task create does not land, so the two above cannot pass vacuously.</para></summary>
    [Fact]
    public void A_task_create_that_succeeds_is_untouched()
    {
        var ide = new FakeIde();

        var res = Push(ide, "RecipeTask.task", TaskSource, null);

        // `Conflicts` is NULL on an accepted push, and an assertion message is built EAGERLY in C# — so
        // dereferencing it here throws on the very path this is asserting works.
        Assert.True(res.Accepted,
            "a task push with nothing refusing it must be accepted — " + Reasons(res));
        Assert.True(ide.Exists("RecipeTask"), "a successful task create must be visible to Exists()");
    }
}
