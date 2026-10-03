using System.Collections;
using System.Collections.Generic;
using System.Linq;
using Xunit;

namespace Volt.Ide.Codesys.Tests;

/// <summary>
/// A TASK CALL ENTRY'S COMMENT SURVIVES THE REBUILD.
///
/// <para><c>WriteCallList</c> replaces a task's call list wholesale — clear, then <c>CreatePouObject(name)</c>
/// per call — because the scripting list's own <c>remove</c> is a silent no-op on the read-only view. That is
/// the right mechanism and it had a destructive side effect: <c>PouObject</c> persists exactly two fields, and
/// the vendor says so itself (<c>SerializableValueNames == ('Name', 'Comment')</c>, identical on all 21 call
/// entries of five real projects — <c>probe-task-callcomment.py</c> (deleted; <c>git show b2496efb4b:packages/volt-cli/scripts/probe-task-callcomment.py</c>)). Volt's descriptor carries the
/// name, so every push that touched a call list threw the comment away.</para>
///
/// <para><b>Invisibly.</b> The <c>.task</c> file never showed the comment, so neither the workspace nor git
/// could reveal the loss — the same blind spot as the accessor declaration and the edge coil, and the reason
/// all three needed the IDE as the oracle rather than a round trip.</para>
///
/// <para><b>The premise that allowed it was simply wrong.</b> <c>WriteCallList</c>'s doc comment justified the
/// rebuild with "an entry carries a per-entry COMMENT the descriptor does not, so a positional diff would have
/// to preserve something Volt cannot see." <c>PouObject.Comment</c> is an ordinary readable and writable
/// property. It is invisible only from the SCRIPTING wrapper, which iterates plain name strings — and that is
/// exactly where the first version of the probe looked, and why it reported no comment field at all.</para>
///
/// <para>The census found all 21 comments EMPTY, so this is a latent hole rather than active loss, and that is
/// precisely why the fix is to CARRY the field rather than to put it in the <c>.task</c> format: a line in a
/// product surface for something no real project uses would be the worse trade.</para>
/// </summary>
public class TaskCallCommentTests
{
    /// <summary>Drive the real private helper. A reimplementation here would test itself.</summary>
    private static void Rebuild(IList writeable, params string[] calls)
    {
        var m = typeof(CodesysObjectModel).GetMethod(
            "RebuildCallList",
            System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Static);
        Assert.NotNull(m);
        m!.Invoke(null, new object?[] { writeable, new FakeTaskFacet(), (IReadOnlyList<string>)calls });
    }

    /// <summary>The shape <c>InvokeMethod(taskFacet, "CreatePouObject", name)</c> looks for. A minted entry
    /// starts with an EMPTY comment, exactly as the live <c>CreatePouObject</c> does — so a test that passes
    /// here cannot be passing because the double pre-filled the field.</summary>
    private sealed class FakeTaskFacet
    {
        public object CreatePouObject(string name) => new FakePouObject { Name = name, Comment = "" };
    }

    /// <summary><c>_3S.CoDeSys.TaskObject.PouObject</c>'s whole persisted contract, and nothing else.</summary>
    private sealed class FakePouObject
    {
        public string Name { get; set; } = "";
        public string Comment { get; set; } = "";
    }

    private static IList Live(params (string Name, string Comment)[] entries) =>
        new ArrayList(entries.Select(e => (object)new FakePouObject { Name = e.Name, Comment = e.Comment })
                             .ToArray());

    private static (string Name, string Comment)[] Read(IList list) =>
        list.Cast<FakePouObject>().Select(e => (e.Name, e.Comment)).ToArray();

    /// <summary>THE REGRESSION. Before the fix the rebuild emitted three entries with empty comments.</summary>
    [Fact]
    public void A_comment_survives_a_reorder()
    {
        var live = Live(("A", "runs first"), ("B", ""), ("C", "watchdog critical"));

        Rebuild(live, "C", "A", "B");

        Assert.Equal(
            new[] { ("C", "watchdog critical"), ("A", "runs first"), ("B", "") },
            Read(live));
    }

    /// <summary>A call the push ADDS has no comment to inherit, and must not be handed someone else's.</summary>
    [Fact]
    public void A_new_call_gets_no_comment()
    {
        var live = Live(("A", "runs first"));

        Rebuild(live, "A", "NewOne");

        Assert.Equal(new[] { ("A", "runs first"), ("NewOne", "") }, Read(live));
    }

    /// <summary>A call the push REMOVES takes its comment with it — the carry is by name, so a dropped entry
    /// must not leak its text onto whatever ends up in that position.</summary>
    [Fact]
    public void A_removed_calls_comment_does_not_leak_onto_another()
    {
        var live = Live(("Dropped", "about to go"), ("Kept", ""));

        Rebuild(live, "Kept");

        Assert.Equal(new[] { ("Kept", "") }, Read(live));
    }

    /// <summary>A task may call the same POU more than once, so the carry pops one comment per entry rather
    /// than keying a dictionary — which would have collapsed the two onto one.</summary>
    [Fact]
    public void A_repeated_call_takes_the_comments_in_order()
    {
        var live = Live(("P", "first pass"), ("P", "second pass"));

        Rebuild(live, "P", "P");

        Assert.Equal(new[] { ("P", "first pass"), ("P", "second pass") }, Read(live));
    }

    /// <summary>The ordinary case — every real call entry measured — must come out unchanged and must not
    /// acquire anything the vendor did not have.</summary>
    [Fact]
    public void An_all_empty_list_is_untouched()
    {
        var live = Live(("A", ""), ("B", ""));

        Rebuild(live, "A", "B");

        Assert.Equal(new[] { ("A", ""), ("B", "") }, Read(live));
    }
}
