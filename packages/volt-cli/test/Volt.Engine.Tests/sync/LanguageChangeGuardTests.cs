using System;
using System.Collections.Generic;
using System.Linq;
using Xunit;

using Volt.Wire;
using Volt.Contracts;
using Volt.Engine.Format.Body;
using Volt.Engine.Format.St;
using Volt.Engine.Item;
using Volt.Engine.Sync;

namespace Volt.Engine.Tests;

/// <summary>
/// openspec <c>bridge-refusal-review</c> D6 + D7: the push's body guard compares the bodies' languages as FACTS
/// (<see cref="StatedLanguage"/>, set by the driver and by the ST reader) and reads no text to learn them; and ONE
/// comparison decides that a body changes language (ST ⇄ LD/FBD), which the VENDOR answers
/// (<c>ICodeStore.RefusedLanguageChange</c>; DIALECT N24: CODESYS writes a POU's body in place, TwinCAT has no route).
/// </summary>
public class LanguageChangeGuardTests
{
    const string Decl = "PROGRAM P\nVAR\n\ta : BOOL;\n\tq : BOOL;\nEND_VAR";
    const string Fbd = "IMPLEMENTATION FBD\nNETWORK\n  q := a;\nEND_NETWORK";

    static ItemContent Pou(string? body, StatedLanguage? stated) =>
        new(ItemKind.Kinds.Pou, Decl, body, new List<Member>(), Stated: stated);

    /// <summary>A vendor that writes every change, and one that refuses every change — the two answers N24 measured.</summary>
    static string? Writes(string site, string from, string to) => null;
    static string? Refuses(string site, string from, string to) => $"no route ({site}: {from} to {to}).";

    // ── D6: the language is the stated FACT, not the text ─────────────────────────────────────────────────

    /// <summary>A live body whose TEXT reads as ST but whose driver states FBD is judged FBD: an ST push over it is a
    /// language change, asked of the vendor. The guard that sniffed the text called both ST and let the write through.</summary>
    [Fact]
    public void The_live_body_is_judged_by_its_stated_language_not_its_text()
    {
        var e = Assert.Throws<BridgeException>(() => BodyFormatGuard.RequireWritable(
            Pou("q := a;", StatedLanguage.Shown(Languages.Fbd)), Pou("q := NOT a;", StatedLanguage.St), Refuses));

        Assert.Equal(BridgeErrorCodes.Unsupported, e.ErrorCode);
        Assert.Contains("the item is FBD in the IDE and pushed as ST: no route (pou: FBD to ST).", e.Message);
    }

    /// <summary>…and the pushed body is judged by the language its line stated, which the reader carries: network text
    /// under a body stated ST is ST (openspec 1.1 — written as sent), no language change.</summary>
    [Fact]
    public void The_pushed_body_is_judged_by_its_stated_language_not_its_text() =>
        BodyFormatGuard.RequireWritable(Pou("q := a;", StatedLanguage.St),
                                        Pou("NETWORK\n  q := a;\nEND_NETWORK", StatedLanguage.St), Refuses);

    /// <summary>A body WITH text and no stated language is a reader that forgot the fact — refused loud, never guessed
    /// at. (No text at all is an empty body, which states nothing and is ST's.)</summary>
    [Fact]
    public void A_body_with_text_and_no_stated_language_is_refused_loud()
    {
        var e = Assert.Throws<InvalidOperationException>(() =>
            BodyFormatGuard.RequireWritable(Pou("q := a;", null), Pou("q := NOT a;", StatedLanguage.St), Writes));
        Assert.Contains("no stated language", e.Message);
        BodyFormatGuard.RequireWritable(Pou(null, null), Pou("q := NOT a;", StatedLanguage.St), Refuses);
    }

    // ── D7: one comparison, the vendor answers ───────────────────────────────────────────────────────────

    /// <summary>ST ⇄ LD/FBD at a site the vendor writes passes the guard (CODESYS, a POU's own body: N24).</summary>
    [Theory]
    [InlineData("ST", "FBD")]
    [InlineData("FBD", "ST")]
    [InlineData("LD", "ST")]
    [InlineData("ST", "LD")]
    public void A_language_change_the_vendor_writes_passes(string from, string to) =>
        BodyFormatGuard.RequireWritable(Pou("x", StatedLanguage.Shown(from)), Pou("y", StatedLanguage.Shown(to)), Writes);

    /// <summary>LD over FBD and back is a VIEW change both vendors write (N23) — the vendor is not asked.</summary>
    [Fact]
    public void LD_over_FBD_is_a_view_change_never_asked() =>
        BodyFormatGuard.RequireWritable(Pou("x", StatedLanguage.Shown(Languages.Ld)),
                                        Pou("y", StatedLanguage.Shown(Languages.Fbd)),
                                        (_, _, _) => throw new InvalidOperationException("asked about a view change"));

    /// <summary>A member's body asks with the member's kind as its site, an accessor's with <c>property_get</c> /
    /// <c>property_set</c> — so a vendor that measured only a POU's body can answer the others by name.</summary>
    [Fact]
    public void Each_body_asks_with_its_own_site()
    {
        var asked = new List<string>();
        string? Record(string site, string from, string to) { asked.Add($"{site} {from}>{to}"); return null; }

        var live = new ItemContent(ItemKind.Kinds.Pou, Decl, "x", new List<Member>
        {
            new(ItemKind.Kinds.Method, "M", "METHOD M : BOOL", "x", Stated: StatedLanguage.St),
            new(ItemKind.Kinds.Action, "A", "ACTION A", "x", Stated: StatedLanguage.St),
            new(ItemKind.Kinds.Property, "P", "PROPERTY P : INT", "", Getter: new Accessor("", "x", Stated: StatedLanguage.St),
                Setter: new Accessor("", "x", Stated: StatedLanguage.Shown(Languages.Ld))),
        }, Stated: StatedLanguage.St);
        var pushed = live with
        {
            Body = Fbd, Stated = StatedLanguage.Shown(Languages.Fbd),
            Members = new List<Member>
            {
                live.Members[0] with { Body = Fbd, Stated = StatedLanguage.Shown(Languages.Fbd) },
                live.Members[1] with { Body = Fbd, Stated = StatedLanguage.Shown(Languages.Ld) },
                live.Members[2] with
                {
                    Getter = new Accessor("", Fbd, Stated: StatedLanguage.Shown(Languages.Fbd)),
                    Setter = new Accessor("", "y", Stated: StatedLanguage.St),
                },
            },
        };

        BodyFormatGuard.RequireWritable(live, pushed, Record);

        Assert.Equal(new[] { "pou ST>FBD", "method ST>FBD", "action ST>LD", "property_get ST>FBD", "property_set LD>ST" },
                     asked);
    }

    /// <summary>The hidden-body rules stay the vendor-neutral refusals they were: a hidden body is never re-languaged
    /// by push, and nothing is asked of the vendor for one.</summary>
    [Fact]
    public void A_hidden_body_is_never_a_language_change_the_vendor_is_asked_about()
    {
        Func<string, string, string, string?> never = (_, _, _) => throw new InvalidOperationException("asked");
        var cfc = ImplementationMarker.Unsupported(Languages.Cfc);

        Assert.Throws<BridgeException>(() => BodyFormatGuard.RequireWritable(
            Pou(cfc, StatedLanguage.HiddenIn(Languages.Cfc)), Pou("x", StatedLanguage.St), never));
        Assert.Throws<BridgeException>(() => BodyFormatGuard.RequireWritable(
            Pou(cfc, StatedLanguage.HiddenIn(Languages.Cfc)),
            Pou(ImplementationMarker.Unsupported(Languages.Sfc), StatedLanguage.HiddenIn(Languages.Sfc)), never));
        BodyFormatGuard.RequireWritable(Pou(Fbd, StatedLanguage.Shown(Languages.Fbd)),
            Pou(ImplementationMarker.Unsupported(Languages.Fbd), StatedLanguage.HiddenIn(Languages.Fbd)), never);
    }

    // ── through a push ───────────────────────────────────────────────────────────────────────────────────

    static PushResponse PushSt(FakeIde ide, string body)
    {
        var refs = RefsService.Handle(ide);
        return PushService.Handle(ide, new PushRequest
        {
            ExpectedProjectVersion = refs.ProjectVersion,
            Ops = new List<PushOp>
            {
                new SetItemOp { Name = "P.pou", IfVersion = refs.Items["P.pou"],
                                SourceText = $"{Decl}\nIMPLEMENTATION ST\n{body}\nEND_PROGRAM\n" },
            },
        });
    }

    static FakeIde LdPou(Func<string, string, string, string?>? answer) =>
        new(new FakeIde.Item("P", ItemKind.PlcPou, "", true, Decl, "q := a;", Languages.Ld, null))
        { RefusesLanguageChange = answer };

    /// <summary>A vendor that writes the change (CODESYS, a POU's body): the ST push over the LD body is accepted and
    /// the IDE holds ST after it.</summary>
    [Fact]
    public void A_POU_body_changes_language_where_the_vendor_writes_it()
    {
        var ide = LdPou(Writes);

        var resp = PushSt(ide, "q := NOT a;");

        Assert.True(resp.Accepted, resp.Conflicts?.FirstOrDefault()?.Reason);
        Assert.Empty(resp.Conflicts ?? new List<PushConflict>());
        var held = ide.ReadContent(new ItemRef("P"));
        Assert.Equal((StatedLanguage.St, "q := NOT a;"), (held.Stated, held.Body));
    }

    /// <summary>A vendor with no route (TwinCAT): refused UNSUPPORTED by name — the vendor's reason, both languages,
    /// the route that exists — before the item's first write.</summary>
    [Fact]
    public void A_POU_body_language_change_the_vendor_cannot_write_is_refused_by_name()
    {
        var ide = LdPou(answer: null);

        var resp = PushSt(ide, "q := NOT a;");

        var conflict = Assert.Single(resp.Conflicts!);
        Assert.Equal(BridgeErrorCodes.Unsupported, conflict.Code);
        Assert.Contains("the item is LD in the IDE and pushed as ST: FakeIde: no route", conflict.Reason);
        Assert.Contains("delete it and push it again", conflict.Reason);
        Assert.DoesNotContain(ide.Recorded, r => r.StartsWith("write"));
    }

    // ── D11: the guard checks what the kind's row says exists ──────────────────────────────────────────────

    /// <summary>An INTERFACE METHOD has neither a body nor accessors (<c>ItemKind.ShapeOf</c>), so the guard checks
    /// nothing of it. It used to be asked about its accessors (`CarriesAccessors` meant "has no body"): an accessor
    /// slot handed to it reached the vendor's language-change question as a property GET. Asserted by WHICH SITE the
    /// guard asks — the verdict for a real interface method was a pass either way.</summary>
    [Fact]
    public void An_interface_method_is_checked_for_neither_a_body_nor_accessors()
    {
        static Member Itm(string? body, StatedLanguage? stated, Accessor? get) =>
            new(ItemKind.Kinds.InterfaceMethod, "Run", "METHOD Run : BOOL", body, Getter: get, Stated: stated);
        static ItemContent Itf(Member m) =>
            new(ItemKind.Kinds.Interface, "INTERFACE I", "", new List<Member> { m });

        var asked = new List<string>();
        string? Record(string site, string from, string to) { asked.Add(site); return "no route."; }

        BodyFormatGuard.RequireWritable(
            Itf(Itm("x", StatedLanguage.Shown(Languages.Ld), new Accessor("", "x", Stated: StatedLanguage.Shown(Languages.Ld)))),
            Itf(Itm("y", StatedLanguage.St, new Accessor("", "y", Stated: StatedLanguage.St))),
            Record);
        Assert.Empty(asked);

        // …while a property is asked at its accessors, and a method at its body.
        static Member Prop(string get) => new(ItemKind.Kinds.Property, "P", "PROPERTY P : BOOL", "",
            Getter: new Accessor("", get, Stated: get.StartsWith("IMPLEMENTATION") ? StatedLanguage.Shown(Languages.Ld) : StatedLanguage.St));
        static ItemContent Fb(params Member[] ms) => new(ItemKind.Kinds.Pou, Decl, "", ms.ToList(), Stated: StatedLanguage.St);
        Assert.Throws<BridgeException>(() => BodyFormatGuard.RequireWritable(
            Fb(Prop("IMPLEMENTATION LD\nNETWORK\nEND_NETWORK")), Fb(Prop("q := a;")), Record));
        Assert.Equal(new[] { ItemKind.Kinds.PropertyGet }, asked);
    }
}
