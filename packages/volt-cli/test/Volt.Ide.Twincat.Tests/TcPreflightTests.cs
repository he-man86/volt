using System;
using System.Collections.Generic;
using System.Linq;
using System.Xml.Linq;
using Volt.Engine.Format.Network;
using Volt.Engine.Ide;
using Volt.Engine.Item;
using Xunit;
using Node = Volt.Ide.Twincat.Tests.TcHiddenBodyWriteTests.Node;

namespace Volt.Ide.Twincat.Tests;

/// <summary>
/// THE TWINCAT PRE-FLIGHT JUDGES THE ENGINE'S MODELS (openspec <c>bridge-refusal-review</c> 2.27, D8/D12), ONE BODY AT A
/// TIME (2.28, D21).
///
/// <para><see cref="BeckhoffDriver.ValidateSource"/> is handed each network-text body the engine's pre-flight
/// validated, as its model, and runs the PLCopen lowering a create would — the refusals are a pure function of the
/// model. It used to take the source TEXT and read it all again: <c>StReader</c>, the kind from the wire name, and
/// <c>NetworkText.Validate</c> per body against scopes it rebuilt.</para>
///
/// <para><b>Per body.</b> The write decides create-or-edit per BODY (<c>ResolveBody</c>: a blank implementation, or an
/// archive with nothing drawn in it, goes through the import; anything else is edited in place), and the pre-flight ran
/// only per ITEM — on a new item. So a new graphical METHOD in an existing POU, holding a shape the import refuses, was
/// refused mid-batch, after the batch's earlier ops had landed. Now every body the write would CREATE is lowered here,
/// on an existing item too; a body it would EDIT is not (an Execute box the engineer drew in an untouched network is
/// legitimate there).</para>
/// </summary>
public class TcPreflightTests
{
    /// <summary>A body as the engine's pre-flight hands it over: read against a scope declaring one FB instance.</summary>
    private static PushedNetworkBody Body(string statement, BodySite? site = null) =>
        new(site ?? BodySite.Item,
            NetworkText.Validate($"IMPLEMENTATION LD\nNETWORK\n  {statement}\nEND_NETWORK\n",
                new NetworkScope(Array.Empty<string>(), Array.Empty<string>(),
                                 new Dictionary<string, string> { ["t1"] = "TON" })));

    /// <summary>A shape the import cannot take (a box output pin wired straight to a variable).</summary>
    private const string Unimportable = "t1(IN := a, PT := pt, ET => el);";

    private static BodySite Method(string name) => new(name, ItemKind.Kinds.Method, null);

    /// <summary>A drawn archive: something the in-place writer edits.</summary>
    private static string Drawn() =>
        XDocument.Load(Fixtures.Path("tc-pou", "ladder.TcPOU"), LoadOptions.PreserveWhitespace)
            .Descendants("NWL").Single().ToString(SaveOptions.DisableFormatting);

    /// <summary>An archive with nothing drawn in it: the write takes the CREATE door for it, as for a blank body.</summary>
    private const string Undrawn = "<NWL><o t=\"NWLImplementationObject\"/></NWL>";

    /// <summary>An existing FB holding a drawn method <c>Run</c> and an undrawn method <c>Empty</c>.</summary>
    private static Node Pou() =>
        new("FB_Axis", ItemKind.PlcPou, "FUNCTION_BLOCK FB_Axis\nVAR\nEND_VAR", Drawn(),
            new Node("Run", ItemKind.PlcMethod, "METHOD Run : BOOL", Drawn()),
            new Node("Empty", ItemKind.PlcMethod, "METHOD Empty : BOOL", Undrawn));

    // ── 2.27: models, not text ─────────────────────────────────────────────────────────────────────

    [Fact]
    public void A_model_the_lowering_cannot_express_is_refused_on_a_new_item()
    {
        var ex = Assert.ThrowsAny<NotSupportedException>(() =>
            new BeckhoffDriver(new TcObjectModel()).ValidateSource(null, new[] { Body(Unimportable) }));
        Assert.Contains("output pin", ex.Message);
    }

    [Fact]
    public void A_model_it_can_express_passes()
    {
        new BeckhoffDriver(new TcObjectModel()).ValidateSource(null, new[] { Body("out := (a AND b);") });
    }

    // ── 2.28: per body ─────────────────────────────────────────────────────────────────────────────

    /// <summary>THE TASK'S CASE: a new graphical method in an existing POU, holding a shape the import refuses, is
    /// refused in the pre-flight — naming the member — before any op lands.</summary>
    [Fact]
    public void A_new_member_in_an_existing_item_is_lowered_as_the_create_it_is()
    {
        var ex = Assert.ThrowsAny<NotSupportedException>(() =>
            TcUntouchablePouTests.BoundDriver().ValidateSource(new ItemRef(Pou()), new[] { Body(Unimportable, Method("Fresh")) }));
        Assert.Contains("'Fresh'", ex.Message);
        Assert.Contains("output pin", ex.Message);
    }

    /// <summary>An existing member whose archive has nothing drawn in it is created too (<c>ResolveBody</c>'s rule).</summary>
    [Fact]
    public void An_existing_member_with_nothing_drawn_is_lowered_as_a_create()
    {
        Assert.ThrowsAny<NotSupportedException>(() =>
            TcUntouchablePouTests.BoundDriver().ValidateSource(new ItemRef(Pou()), new[] { Body(Unimportable, Method("Empty")) }));
    }

    /// <summary>A member of the same name but another kind is deleted and created again by the reconciler: a create.</summary>
    [Fact]
    public void A_retyped_member_is_lowered_as_a_create()
    {
        Assert.ThrowsAny<NotSupportedException>(() =>
            TcUntouchablePouTests.BoundDriver().ValidateSource(new ItemRef(Pou()),
                new[] { Body(Unimportable, new BodySite("Run", ItemKind.Kinds.Action, null)) }));
    }

    /// <summary>A body the write EDITS in place is not lowered: the in-place writer takes shapes the import does not, and
    /// refusing them here would refuse a legitimate edit beside one.</summary>
    [Fact]
    public void A_drawn_body_the_write_edits_is_not_lowered()
    {
        TcUntouchablePouTests.BoundDriver().ValidateSource(new ItemRef(Pou()),
            new[] { Body(Unimportable), Body(Unimportable, Method("Run")) });
    }
}
