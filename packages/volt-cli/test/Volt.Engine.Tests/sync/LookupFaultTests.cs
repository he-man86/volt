using System;
using System.Collections.Generic;
using System.Linq;
using Xunit;
using Xunit.Abstractions;
using Volt.Contracts;
using Volt.Engine.Ide;
using Volt.Engine.Sync;

namespace Volt.Cli.Tests;

/// <summary>
/// "I could not read the tree" and "it is not there" are different answers.
///
/// <para><c>ItemLookup.Find</c> collapsed them: <c>try { count = tree.ChildCount(node); } catch { return null; }</c>,
/// and a second <c>catch { continue; }</c> below it. Null is the ONLY channel it has, and every caller reads null
/// as absence — <c>PushService</c> reads it as "no such item, create one".</para>
///
/// <para>So a COM fault during lookup makes a push CREATE an item that already exists. On a vendor keyed by bare
/// name that is either a duplicate or an overwrite, from a push reporting success.</para>
///
/// <para>Skipping is right for a WALK — a fault on one folder should not fail a pull, and that path now reports
/// its incompleteness through `WalkResult`. A single-item lookup has no such excuse: it was asked one question
/// and cannot answer it.</para>
/// </summary>
public class LookupFaultTests
{
    private readonly ITestOutputHelper _out;
    public LookupFaultTests(ITestOutputHelper o) => _out = o;

    private static FakeIde WithFaultingRoot() => new FakeIde(
        FakeIde.Item.TextualPou("PLC_PRG", "PROGRAM PLC_PRG\nVAR\nEND_VAR", "x := 1;"))
    {
        FaultingNodes = new[] { "<root>" },
    };

    /// <summary>A lookup that hits a read fault must not answer "absent".</summary>
    [Fact]
    public void A_fault_during_lookup_is_not_reported_as_absence()
    {
        var ide = WithFaultingRoot();

        var ex = Record.Exception(() => ItemLookup.Find(ide, "PLC_PRG"));
        _out.WriteLine($"result: {(ex is null ? "returned null (absence)" : ex.GetType().Name + ": " + ex.Message)}");

        Assert.True(ex is not null,
            "the tree read faulted and Find answered null — indistinguishable from 'no such item', which is how a " +
            "push comes to CREATE an item that already exists");
    }

    /// <summary>A genuinely absent item still answers null — so the fix is not "always throw".</summary>
    [Fact]
    public void A_genuinely_absent_item_still_answers_null()
    {
        var ide = new FakeIde(FakeIde.Item.TextualPou("PLC_PRG", "PROGRAM PLC_PRG\nVAR\nEND_VAR", "x := 1;"));
        Assert.Null(ItemLookup.Find(ide, "FB_NoSuchThing"));
    }

    /// <summary>And an item that IS there is still found — the ordinary path is untouched.</summary>
    [Fact]
    public void A_present_item_is_still_found()
    {
        var ide = new FakeIde(FakeIde.Item.TextualPou("PLC_PRG", "PROGRAM PLC_PRG\nVAR\nEND_VAR", "x := 1;"));
        Assert.NotNull(ItemLookup.Find(ide, "PLC_PRG"));
    }
}
