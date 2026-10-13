using System.Collections;
using System.Collections.Generic;
using System.Linq;
using Xunit;

namespace Volt.Ide.Codesys.Tests;

/// <summary>
/// A TASK CALL ENTRY'S COMMENT IS THE ONE THE DESCRIPTOR STATES (openspec <c>bridge-one-to-one</c> §1.2: <c>Calls: A //
/// comment</c>).
///
/// <para><c>WriteCallList</c> replaces a task's call list wholesale — clear, then <c>CreatePouObject(name)</c> per call —
/// because the scripting list's own <c>remove</c> is a silent no-op on the read-only view. <c>PouObject</c> persists
/// exactly two fields (<c>SerializableValueNames == ('Name', 'Comment')</c>, measured on 21 call entries of five real
/// projects).</para>
///
/// <para><b>History.</b> The comment used to be CARRIED by name from the old list, on the reasoning that a <c>.task</c>
/// line for it would be product surface for something no real project uses (all 21 census comments are empty). The owner
/// decided the other way (2026-10-12, the one-to-one rule: a vendor member is spelled unless measured a cache), so the
/// descriptor spells it and the rebuild writes what the descriptor states — a carry by name would be a fold the file
/// cannot show, and a comment removed in the file would come back. These tests replaced the carry tests.</para>
/// </summary>
public class TaskCallCommentTests
{
    /// <summary>Drive the real private helper. A reimplementation here would test itself.</summary>
    private static void Rebuild(IList writeable, (string Name, string Comment)[] calls)
    {
        var m = typeof(CodesysObjectModel).GetMethod(
            "RebuildCallList",
            System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Static);
        Assert.NotNull(m);
        m!.Invoke(null, new object?[]
        {
            writeable, new FakeTaskFacet(),
            (IReadOnlyList<string>)calls.Select(c => c.Name).ToList(),
            (IReadOnlyList<string>)calls.Select(c => c.Comment).ToList(),
        });
    }

    /// <summary>The shape <c>InvokeMethod(taskFacet, "CreatePouObject", name)</c> looks for. A minted entry starts with
    /// an EMPTY comment, exactly as the live <c>CreatePouObject</c> does.</summary>
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
        new ArrayList(entries.Select(e => (object)new FakePouObject { Name = e.Name, Comment = e.Comment }).ToArray());

    private static (string Name, string Comment)[] Read(IList list) =>
        list.Cast<FakePouObject>().Select(e => (e.Name, e.Comment)).ToArray();

    /// <summary>The comments the descriptor states land on their calls, in the order it states them.</summary>
    [Fact]
    public void The_stated_comments_land_on_their_calls_in_order()
    {
        var live = Live(("A", "runs first"), ("B", ""), ("C", "watchdog critical"));

        Rebuild(live, new[] { ("C", "watchdog critical"), ("A", "runs first"), ("B", "") });

        Assert.Equal(new[] { ("C", "watchdog critical"), ("A", "runs first"), ("B", "") }, Read(live));
    }

    /// <summary>A comment the descriptor no longer states is GONE — absence is the empty comment, never "keep the
    /// IDE's" (that was the carry, a fold the file could not show).</summary>
    [Fact]
    public void A_comment_the_descriptor_drops_is_cleared()
    {
        var live = Live(("A", "runs first"));

        Rebuild(live, new[] { ("A", "") });

        Assert.Equal(new[] { ("A", "") }, Read(live));
    }

    /// <summary>A task may call the same POU more than once, each call with its own comment.</summary>
    [Fact]
    public void A_repeated_call_takes_its_own_comment()
    {
        var live = Live(("P", ""));

        Rebuild(live, new[] { ("P", "first pass"), ("P", "second pass") });

        Assert.Equal(new[] { ("P", "first pass"), ("P", "second pass") }, Read(live));
    }

    /// <summary>The ordinary case — every real call entry measured — comes out unchanged.</summary>
    [Fact]
    public void An_all_empty_list_stays_empty()
    {
        var live = Live(("A", ""), ("B", ""));

        Rebuild(live, new[] { ("A", ""), ("B", "") });

        Assert.Equal(new[] { ("A", ""), ("B", "") }, Read(live));
    }

    /// <summary>The task object's archive, holding its <c>PouList</c>.</summary>
    public sealed class ArchivedTask
    {
        private readonly IList _calls;
        public ArchivedTask(IList calls) => _calls = calls;
        public string[] SerializableValueNames => new[] { "PouList" };
        public object GetSerializableValue(string name) => _calls;
    }

    /// <summary>The READ of a call list, as the private helper does it.</summary>
    private static (List<string> Names, List<string> Comments) ReadCalls(IList calls)
    {
        var m = typeof(CodesysObjectModel).GetMethod(
            "ReadCalls", System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Static);
        Assert.NotNull(m);
        try { return ((List<string>, List<string>))m!.Invoke(null, new object[] { new ArchivedTask(calls), "CODESYS task" })!; }
        catch (System.Reflection.TargetInvocationException tie) { throw tie.InnerException!; }
    }

    /// <summary>A call's comment is read as stored: one with surrounding spaces is REFUSED by name, never trimmed (gate review
    /// of step 3, finding 8) — trimmed, it was pushed back without them, an unrefused change of stored characters.</summary>
    [Fact]
    public void A_call_comment_with_surrounding_spaces_is_refused_by_name_not_trimmed()
    {
        var ex = Assert.Throws<Volt.Engine.BridgeException>(() => ReadCalls(Live(("A", " runs first "))));
        Assert.Contains("'A'", ex.Message);

        var (names, comments) = ReadCalls(Live(("A", "runs first")));
        Assert.Equal(new[] { "A" }, names);
        Assert.Equal(new[] { "runs first" }, comments);
    }
}
