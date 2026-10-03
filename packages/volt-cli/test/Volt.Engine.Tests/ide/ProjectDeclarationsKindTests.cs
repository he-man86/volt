using System;
using System.Collections.Generic;
using Xunit;
using Volt.Engine.Ide;
using Volt.Engine.Item;

namespace Volt.Engine.Tests;

/// <summary>
/// <see cref="ProjectDeclarations.KindOf"/> answers for the items a body can NAME — the top-level source items (POU, DUT,
/// GVL, interface) — never for a descriptor that happens to share a bare name (review of <c>bridge-refusal-review</c> 4a).
///
/// <para>The index kept the first top-level item of a bare name, and the walk includes tasks: a task <c>Motor</c> walked
/// before a function block <c>Motor</c> made <c>KindOf("Motor")</c> answer <c>task</c>, so <c>m : Motor;</c> was no FB
/// instance — a push wrote a FUNCTION box <c>m</c>, a pull hid the body. A descriptor declares nothing a body calls
/// (the push's own index skips tasks for the same reason, <c>PushService.DeclarationsIn</c>). (<see cref="FakeIde"/> is
/// keyed by name and cannot hold two items of one name, so this walks a flat tree of its own.)</para>
/// </summary>
public class ProjectDeclarationsKindTests
{
    /// <summary>A project root whose children are (name, class) rows, in walk order.</summary>
    private sealed class FlatTree : IProjectTree
    {
        private sealed record Row(string Name, int Kind);
        private readonly List<Row> _rows = new();
        private readonly object _root = new();
        public FlatTree(params (string Name, int Kind)[] rows) { foreach (var (n, k) in rows) _rows.Add(new Row(n, k)); }
        public ItemRef GetTreeRoot() => new(_root);
        public int ChildCount(ItemRef item) => ReferenceEquals(item.Native, _root) ? _rows.Count : 0;
        public ItemRef ChildAt(ItemRef parent, int index1Based) => new(_rows[index1Based - 1]);
        public string Name(ItemRef item) => ((Row)item.Native).Name;
        public int KindCode(ItemRef item) => ((Row)item.Native).Kind;
        public WalkResult WalkItems() => throw new NotSupportedException();
        public ItemRef Parent(ItemRef item) => throw new NotSupportedException();
        public bool HandlesSurviveStructureChange => true;
        public ItemRef CreateChild(ItemRef parent, string name, int kindCode, string? seed = null) => throw new NotSupportedException();
        public (bool Get, bool Set) InterfacePropertyAccessors(ItemRef property) => throw new NotSupportedException();
        public void Delete(ItemRef parent, string name) => throw new NotSupportedException();
        public void Rename(ItemRef item, string newName) => throw new NotSupportedException();
        public void Move(ItemRef item, ItemRef target) => throw new NotSupportedException();
    }

    private const string Motor = "FUNCTION_BLOCK Motor\nVAR_INPUT\n\tIN : BOOL;\nEND_VAR";

    [Fact]
    public void A_task_walked_first_does_not_shadow_the_function_block_of_its_name()
    {
        var tree = new FlatTree(("Motor", ItemKind.PlcTask), ("Motor", ItemKind.PlcPou));
        var declarations = new ProjectDeclarations(tree, r => tree.KindCode(r) == ItemKind.PlcPou ? Motor : null,
                                                   Scopes.RefusedPouName);

        Assert.Equal(ItemKind.Kinds.Pou, declarations.KindOf(PushedDeclarations.None, "Motor"));
        Assert.Equal("Motor", declarations.ScopeForPull("VAR\n\tm : Motor;\nEND_VAR").InstanceType("m"));
    }

    [Fact]
    public void A_task_alone_is_no_kind_a_body_names()
    {
        var declarations = new ProjectDeclarations(new FlatTree(("MainTask", ItemKind.PlcTask)), _ => null,
                                                   Scopes.RefusedPouName);

        Assert.Null(declarations.KindOf(PushedDeclarations.None, "MainTask"));
    }
}
