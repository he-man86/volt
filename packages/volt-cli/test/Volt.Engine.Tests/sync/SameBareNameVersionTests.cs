using System.Collections.Generic;
using System.Linq;
using Xunit;
using Xunit.Abstractions;
using Volt.Contracts;
using Volt.Engine.Item;
using Volt.Engine.Sync;

namespace Volt.Engine.Tests;

/// <summary>
/// AN FB THAT SHARES ITS BARE NAME WITH ITS OWN VISUALIZATION MUST STILL BE PUSHABLE.
///
/// <para>Found by sweeping a real customer project (V71_PackML_Hauzer): <c>CM_Carrier.fb</c> and
/// <c>CM_Carrier.visualization</c> sit in the same folder — a control module and the visu that draws it, which is
/// how CODESYS projects are normally organised. Volt pulled the FB and then refused its own text with
/// "item changed since you fetched its version", quoting a <c>currentVersion</c> that was the VISUALIZATION's
/// hash. Two items, one version slot: the FB could be pulled and never pushed, forever.</para>
///
/// <para>The cause is that the two halves of the wire were keyed by DIFFERENT identities. <c>refs</c>/<c>fetch</c>
/// publish <c>Items</c> keyed by the FULL wire name (<c>CM_Carrier.fb</c>), so that is the only identity a client
/// can quote back. The push built its pre-apply version map keyed by the BARE name, where the two items collide
/// and the walk order decides which survives — so the <c>ifVersion</c> gate compared the FB's version against
/// whatever item happened to be walked last.</para>
///
/// <para>This is NOT the "duplicate name" guard `CLAUDE.md` forbids, and the fix does not add one. Bare-name
/// identity below the seam is untouched — the IDE lookup, the apply path and the folder layout all still key by
/// it. What changed is only that the CONCURRENCY gate compares like for like: the client is asked about the
/// identity it was given.</para>
/// </summary>
public class SameBareNameVersionTests
{
    private readonly ITestOutputHelper _out;
    public SameBareNameVersionTests(ITestOutputHelper o) => _out = o;

    /// <summary>The exact Hauzer shape: an FB and a visualization of the same bare name, in one folder.</summary>
    private static FakeIde ControlModuleWithItsVisu() => new FakeIde(
        FakeIde.Item.TextualPou("PLC_PRG", "PROGRAM PLC_PRG\nVAR\nEND_VAR", "x := 1;"),
        new FakeIde.Item("CM_Carrier", ItemKind.PlcPouFb, "02_ControlModules/CM_Carrier", true,
            "FUNCTION_BLOCK CM_Carrier\nVAR\n\tnStep : INT;\nEND_VAR", "nStep := 1;", null, null),
        new FakeIde.Item("CM_Carrier", ItemKind.PlcVisObj, "02_ControlModules/CM_Carrier", true,
            "visualization: CM_Carrier", null, null, null));

    /// <summary>THE BUG. Push the FB back with the version <c>refs</c> just handed out — the no-op every
    /// <c>volt push</c> starts from — and it must be accepted.</summary>
    [Fact]
    public void An_FB_can_be_pushed_back_when_a_visualization_shares_its_bare_name()
    {
        var ide = ControlModuleWithItsVisu();
        var refs = RefsService.Handle(ide);

        _out.WriteLine($"refs items: {string.Join(", ", refs.Items.Select(kv => $"{kv.Key}={kv.Value}"))}");

        // The two items DO hash differently — otherwise the collision would be invisible and this test would
        // pass for the wrong reason.
        Assert.NotEqual(refs.Items["CM_Carrier.fb"], refs.Items["CM_Carrier.visualization"]);

        var res = PushService.Handle(ide, new PushRequest
        {
            ExpectedProjectVersion = refs.ProjectVersion,
            Ops = new List<PushOp>
            {
                new SetItemOp
                {
                    Name = "CM_Carrier.fb",
                    ToFolder = "02_ControlModules/CM_Carrier",
                    SourceText = "FUNCTION_BLOCK CM_Carrier\nVAR\n\tnStep : INT;\nEND_VAR\n\nnStep := 2;\nEND_FUNCTION_BLOCK\n",
                    IfVersion = refs.Items["CM_Carrier.fb"],
                },
            },
        });

        _out.WriteLine($"accepted={res.Accepted} conflicts=" +
            string.Join("; ", (res.Conflicts ?? new List<PushConflict>()).Select(c => $"{c.Name} yours={c.YourVersion} current={c.CurrentVersion} ({c.Reason})")));

        Assert.True(res.Accepted,
            "the push compared the FB's ifVersion against the version map's BARE key, where the visualization " +
            "overwrote it — so a control module with its own visu can be pulled and never pushed");
    }

    /// <summary>The gate must still BITE on the same shape — a fix that keys correctly but stops checking would
    /// pass the test above. A stale version for the FB is still a conflict, and the conflict names the FB.</summary>
    [Fact]
    public void A_stale_version_on_the_colliding_name_is_still_a_conflict()
    {
        var ide = ControlModuleWithItsVisu();
        var refs = RefsService.Handle(ide);

        var res = PushService.Handle(ide, new PushRequest
        {
            ExpectedProjectVersion = refs.ProjectVersion,
            Ops = new List<PushOp>
            {
                new SetItemOp
                {
                    Name = "CM_Carrier.fb",
                    ToFolder = "02_ControlModules/CM_Carrier",
                    SourceText = "FUNCTION_BLOCK CM_Carrier\nVAR\nEND_VAR\n\nnStep := 3;\nEND_FUNCTION_BLOCK\n",
                    IfVersion = "stale0000deadbeef",
                },
            },
        });

        Assert.False(res.Accepted);
        var conflict = Assert.Single(res.Conflicts!);
        Assert.Equal("CM_Carrier.fb", conflict.Name);
        // …and it quotes the FB's OWN current version, not its neighbour's.
        Assert.Equal(refs.Items["CM_Carrier.fb"], conflict.CurrentVersion);
    }

    /// <summary>The other half of the collision: the VISUALIZATION's slot is not the FB's either. A visualization
    /// is read-only source, so this asserts through the delete gate — the one mutating verb it has.</summary>
    [Fact]
    public void The_visualizations_own_version_gates_the_visualization()
    {
        var ide = ControlModuleWithItsVisu();
        var refs = RefsService.Handle(ide);

        var res = PushService.Handle(ide, new PushRequest
        {
            ExpectedProjectVersion = refs.ProjectVersion,
            Ops = new List<PushOp>
            {
                new DeleteItemOp { Name = "CM_Carrier.visualization", IfVersion = refs.Items["CM_Carrier.fb"] },
            },
        });

        Assert.False(res.Accepted);
        var conflict = Assert.Single(res.Conflicts!);
        Assert.Equal("CM_Carrier.visualization", conflict.Name);
        Assert.Equal(refs.Items["CM_Carrier.visualization"], conflict.CurrentVersion);
    }
}
