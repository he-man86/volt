using System;
using System.Collections.Generic;
using System.Linq;
using Volt.Contracts;
using Volt.Engine.Ide;
using Volt.Engine.Item;
using Volt.Engine.Sync;
using Xunit;

namespace Volt.Engine.Tests;

/// <summary>
/// EACH NETWORK BODY IS VALIDATED ONCE, AND THE WRITE TAKES THE MODEL (openspec <c>bridge-refusal-review</c> D8/D12).
///
/// <para>Counted from the code before this step: an update validated a body twice (pre-flight, the driver's write), a
/// create's own body three times (pre-flight, the create arm, the write), a move+edit three times (pre-flight and each of
/// the two writes). The readings could not disagree — but four places paired a body with its scope, a refusal from the
/// driver's copy was unreachable behind the pre-flight, and the network-text switch relied on every copy staying put.
/// Now the pre-flight is the one door: each body's scope is built once (<see cref="FakeIde.NetworkScopeFor"/>, counted
/// here), and the write is handed the model with that scope.</para>
/// </summary>
public class PushValidatesOnceTests
{
    private const string Decl = "FUNCTION_BLOCK FB_N\nVAR\n\ta : BOOL;\n\tq : BOOL;\nEND_VAR";
    private const string Fbd = "IMPLEMENTATION FBD\nNETWORK\n  q := a;\nEND_NETWORK";
    private const string FbdEdited = "IMPLEMENTATION FBD\nNETWORK\n  q := NOT a;\nEND_NETWORK";

    private static string Source(string body, string method = "") =>
        Decl + "\n" + body + "\n\nEND_FUNCTION_BLOCK\n" + method;

    private static PushResponse Push(FakeIde ide, Func<RefsResponse, SetItemOp> op)
    {
        var refs = RefsService.Handle(ide);
        return PushService.Handle(ide, new PushRequest { ExpectedProjectVersion = refs.ProjectVersion, Ops = new() { op(refs) } });
    }

    private static string Reasons(PushResponse r) =>
        r.Conflicts is null ? "(none)" : string.Join(" | ", r.Conflicts.Select(c => c.Reason));

    [Fact]
    public void A_create_validates_each_network_body_once()
    {
        var ide = new FakeIde();
        var method = "\nMETHOD M : BOOL\n" + FbdEdited.Replace("q := NOT a;", "M := TRUE;") + "\nEND_METHOD\n";
        var resp = Push(ide, _ => new SetItemOp { Name = "FB_N.pou", ToFolder = "", SourceText = Source(Fbd, method) });

        Assert.True(resp.Accepted, Reasons(resp));
        Assert.Equal(2, ide.ScopesPushed.Count);   // the POU's body and the method's, once each
        Assert.Equal(2, ide.WrittenBodies["FB_N"].Count);
    }

    [Fact]
    public void An_update_validates_its_body_once()
    {
        var ide = new FakeIde(FakeIde.Item.TextualPou("FB_N", Decl, Fbd));
        var resp = Push(ide, refs => new SetItemOp { Name = "FB_N.pou", IfVersion = refs.Items["FB_N.pou"], SourceText = Source(FbdEdited) });

        Assert.True(resp.Accepted, Reasons(resp));
        Assert.Single(ide.ScopesPushed);
        Assert.Contains("q := NOT a;", ide.StoredImplementation("FB_N"));
    }

    /// <summary>A move+edit writes twice (before the move, and again after it, because a move can replace the item) —
    /// from the ONE reading the pre-flight made.</summary>
    [Fact]
    public void A_move_and_edit_validates_its_body_once_and_writes_it_twice()
    {
        var ide = new FakeIde(FakeIde.Item.TextualPou("FB_N", Decl, Fbd, folder: "From"));
        var resp = Push(ide, refs => new SetItemOp
        {
            Name = "FB_N.pou", ToFolder = "To", IfVersion = refs.Items["FB_N.pou"], SourceText = Source(FbdEdited),
        });

        Assert.True(resp.Accepted, Reasons(resp));
        Assert.Single(ide.ScopesPushed);
        Assert.Equal(2, ide.Recorded.Count(r => r == "writecontent:FB_N"));
        Assert.Contains("q := NOT a;", ide.StoredImplementation("FB_N"));
    }

    /// <summary>A write handed a network body with no model is Volt's bug, refused loud naming the site — the fake as
    /// both drivers: none of them reads the text again.</summary>
    [Fact]
    public void A_write_handed_a_network_body_without_its_model_is_refused_naming_the_site()
    {
        var ide = new FakeIde(FakeIde.Item.TextualPou("FB_N", Decl, Fbd));
        var item = ItemLookup.Find(ide, "FB_N");
        var ex = Assert.Throws<InvalidOperationException>(() => ide.WriteContent(item!.Value,
            new ItemContent(ItemKind.Kinds.Pou, Decl, FbdEdited, new List<Member>(), Stated: StatedLanguage.Shown("FBD")),
            Array.Empty<PushedNetworkBody>()));
        Assert.Contains("the item", ex.Message);
        Assert.Contains("no validated model", ex.Message);
    }

    /// <summary>The helper every direct caller of a write uses is the pre-flight's own door: one scope per network body,
    /// at the site <see cref="SourceScopes.SitesOf"/> names, and nothing for an ST body.</summary>
    [Fact]
    public void Validated_hands_each_network_body_its_site_model_and_scope()
    {
        var content = new ItemContent(ItemKind.Kinds.Pou, Decl, "q := a;", new List<Member>
        {
            new(ItemKind.Kinds.Method, "M", "METHOD M : BOOL", "IMPLEMENTATION LD\nNETWORK\n  M := TRUE;\nEND_NETWORK"),
            new(ItemKind.Kinds.Property, "P", "PROPERTY P : BOOL", "",
                Getter: new Accessor("", "IMPLEMENTATION FBD\nNETWORK\n  P := TRUE;\nEND_NETWORK")),
        });
        var asked = new List<string?>();
        var bodies = SourceScopes.Validated(content, d => { asked.Add(d); return Volt.Engine.Format.Network.NetworkScope.Empty; });

        Assert.Equal(new[] { new BodySite("M", ItemKind.Kinds.Method, null), new BodySite("P", ItemKind.Kinds.Property, BodySite.Get) },
                     bodies.Select(b => b.Site));
        Assert.Equal(2, asked.Count);
        Assert.StartsWith("METHOD M : BOOL", asked[0]);   // the member's own declarations first, then the owner's
        Assert.Same(Volt.Engine.Format.Network.NetworkScope.Empty, bodies[0].Scope);
    }
}
