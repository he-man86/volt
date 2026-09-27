using System.Linq;
using Volt.Engine.Format.Network;
using Xunit;
using static Volt.Engine.Tests.NetworkModels;
using Parallel = Volt.Engine.Format.Network.Parallel;

namespace Volt.Engine.Tests;

/// <summary>
/// <see cref="Node.Children"/> — THE ONE LIST OF A NODE'S SUB-TREES. Every driver walk that refuses a shape (the edge
/// order, the unmeasured imports, the rung count, the wire consumers, CODESYS's ENO refusal) used to spell the child
/// list again by hand; a child one of them missed was a subtree that walk passed unchecked. Each node kind is pinned
/// here, in the order the walks visit: a box's enable before its pins, a Parallel's feed before its branches.
/// </summary>
public class NodeChildrenTests
{
    [Fact]
    public void A_leaf_and_a_terminator_have_none() =>
        Assert.Empty(L("a").Children().Concat(Empty.Children()));

    [Fact]
    public void An_assign_has_its_value()
    {
        var v = L("a");
        Assert.Equal(new Node[] { v }, Set(v, T("x")).Children());
    }

    [Fact]
    public void A_box_has_its_enable_then_its_pins()
    {
        Node en = L("en"), a = L("a"), b = L("b");
        Assert.Equal(new[] { en, a, b }, Call("MOVE", new[] { In(a), In(b) }, en: en).Children());
        Assert.Equal(new[] { a, b }, Op("AND", a, b).Children());
    }

    [Fact]
    public void A_wire_definition_has_its_producer_and_a_reference_has_none()
    {
        var p = L("a");
        Assert.Equal(new Node[] { p }, Def(1, p).Children());
        Assert.Empty(Ref(1).Children());
    }

    [Fact]
    public void A_parallel_has_its_feed_then_its_branches()
    {
        Node feed = L("f"), b1 = L("b1"), b2 = L("b2");
        Assert.Equal(new[] { feed, b1, b2 }, new Parallel(feed, new[] { b1, b2 }, ParallelMode.BoxShortCircuit).Children());
        Assert.Equal(new[] { b1, b2 }, new Parallel(null, new[] { b1, b2 }, ParallelMode.BoxShortCircuit).Children());
    }
}
