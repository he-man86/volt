using System.Collections.Generic;
using System.Linq;
using Volt.Contracts;
using Volt.Engine.Item;
using Volt.Engine.Sync;
using Xunit;

namespace Volt.Engine.Tests;

/// <summary>
/// A FOLDER'S CONTENTS ARE CREATED BEFORE AN ITEM THAT SHARES THE FOLDER'S NAME.
///
/// <para><b>TwinCAT will not create a folder whose name an object at that level already has</b> — DIALECT D34,
/// measured across all four kind × order cells on a live XAE (`scripts/probe-tc-name-collision.ts`). The two
/// may COEXIST perfectly well; what is refused is making the FOLDER second:</para>
/// <code>
///   folder first, then a sibling object of that name   POU: OK        DUT: OK
///   object first, then a folder of that name           POU: REFUSED   DUT: REFUSED
/// </code>
/// <para>The vendor's words are <c>A file or folder with the name 'X' already exists on disk at this
/// location</c>, comparing WITHOUT the extension. So it is an ORDER constraint — and order is something a push
/// can choose, which turns a reported vendor limit back into a Volt one.</para>
///
/// <para><b>What it cost.</b> `lenze-mid` holds a folder `UDT_CamControlLS/` beside a DUT of that name — the
/// only such pair in six real customer projects — and four of its DUTs could not be migrated into TwinCAT at
/// all. It looked like a wall until the order was measured rather than inferred.</para>
///
/// <para>These are ORDER tests, so they use the fake's recorded call sequence rather than a live IDE: the rule
/// is about which create runs first, and that is exactly what `Recorded` preserves.</para>
/// </summary>
public class CreateOrderTests
{
    private static string Prg(string name) => $"PROGRAM {name}\nVAR\nEND_VAR\n(* @volt-implementation *)\nn := 0;\n\nEND_PROGRAM\n";

    private static SetItemOp Set(string wireName, string folder) =>
        new() { Name = wireName, ToFolder = folder, SourceText = Prg(Materializer.Bare(wireName)), IfVersion = null };

    /// <summary>The order the fake was asked to create ITEMS in — folders excluded, in order.
    ///
    /// <para>Derived from a LIST on the fake rather than filtering `Recorded` by `CreatedKinds`: a folder and
    /// an item may share a NAME (that is the whole subject here), so a name-keyed map holds only the last of
    /// the two and reports a passing sort as a failure.</para></summary>
    private static List<string> CreateOrder(FakeIde ide) => ide.CreatedItems;

    private static void Push(FakeIde ide, params SetItemOp[] ops)
    {
        var refs = RefsService.Handle(ide);
        var res = PushService.Handle(ide, new PushRequest
        {
            ExpectedProjectVersion = refs.ProjectVersion,
            Ops = ops.Cast<PushOp>().ToList(),
        });
        Assert.True(res.Accepted, "push refused: " + (res.Conflicts is null
            ? "(none)"
            : string.Join(" | ", res.Conflicts.Select(c => c.Reason))));
    }

    /// <summary>THE REGRESSION. Sent object-first — the order a corpus walk produces — the child inside the
    /// same-named folder must still be created FIRST.</summary>
    [Fact]
    public void A_child_of_a_same_named_folder_is_created_before_the_item_beside_it()
    {
        var ide = new FakeIde();

        Push(ide,
             Set("UDT_CamControlLS.prg", ""),                       // the object, at the top level
             Set("sUDT_Calculation.prg", "UDT_CamControlLS"));      // inside a folder of that name

        var order = CreateOrder(ide);
        Assert.True(order.IndexOf("sUDT_Calculation") < order.IndexOf("UDT_CamControlLS"),
            $"the folder's child must be created first: got {string.Join(", ", order)}");
    }

    /// <summary>DEPTH, NOT ADJACENCY — the child may be several folders down and the rule still holds, because
    /// anything inside `F/X` is deeper than the item named `X` at `F`.</summary>
    [Fact]
    public void A_deeply_nested_child_still_precedes_the_item_that_names_its_folder()
    {
        var ide = new FakeIde();

        Push(ide,
             Set("Data.prg", "BFU"),
             Set("Deep.prg", "BFU/Data/Inner"));

        var order = CreateOrder(ide);
        Assert.True(order.IndexOf("Deep") < order.IndexOf("Data"),
            $"deepest first: got {string.Join(", ", order)}");
    }

    /// <summary>AND IT IS STABLE. Items at the SAME depth keep the order they were sent in — the sort adds one
    /// rule and changes nothing else, which is what makes it safe to apply to every push.</summary>
    [Fact]
    public void Items_at_the_same_depth_keep_the_order_they_arrived_in()
    {
        var ide = new FakeIde();

        Push(ide, Set("Alpha.prg", "F"), Set("Beta.prg", "F"), Set("Gamma.prg", "F"));

        Assert.Equal(new[] { "Alpha", "Beta", "Gamma" }, CreateOrder(ide));
    }

    /// <summary>A push with no folders at all is untouched — the top level is depth 0 for every item, so the
    /// sort is a no-op there, which is the overwhelmingly common shape.</summary>
    [Fact]
    public void A_flat_push_is_not_reordered()
    {
        var ide = new FakeIde();

        Push(ide, Set("One.prg", ""), Set("Two.prg", ""), Set("Three.prg", ""));

        Assert.Equal(new[] { "One", "Two", "Three" }, CreateOrder(ide));
    }
}
