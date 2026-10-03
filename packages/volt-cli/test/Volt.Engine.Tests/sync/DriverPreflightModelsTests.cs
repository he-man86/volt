using System;
using System.Collections.Generic;
using System.Linq;
using Volt.Contracts;
using Volt.Engine.Format.Network;
using Volt.Engine.Ide;
using Volt.Engine.Sync;
using Xunit;

namespace Volt.Engine.Tests;

/// <summary>
/// THE DRIVER'S PRE-FLIGHT IS HANDED THE ENGINE'S MODELS, NEVER THE TEXT (openspec <c>bridge-refusal-review</c> 2.27,
/// D8/D12).
///
/// <para><c>ICodeStore.ValidateSource</c> took the wire name and the source text, and TwinCAT's override read the whole
/// source again with <c>StReader</c>, re-derived the kind from the wire name and validated every network body a second
/// time — against scopes it rebuilt itself. The engine's pre-flight had just done all of that. It now hands the driver
/// what it validated: each network-text body's model, with where it sits.</para>
/// </summary>
public class DriverPreflightModelsTests
{
    private const string Fbd = "IMPLEMENTATION FBD\nNETWORK\n  out := a;\nEND_NETWORK";
    private const string Ld = "IMPLEMENTATION LD\nNETWORK\n  out := a;\nEND_NETWORK";

    /// <summary>An FB whose own body, METHOD body and property GET are network text, and whose ACTION is ST.</summary>
    private static string Fb(string name) =>
        $"FUNCTION_BLOCK {name}\nVAR\n\ta : BOOL;\n\tout : BOOL;\nEND_VAR\n{Fbd}\nEND_FUNCTION_BLOCK\n\n" +
        $"METHOD Run : BOOL\n{Ld}\nEND_METHOD\n\n" +
        "ACTION Reset\nIMPLEMENTATION ST\nout := FALSE;\nEND_ACTION\n\n" +
        $"PROPERTY Ready : BOOL\nGET\n{Fbd}\nEND_GET\nEND_PROPERTY\n";

    /// <summary>An FB whose own body is network text and nothing else.</summary>
    private static string Plain(string name) =>
        $"FUNCTION_BLOCK {name}\nVAR\n\ta : BOOL;\n\tout : BOOL;\nEND_VAR\n{Fbd}\nEND_FUNCTION_BLOCK\n";

    private static PushResponse Push(FakeIde ide, string wireName, string src)
    {
        var refs = RefsService.Handle(ide);
        return PushService.Handle(ide, new PushRequest
        {
            ExpectedProjectVersion = refs.ProjectVersion,
            Ops = new List<PushOp> { new SetItemOp { Name = wireName, SourceText = src, IfVersion = null } },
        });
    }

    [Fact]
    public void A_create_hands_the_driver_every_network_body_as_a_model_with_its_site()
    {
        var ide = new FakeIde();

        var res = Push(ide, "FB_Axis.pou", Fb("FB_Axis"));

        Assert.True(res.Accepted, res.Accepted ? "" : string.Join("; ", res.Conflicts!.Select(c => c.Reason)));
        var bodies = Assert.Single(ide.SourcesValidated);
        Assert.Equal(new[] { "the item", "'Run'", "'Ready' GET" }, bodies.Select(b => b.Site.ToString()));
        Assert.Equal(new[] { BodyLanguage.Fbd, BodyLanguage.Ld, BodyLanguage.Fbd }, bodies.Select(b => b.Model.Language));
        Assert.All(bodies, b => Assert.Single(b.Model.Networks));
        Assert.Null(ide.ExistingValidated.Single());   // a create: no item to write into
    }

    /// <summary>The driver's refusal reads like every other pre-flight refusal: the op is refused UNSUPPORTED and
    /// nothing reaches the IDE.</summary>
    [Fact]
    public void A_driver_refusal_of_a_model_refuses_the_op_before_anything_is_written()
    {
        var ide = new FakeIde
        {
            ValidatesSource = bodies =>
            {
                if (bodies.Any(b => b.Model.Language == BodyLanguage.Ld))
                    throw new NotSupportedException("this vendor cannot create that ladder");
            },
        };

        var res = Push(ide, "FB_Axis.pou", Fb("FB_Axis"));

        Assert.False(res.Accepted);
        var conflict = Assert.Single(res.Conflicts);
        Assert.Equal(BridgeErrorCodes.Unsupported, conflict.Code);
        Assert.Contains("cannot create that ladder", conflict.Reason);
        Assert.Empty(ide.CreatedItems);
        Assert.Empty(ide.WrittenContent);
    }

    /// <summary>AN UPDATE ASKS THE DRIVER TOO (2.28, D21), handing it the item the op writes into: whether a body is
    /// created or edited is the write's per-BODY decision — a new graphical member of an existing item is created whole
    /// — and the pre-flight asked only for a new ITEM, so such a member was refused mid-batch.</summary>
    [Fact]
    public void An_update_hands_the_driver_the_existing_item()
    {
        var ide = new FakeIde();
        Assert.True(Push(ide, "FB_Axis.pou", Plain("FB_Axis")).Accepted);
        ide.SourcesValidated.Clear();
        ide.ExistingValidated.Clear();
        var refs = RefsService.Handle(ide);

        var res = PushService.Handle(ide, new PushRequest
        {
            ExpectedProjectVersion = refs.ProjectVersion,
            Ops = new List<PushOp> { new SetItemOp { Name = "FB_Axis.pou", SourceText = Plain("FB_Axis").Replace("out := a;", "out := NOT a;"), IfVersion = refs.Items["FB_Axis.pou"] } },
        });

        Assert.True(res.Accepted, res.Accepted ? "" : string.Join("; ", res.Conflicts!.Select(c => c.Reason)));
        Assert.Single(ide.SourcesValidated);
        Assert.NotNull(ide.ExistingValidated.Single());
    }

    /// <summary>A source with no network body gives the driver nothing to judge, so it is not asked.</summary>
    [Fact]
    public void A_source_with_no_network_body_does_not_reach_the_driver()
    {
        var ide = new FakeIde();

        var res = Push(ide, "PRG_Main.pou", "PROGRAM PRG_Main\nVAR\nEND_VAR\nIMPLEMENTATION ST\nn := 0;\n\nEND_PROGRAM\n");

        Assert.True(res.Accepted);
        Assert.Empty(ide.SourcesValidated);
    }
}
