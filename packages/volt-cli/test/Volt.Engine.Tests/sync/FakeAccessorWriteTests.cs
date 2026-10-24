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
/// THE FAKE WRITES A PROPERTY'S GET/SET AS THE DRIVERS DO (openspec <c>st-roundtrip-fixed-point</c> gate 1).
///
/// <para>Step 1.1 taught <c>FakeIde.WriteContent</c> to write a pushed accessor at all — it used to drop every one. The
/// first version of that write had three infidelities, each pinned here against the driver it mirrors:</para>
/// <list type="bullet">
/// <item>a null accessor body kept the old body (<c>?? acc.Implementation</c>) — CODESYS wrote <c>Accessor.Code</c>,
/// <c>""</c> for null. Since openspec <c>abstract-member-parity</c> a null accessor body is the push's explicit "leave it
/// alone" (<c>PushService.OnlyChanged</c> drops an unchanged accessor body, as it drops a member's), and BOTH drivers
/// skip it — TwinCAT always did, CODESYS now writes <c>Accessor.Body</c>. The fake mirrors that, and a pushed EMPTY body
/// (<c>""</c>, what <c>StReader</c> gives an empty GET) still empties it;</item>
/// <item>the body was stored as pushed, skipping <c>Held</c> — both drivers build a graphical accessor from the
/// validated model (<c>WriteGraph</c>), so it reads back in the canonical layout, as the member path already does;</item>
/// <item>an INTERFACE accessor took a body — neither vendor has a body slot there (DIALECT D21/D41).</item>
/// </list>
/// </summary>
public class FakeAccessorWriteTests
{
    private const string FbDecl = "FUNCTION_BLOCK FB_P\nVAR\n\ta : BOOL;\n\tout : BOOL;\nEND_VAR";

    private static string Fb(string get) =>
        $"{FbDecl}\nIMPLEMENTATION ST\n\nEND_FUNCTION_BLOCK\n\n" +
        $"PROPERTY P : BOOL\nGET\n{get}\nEND_GET\nEND_PROPERTY\n";

    private static PushResponse Create(FakeIde ide, string wireName, string src) =>
        BoundWrite.Push(ide, new PushRequest
        {
            ExpectedProjectVersion = RefsService.Handle(ide).ProjectVersion,
            Ops = new List<PushOp> { new SetItemOp { Name = wireName, SourceText = src, IfVersion = null } },
        });

    private static string Fetch(FakeIde ide, string wireName) =>
        FetchService.Handle(ide, new FetchRequest
        { KnownApplications = new(),
            KnownItems = new Dictionary<string, string>(),
            OnlyItems = new List<string> { wireName },
        }).Changed.Single().SourceText;

    private static string Why(PushResponse r) =>
        r.Landed() ? "" : string.Join("; ", r.Conflicts!.Select(c => c.Reason));

    /// <summary>A null body is "leave it alone", as both drivers write it (openspec <c>abstract-member-parity</c>); an
    /// EMPTY one empties the GET, never leaving it holding the code it had.</summary>
    [Fact]
    public void A_null_accessor_body_is_left_alone_and_an_empty_one_written_empty()
    {
        var ide = new FakeIde();
        var created = Create(ide, "FB_P.pou", Fb("IMPLEMENTATION ST\nP := TRUE;"));
        Assert.True(created.Landed(), Why(created));
        Assert.Contains("P := TRUE;", Fetch(ide, "FB_P.pou"));

        var item = ItemLookup.Find(ide, "FB_P.pou")!.Value;
        ide.WriteContent(item, new ItemContent(ItemKind.Kinds.Pou, FbDecl, null, new List<Member>
        {
            new(ItemKind.Kinds.Property, "P", "PROPERTY P : BOOL", "", ObjectProperties.None, Getter: new Accessor(null, null)),
        }, ObjectProperties.None), Array.Empty<PushedNetworkBody>());
        Assert.Contains("P := TRUE;", Fetch(ide, "FB_P.pou"));

        ide.WriteContent(item, new ItemContent(ItemKind.Kinds.Pou, FbDecl, null, new List<Member>
        {
            new(ItemKind.Kinds.Property, "P", "PROPERTY P : BOOL", "", ObjectProperties.None, Getter: new Accessor(null, "")),
        }, ObjectProperties.None), Array.Empty<PushedNetworkBody>());
        Assert.DoesNotContain("P := TRUE;", Fetch(ide, "FB_P.pou"));
    }

    /// <summary>A graphical GET is held as its MODEL, like a METHOD's body: it reads back in the canonical layout, and
    /// through <see cref="FakeIde.RematerializeAs"/> when the IDE holds other tokens.</summary>
    [Fact]
    public void A_graphical_accessor_is_held_as_the_IDE_holds_it()
    {
        var ide = new FakeIde { RematerializeAs = held => held + "\n(* vendor *)" };

        var created = Create(ide, "FB_P.pou", Fb("IMPLEMENTATION FBD\nNETWORK\n  out  :=   a;\nEND_NETWORK"));
        Assert.True(created.Landed(), Why(created));

        var fetched = Fetch(ide, "FB_P.pou");
        Assert.Contains("NETWORK\n  out := a;\nEND_NETWORK\n(* vendor *)\nEND_GET", fetched);
        Assert.DoesNotContain("out  :=   a;", fetched);
    }

    private const string Itf =
        "INTERFACE I_P\n\nPROPERTY P : BOOL\nGET\nVAR\n\tx : INT;\nEND_VAR\nEND_GET\nEND_PROPERTY\n\nEND_INTERFACE\n";

    /// <summary>An INTERFACE accessor takes a declaration (CODESYS writes a changed one, D41) and never a body — no vendor
    /// has a body slot there. TwinCAT writes neither; its refusal is the push pre-flight's, modelled below.</summary>
    [Fact]
    public void An_interface_accessor_takes_its_declaration_and_never_a_body()
    {
        var ide = new FakeIde();
        var created = Create(ide, "I_P.itf", Itf);
        Assert.True(created.Landed(), Why(created));
        Assert.Contains("GET\nVAR\n\tx : INT;\nEND_VAR\nEND_GET", Fetch(ide, "I_P.itf"));

        var item = ItemLookup.Find(ide, "I_P.itf")!.Value;
        ide.WriteContent(item, new ItemContent(ItemKind.Kinds.Interface, "INTERFACE I_P", null, new List<Member>
        {
            new(ItemKind.Kinds.InterfaceProperty, "P", "PROPERTY P : BOOL", "", ObjectProperties.None,
                Getter: new Accessor("VAR\n\tx : INT;\nEND_VAR", "IMPLEMENTATION ST\nx := 1;")),
        }, ObjectProperties.None), Array.Empty<PushedNetworkBody>());

        Assert.DoesNotContain("x := 1;", Fetch(ide, "I_P.itf"));
    }

    /// <summary>TwinCAT's side of the asymmetry: its driver refuses any declaration or body pushed at an interface
    /// accessor from the text (<c>BeckhoffDriver.ValidateInterfaceAccessor</c>), before anything is written.</summary>
    [Fact]
    public void A_fake_refusing_as_TwinCAT_lands_no_interface_accessor_declaration()
    {
        var ide = new FakeIde
        {
            ValidatesInterfaceAccessor = a => InterfaceAccessorGuard.RefuseIfChanged(null, null, a.Declaration, a.Body),
        };

        var refused = Create(ide, "I_P.itf", Itf);

        Assert.False(refused.Landed());
        Assert.DoesNotContain("writecontent:I_P", ide.Recorded);
    }
}
