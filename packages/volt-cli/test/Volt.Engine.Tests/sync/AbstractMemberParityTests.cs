using System.Collections.Generic;
using System.Linq;
using Xunit;

using Volt.Wire;
using Volt.Contracts;
using Volt.Engine.Sync;
using Volt.Engine.Format.Body;
using Volt.Engine.Format.St;
using Volt.Engine.Item;

namespace Volt.Engine.Tests;

/// <summary>
/// AN ABSTRACT MEMBER READS THE SAME ON BOTH VENDORS (openspec <c>abstract-member-parity</c>, DIALECT C2n): the text is
/// decided by the DECLARATION, never by the IDE object's class or slot. An <c>ABSTRACT</c> member with no code is
/// <c>IMPLEMENTATION NONE</c> whoever made the object — a CODESYS slotless object (<see cref="AbstractMemberNoSlotTests"/>),
/// a CODESYS slotted <c>POUMethodObject</c> / <c>PropertyAccessorObject</c>, and every TwinCAT abstract member, which all
/// hold an EMPTY slot. This double models the slotted case: an abstract member with an empty (null) body, which the pull
/// used to state <c>IMPLEMENTATION ST</c>.
///
/// <para>One test per row of the design's guard table (step 2), each for a METHOD and for a property accessor. Measured
/// facts the rows cite (<c>vendor-facts</c> <c>abstract-member-code</c>): both compilers refuse statements under ABSTRACT
/// at BUILD (C0433 "must not contain any statements") and accept the write; a comment-only body builds clean on both and
/// fetches back as <c>IMPLEMENTATION ST</c> with the comment; an empty body written at the slot persists.</para>
/// </summary>
public class AbstractMemberParityTests
{
    private const string Bare = "FB_Base";
    private const string Name = Bare + ".pou";
    private const string Decl = "FUNCTION_BLOCK ABSTRACT FB_Base\nVAR\n\tx : INT;\nEND_VAR";

    /// <summary>The TwinCAT / slotted-CODESYS shape: an abstract method and an abstract property whose accessors both
    /// hold an empty slot, a concrete method with code, an abstract method that HOLDS code (the IDE accepts the write and
    /// refuses it at build), and an action. One property per fixture: the double keys its objects by name, and the push
    /// reconciles a property's accessors by the names both vendors give them, <c>Get</c> and <c>Set</c>.</summary>
    private static FakeIde Ide(bool withProperty = true) => new(
        new[]
        {
            new FakeIde.Item(Bare, ItemKind.PlcPou, "", true, Decl, "x := x + 1;", null, null,
                             withProperty ? new[] { "Pick", "Busy", "Run", "Held", "Step" } : new[] { "Pick", "Run", "Held", "Step" }),
            new FakeIde.Item("Pick", ItemKind.PlcMethod, "", false, "METHOD ABSTRACT Pick : INT", null, null, null),
            new FakeIde.Item("Run", ItemKind.PlcMethod, "", false, "METHOD Run : BOOL\nVAR\nEND_VAR", "Run := TRUE;", null, null),
            new FakeIde.Item("Held", ItemKind.PlcMethod, "", false, "METHOD ABSTRACT Held : INT", "Held := 1;", null, null),
            new FakeIde.Item("Step", ItemKind.PlcAction, "", false, null, "x := 0;", null, null),
        }.Concat(withProperty
            ? new[]
            {
                new FakeIde.Item("Busy", ItemKind.PlcProp, "", false, "PROPERTY PUBLIC ABSTRACT Busy : BOOL", null, null, null,
                                 new[] { "Get", "Set" }),
                new FakeIde.Item("Get", ItemKind.PlcPropGet, "", false, "VAR\nEND_VAR", null, null, null),
                new FakeIde.Item("Set", ItemKind.PlcPropSet, "", false, "VAR\nEND_VAR", null, null, null),
            }
            : System.Array.Empty<FakeIde.Item>()).ToArray());

    /// <summary>An abstract property whose GET HOLDS code (the accessor twin of <c>Held</c>), beside the concrete method.</summary>
    private static FakeIde GetCodeIde() => new(
        new FakeIde.Item(Bare, ItemKind.PlcPou, "", true, Decl, "x := x + 1;", null, null, new[] { "Run", "Rdy" }),
        new FakeIde.Item("Run", ItemKind.PlcMethod, "", false, "METHOD Run : BOOL\nVAR\nEND_VAR", "Run := TRUE;", null, null),
        new FakeIde.Item("Rdy", ItemKind.PlcProp, "", false, "PROPERTY PUBLIC ABSTRACT Rdy : BOOL", null, null, null,
                         new[] { "Get" }),
        new FakeIde.Item("Get", ItemKind.PlcPropGet, "", false, "VAR\nEND_VAR", "Rdy := TRUE;", null, null));

    /// <summary>The fixture holding code at <paramref name="site"/>'s abstract member: <c>Held</c>, or <c>Rdy</c>'s GET.</summary>
    private static FakeIde CodeIde(string site) => site == "method" ? Ide() : GetCodeIde();

    /// <summary>The object holding that code.</summary>
    private static string CodeObject(string site) => site == "method" ? "Held" : "Get";

    private static string Pulled(FakeIde ide) =>
        Assert.Single(FetchService.Handle(ide, new FetchRequest { Init = true }).Changed, c => c.Name == Name)
              .SourceText.Replace("\r\n", "\n");

    private static PushResponse Push(FakeIde ide, string sourceText)
    {
        var refs = RefsService.Handle(ide);
        return PushService.Handle(ide, new PushRequest
        {
            ExpectedProjectVersion = refs.ProjectVersion,
            Ops = new List<PushOp> { new SetItemOp { Name = Name, IfVersion = refs.Items[Name], SourceText = sourceText } },
        });
    }

    private static void AssertAccepted(PushResponse resp) =>
        Assert.True(resp.Accepted, string.Join("; ", (resp.Conflicts ?? []).Select(c => c.Reason)));

    private static string Refused(PushResponse resp)
    {
        Assert.False(resp.Accepted);
        return Assert.Single(resp.Conflicts!).Reason;
    }

    private static void AssertNothingMutated(FakeIde ide) =>
        Assert.DoesNotContain(ide.Recorded, r =>
            r.StartsWith("write") || r.StartsWith("create:") || r.StartsWith("delete:") || r.StartsWith("move:")
            || r.StartsWith("rename:"));

    // The two empty abstract sites as the fold pulls them, and the text that stands before their IMPLEMENTATION line.
    private const string PickHead = "METHOD ABSTRACT Pick : INT";
    private const string GetHead = "GET\nVAR\nEND_VAR";
    private const string None = "\nIMPLEMENTATION NONE";

    /// <summary>The site <paramref name="site"/> names: its text before the line, and how a refusal names it.</summary>
    private static (string Head, string Named) Site(string site) =>
        site == "method" ? (PickHead, "'Pick'") : (GetHead, "'Busy' GET");

    /// <summary>The pulled text with the empty abstract <paramref name="site"/> stated <c>IMPLEMENTATION ST</c> over
    /// <paramref name="code"/>.</summary>
    private static string WithSt(string pulled, string site, string code)
    {
        var (head, _) = Site(site);
        Assert.Contains(head + None, pulled);
        var at = pulled.IndexOf(head + None, System.StringComparison.Ordinal);
        return pulled.Substring(0, at) + head + "\nIMPLEMENTATION ST" + (code.Length > 0 ? "\n" + code : "")
               + pulled.Substring(at + (head + None).Length);
    }

    // ── the read: one text, decided by the declaration ──────────────────────────────────────────────

    /// <summary>The spec's first scenario on the slotted shape: the abstract method and both accessors of the abstract
    /// property pull <c>IMPLEMENTATION NONE</c>, as CODESYS's slotless objects do. Nothing else folds: an abstract member
    /// holding CODE keeps it, a concrete method keeps its body, and the abstract FB's own body and the action stay ST.</summary>
    [Fact]
    public void An_empty_abstract_member_with_a_slot_pulls_IMPLEMENTATION_NONE_and_nothing_else_folds()
    {
        var text = Pulled(Ide());

        Assert.Contains("METHOD ABSTRACT Pick : INT\nIMPLEMENTATION NONE\nEND_METHOD", text);
        Assert.Contains("GET\nVAR\nEND_VAR\nIMPLEMENTATION NONE\nEND_GET", text);
        Assert.Contains("SET\nVAR\nEND_VAR\nIMPLEMENTATION NONE\nEND_SET", text);
        Assert.Contains("METHOD ABSTRACT Held : INT\nIMPLEMENTATION ST\nHeld := 1;", text);
        Assert.Contains("GET\nVAR\nEND_VAR\nIMPLEMENTATION ST\nRdy := TRUE;", Pulled(GetCodeIde()));
        Assert.Contains("END_VAR\nIMPLEMENTATION ST\nx := x + 1;", text);
        Assert.Equal(3, text.Split('\n').Count(l => l == "IMPLEMENTATION NONE"));
    }

    /// <summary>The slotted and the slotless shape of the same declarations pull byte-identical text — the wire-parity
    /// rule this change exists for.</summary>
    [Fact]
    public void A_slotted_and_a_slotless_abstract_member_pull_the_same_text()
    {
        static FakeIde Shape(bool slotless) => new(
            new FakeIde.Item(Bare, ItemKind.PlcPou, "", true, Decl, "x := x + 1;", null, null, new[] { "Pick", "Busy" }),
            new FakeIde.Item("Pick", ItemKind.PlcMethod, "", false, "METHOD ABSTRACT Pick : INT", null, null, null) { NoSlot = slotless },
            new FakeIde.Item("Busy", ItemKind.PlcProp, "", false, "PROPERTY PUBLIC ABSTRACT Busy : BOOL", null, null, null,
                             new[] { "Get" }),
            new FakeIde.Item("Get", ItemKind.PlcPropGet, "", false, "VAR\nEND_VAR", slotless ? null : "", null, null)
                { NoSlot = slotless });

        Assert.Equal(Pulled(Shape(slotless: true)), Pulled(Shape(slotless: false)));
    }

    /// <summary>The pushed-side fold: a file pulled before this change states <c>IMPLEMENTATION ST</c> with an empty body
    /// under ABSTRACT. It is the same content as NONE, so over a live NONE — slotless or slotted — it is accepted and no
    /// body is written.</summary>
    [Theory]
    [InlineData("method", false)]
    [InlineData("get", false)]
    [InlineData("method", true)]
    [InlineData("get", true)]
    public void A_pre_upgrade_empty_ST_body_under_ABSTRACT_is_NONE_and_writes_nothing(string site, bool slotless)
    {
        var ide = slotless ? SlotlessIde() : Ide();
        var old = WithSt(Pulled(ide), site, "").Replace("METHOD Run : BOOL", "METHOD Run : BOOL\n// edited");

        AssertAccepted(Push(ide, old));

        var written = ide.WrittenContent[Bare];
        if (site == "method") Assert.DoesNotContain(written.Members, m => m.Name == "Pick" && m.Body is not null);
        else Assert.DoesNotContain(written.Members, m => m.Name == "Busy" && m.Getter?.Body is not null);
        Assert.Contains("METHOD ABSTRACT Pick : INT\nIMPLEMENTATION NONE", Pulled(ide));
    }

    /// <summary>The CLI's post-push check reads both texts through the same fold: a pushed empty <c>IMPLEMENTATION ST</c>
    /// under ABSTRACT that the IDE now holds as NONE is the pushed text laid out otherwise, not "held otherwise".</summary>
    [Theory]
    [InlineData("method")]
    [InlineData("get")]
    public void PushedText_calls_an_empty_ST_body_under_ABSTRACT_the_same_as_the_IDEs_NONE(string site)
    {
        var held = Pulled(Ide());
        var pushed = WithSt(held, site, "");

        Assert.True(PushedText.SameExceptLayout(Name, pushed, held));
        Assert.False(PushedText.SameExceptLayout(Name, WithSt(held, site, "// a comment"), held));
    }

    // ── statements under ABSTRACT ──────────────────────────────────────────────────────────────────

    /// <summary>Both compilers refuse it (1.1, C0433). Refused before any write, naming the member and the IDE's words.</summary>
    [Theory]
    [InlineData("method", "Pick := 1;")]
    [InlineData("get", "Busy := TRUE;")]
    public void Statements_under_ABSTRACT_are_refused_naming_the_member_and_the_IDEs_words(string site, string code)
    {
        var ide = Ide();

        var reason = Refused(Push(ide, WithSt(Pulled(ide), site, code)));

        Assert.Contains(Site(site).Named, reason);
        Assert.Contains("must not contain any statements", reason);
        AssertNothingMutated(ide);
    }

    /// <summary>A concrete member made abstract while it keeps its code is the same refusal.</summary>
    [Fact]
    public void Making_a_member_with_code_abstract_is_refused_naming_it()
    {
        var ide = Ide();
        var reason = Refused(Push(ide, Pulled(ide).Replace("METHOD Run : BOOL", "METHOD ABSTRACT Run : BOOL")));

        Assert.Contains("'Run'", reason);
        Assert.Contains("must not contain any statements", reason);
        AssertNothingMutated(ide);
    }

    /// <summary>The code the IDE already holds under ABSTRACT, pushed back unchanged, is accepted and not written — so a
    /// project that does not compile can still push its other items.</summary>
    [Theory]
    [InlineData("method")]
    [InlineData("get")]
    public void The_IDEs_own_code_under_ABSTRACT_pushed_back_unchanged_is_accepted_and_not_written(string site)
    {
        var ide = CodeIde(site);

        AssertAccepted(Push(ide, Pulled(ide).Replace("METHOD Run : BOOL", "METHOD Run : BOOL\n// edited")));

        var written = ide.WrittenContent[Bare];
        Assert.DoesNotContain(written.Members, m => site == "method" ? m.Name == "Held" : m.Name == "Rdy");
        Assert.Equal(site == "method" ? "Held := 1;" : "Rdy := TRUE;",
                     ide.StoredImplementation(CodeObject(site)));
    }

    /// <summary>…but the same member's code CHANGED is the refusal.</summary>
    [Theory]
    [InlineData("method")]
    [InlineData("get")]
    public void Changed_code_under_ABSTRACT_over_code_is_refused(string site)
    {
        var ide = CodeIde(site);
        var edited = site == "method"
            ? Pulled(ide).Replace("Held := 1;", "Held := 2;")
            : Pulled(ide).Replace("Rdy := TRUE;", "Rdy := FALSE;");

        var reason = Refused(Push(ide, edited));

        Assert.Contains(site == "method" ? "'Held'" : "'Rdy' GET", reason);
        Assert.Contains("must not contain any statements", reason);
        AssertNothingMutated(ide);
    }

    // ── comment-only under ABSTRACT ─────────────────────────────────────────────────────────────────

    /// <summary>A comment is not a statement on either compiler (gate 2, measured): over a live ST body it is accepted
    /// and written as is, and it pulls back as <c>IMPLEMENTATION ST</c> with the comment.</summary>
    [Theory]
    [InlineData("method")]
    [InlineData("get")]
    public void A_comment_only_body_under_ABSTRACT_over_a_live_ST_body_is_accepted_and_written(string site)
    {
        var ide = CodeIde(site);
        var edited = site == "method"
            ? Pulled(ide).Replace("Held := 1;", "// to be overridden")
            : Pulled(ide).Replace("Rdy := TRUE;", "(* to be overridden *)");

        AssertAccepted(Push(ide, edited));

        Assert.Equal(site == "method" ? "// to be overridden" : "(* to be overridden *)",
                     ide.StoredImplementation(CodeObject(site)));
        Assert.Equal(edited, Pulled(ide));
    }

    /// <summary>…and on a create: the created member has a slot on both vendors.</summary>
    [Fact]
    public void A_comment_only_body_under_ABSTRACT_on_a_create_is_accepted_and_written()
    {
        var ide = Ide();
        var added = Pulled(ide).TrimEnd('\n') + "\n\nMETHOD ABSTRACT Later : INT\nIMPLEMENTATION ST\n// to be overridden\nEND_METHOD\n";

        AssertAccepted(Push(ide, added));

        Assert.Equal("// to be overridden", ide.StoredImplementation("Later"));
    }

    /// <summary>Over a live NONE it is refused on both vendors: after the fold the slot is invisible, and a CODESYS
    /// slotless member cannot hold a comment, so one text must have one answer.</summary>
    [Theory]
    [InlineData("method")]
    [InlineData("get")]
    public void A_comment_only_body_under_ABSTRACT_over_a_live_NONE_is_refused(string site)
    {
        var ide = Ide();

        var reason = Refused(Push(ide, WithSt(Pulled(ide), site, "// to be overridden")));

        Assert.Contains(Site(site).Named, reason);
        Assert.Contains("IMPLEMENTATION NONE", reason);
        AssertNothingMutated(ide);
    }

    // ── dropping ABSTRACT over a live NONE ──────────────────────────────────────────────────────────

    /// <summary>Refused on a SLOTTED member too (a behaviour change: accepted before on TwinCAT and on slotted CODESYS
    /// members) — after the fold a slotted and a slotless NONE are one text, so they get one answer.</summary>
    [Theory]
    [InlineData("method", "METHOD ABSTRACT Pick : INT", "METHOD Pick : INT")]
    [InlineData("get", "PROPERTY PUBLIC ABSTRACT Busy : BOOL", "PROPERTY PUBLIC Busy : BOOL")]
    public void Dropping_ABSTRACT_over_a_live_NONE_with_a_slot_is_refused(string site, string from, string to)
    {
        var ide = Ide();
        var concrete = WithSt(Pulled(ide), site, "").Replace(from, to);

        var reason = Refused(Push(ide, concrete));

        Assert.Contains(Site(site).Named, reason);
        Assert.Contains("ABSTRACT", reason);
        Assert.Contains("volt pull", reason);
        AssertNothingMutated(ide);
    }

    /// <summary><c>NONE</c> with ABSTRACT dropped over a live abstract NONE gets the drop-ABSTRACT remedy — make it
    /// concrete in the IDE, or delete and re-add — and NOT "state <c>IMPLEMENTATION ST</c>", which only lands in the
    /// drop-ABSTRACT refusal.</summary>
    [Theory]
    [InlineData("method", "METHOD ABSTRACT Pick : INT", "METHOD Pick : INT")]
    [InlineData("get", "PROPERTY PUBLIC ABSTRACT Busy : BOOL", "PROPERTY PUBLIC Busy : BOOL")]
    public void NONE_with_ABSTRACT_dropped_over_a_live_abstract_NONE_gets_the_drop_ABSTRACT_remedy(string site, string from, string to)
    {
        var ide = Ide();

        var reason = Refused(Push(ide, Pulled(ide).Replace(from, to)));

        Assert.Contains(Site(site).Named, reason);
        Assert.Contains("drops ABSTRACT", reason);
        Assert.Contains("concrete in the IDE", reason);
        Assert.Contains("delete it in one push", reason);
        Assert.DoesNotContain("state 'IMPLEMENTATION ST'", reason);
        AssertNothingMutated(ide);
    }

    // ── NONE + ABSTRACT over a body ─────────────────────────────────────────────────────────────────

    /// <summary>NONE over an abstract member holding code: <c>""</c> is written at the slot, and the next pull reads NONE.</summary>
    [Theory]
    [InlineData("method")]
    [InlineData("get")]
    public void NONE_under_ABSTRACT_over_live_code_writes_an_empty_body(string site)
    {
        var ide = CodeIde(site);
        var edited = site == "method"
            ? Pulled(ide).Replace("METHOD ABSTRACT Held : INT\nIMPLEMENTATION ST\nHeld := 1;", "METHOD ABSTRACT Held : INT\nIMPLEMENTATION NONE")
            : Pulled(ide).Replace("GET\nVAR\nEND_VAR\nIMPLEMENTATION ST\nRdy := TRUE;", "GET\nVAR\nEND_VAR\nIMPLEMENTATION NONE");
        Assert.NotEqual(Pulled(ide), edited);

        AssertAccepted(Push(ide, edited));

        Assert.Equal("", ide.StoredImplementation(CodeObject(site)));
        Assert.Equal(edited, Pulled(ide));
    }

    /// <summary>A concrete member made abstract with NONE, in place, on both vendors: <c>""</c> is written.</summary>
    [Fact]
    public void A_concrete_member_made_abstract_with_NONE_is_accepted_and_its_body_emptied()
    {
        var ide = Ide();
        var edited = Pulled(ide).Replace("METHOD Run : BOOL\nVAR\nEND_VAR\nIMPLEMENTATION ST\nRun := TRUE;",
                                         "METHOD ABSTRACT Run : BOOL\nVAR\nEND_VAR\nIMPLEMENTATION NONE");
        Assert.NotEqual(Pulled(ide), edited);

        AssertAccepted(Push(ide, edited));

        Assert.Equal("", ide.StoredImplementation("Run"));
        Assert.Equal(edited, Pulled(ide));
    }

    /// <summary>NONE without ABSTRACT over a body is the line saying abstract and the declaration saying concrete:
    /// refused with the <c>IMPLEMENTATION ST</c> remedy.</summary>
    [Fact]
    public void NONE_without_ABSTRACT_over_a_body_is_refused_with_the_IMPLEMENTATION_ST_remedy()
    {
        var ide = Ide();
        var edited = Pulled(ide).Replace("METHOD Run : BOOL\nVAR\nEND_VAR\nIMPLEMENTATION ST\nRun := TRUE;",
                                         "METHOD Run : BOOL\nVAR\nEND_VAR\nIMPLEMENTATION NONE");

        var reason = Refused(Push(ide, edited));

        Assert.Contains("'Run'", reason);
        Assert.Contains("IMPLEMENTATION ST", reason);
        AssertNothingMutated(ide);
    }

    // ── NONE + ABSTRACT on a create, a rename, a retype ─────────────────────────────────────────────

    /// <summary>The migration case: an abstract member stated NONE, ADDED — accepted (it was refused), the created member
    /// gets <c>""</c> at its slot, and the next pull reads it back unchanged.</summary>
    [Theory]
    [InlineData("METHOD ABSTRACT Later : INT\nIMPLEMENTATION NONE\nEND_METHOD")]
    [InlineData("PROPERTY PUBLIC ABSTRACT Ready : BOOL\nGET\nIMPLEMENTATION NONE\nEND_GET\nEND_PROPERTY")]
    public void An_abstract_member_added_with_NONE_is_accepted_and_pulls_back_unchanged(string member)
    {
        var ide = Ide(withProperty: false);
        var added = Pulled(ide).TrimEnd('\n') + "\n\n" + member + "\n";

        AssertAccepted(Push(ide, added));

        var back = Pulled(ide);
        Assert.Contains(member + "\n", back);
        Assert.Equal(added.Split('\n').Length, back.Split('\n').Length);
    }

    [Theory]
    [InlineData("METHOD ABSTRACT Pick : INT", "METHOD ABSTRACT Choose : INT")]
    [InlineData("PROPERTY PUBLIC ABSTRACT Busy : BOOL", "PROPERTY PUBLIC ABSTRACT Occupied : BOOL")]
    public void An_abstract_member_renamed_with_NONE_is_accepted_and_pulls_back_unchanged(string from, string to)
    {
        var ide = Ide();
        var renamed = Pulled(ide).Replace(from, to);

        AssertAccepted(Push(ide, renamed));

        var back = Pulled(ide);
        Assert.Contains(to + "\n", back);
        Assert.DoesNotContain(from + "\n", back);
        Assert.Equal(renamed.Split('\n').Where(l => l == "IMPLEMENTATION NONE").Count(),
                     back.Split('\n').Where(l => l == "IMPLEMENTATION NONE").Count());
        Assert.Equal(renamed.Split('\n').Length, back.Split('\n').Length);
    }

    /// <summary>A retype was delete + create to the reconciler, and the action <c>Step</c> pushed as an abstract METHOD was
    /// accepted that way. A member's kind is its class, which never changes in place (DIALECT C2l): openspec
    /// <c>bridge-one-to-one</c> task 3.4 refuses the re-type by name, before anything is written.</summary>
    [Fact]
    public void An_action_retyped_to_an_abstract_method_with_NONE_is_refused_by_name()
    {
        var ide = Ide();
        var pulled = Pulled(ide);
        var at = pulled.IndexOf("ACTION Step", System.StringComparison.Ordinal);
        Assert.True(at >= 0, pulled);
        var end = pulled.IndexOf("END_ACTION", at, System.StringComparison.Ordinal) + "END_ACTION".Length;
        var retyped = pulled.Substring(0, at) + "METHOD ABSTRACT Step : INT\nIMPLEMENTATION NONE\nEND_METHOD" + pulled.Substring(end);

        var reason = Refused(Push(ide, retyped));

        Assert.Contains("'Step'", reason);
        AssertNothingMutated(ide);
    }

    /// <summary>NONE without ABSTRACT on a create stays refused, with the <c>IMPLEMENTATION ST</c> remedy.</summary>
    [Fact]
    public void A_concrete_member_added_with_NONE_is_refused()
    {
        var ide = Ide();
        var added = Pulled(ide).TrimEnd('\n') + "\n\nMETHOD Later : INT\nIMPLEMENTATION NONE\nEND_METHOD\n";

        var reason = Refused(Push(ide, added));

        Assert.Contains("'Later'", reason);
        Assert.Contains("IMPLEMENTATION ST", reason);
        AssertNothingMutated(ide);
    }

    /// <summary>Statements under ABSTRACT on a create are refused as on an update.</summary>
    [Fact]
    public void An_abstract_member_added_with_statements_is_refused()
    {
        var ide = Ide();
        var added = Pulled(ide).TrimEnd('\n') + "\n\nMETHOD ABSTRACT Later : INT\nIMPLEMENTATION ST\nLater := 1;\nEND_METHOD\n";

        var reason = Refused(Push(ide, added));

        Assert.Contains("'Later'", reason);
        Assert.Contains("must not contain any statements", reason);
        AssertNothingMutated(ide);
    }

    // ── NONE at an item's own body or an action: never a member site ────────────────────────────────

    /// <summary><c>FUNCTION_BLOCK ABSTRACT</c> makes no item body a member site: an abstract FB's body is a real body on
    /// both vendors, so NONE there is refused whatever the declaration says, and the body is unchanged.</summary>
    [Fact]
    public void NONE_at_an_abstract_FBs_own_body_is_refused_and_the_body_kept()
    {
        var ide = Ide();
        var edited = Pulled(ide).Replace("END_VAR\nIMPLEMENTATION ST\nx := x + 1;", "END_VAR\nIMPLEMENTATION NONE");
        Assert.NotEqual(Pulled(ide), edited);

        var reason = Refused(Push(ide, edited));

        Assert.Contains("the item", reason);
        Assert.Contains("IMPLEMENTATION NONE", reason);
        Assert.Contains("abstract member", reason);
        AssertNothingMutated(ide);
        Assert.Equal("x := x + 1;", ide.StoredImplementation(Bare));
    }

    [Fact]
    public void NONE_at_an_action_is_refused_and_the_body_kept()
    {
        var ide = Ide();
        var pulled = Pulled(ide);
        var edited = System.Text.RegularExpressions.Regex.Replace(pulled, @"(ACTION Step[^\n]*\n)IMPLEMENTATION ST\nx := 0;", "$1IMPLEMENTATION NONE");
        Assert.NotEqual(pulled, edited);

        var reason = Refused(Push(ide, edited));

        Assert.Contains("'Step'", reason);
        Assert.Contains("abstract member", reason);
        AssertNothingMutated(ide);
        Assert.Equal("x := 0;", ide.StoredImplementation("Step"));
    }

    // ── the migration: the version a pre-upgrade workspace holds ──────────────────────────────────────

    /// <summary>The one user-visible effect of the fold on an existing workspace (design "Migration", gate-3 review): the
    /// item version hashes the FOLDED text, so a workspace pulled before the upgrade — its file stating
    /// <c>IMPLEMENTATION ST</c> under every empty abstract member, its <c>ifVersion</c> the hash of that text — gets
    /// <c>STALE_ITEM_VERSION</c> on its first push, nothing written; after <c>volt pull</c> the file differs in exactly
    /// the abstract members' lines (ST → NONE), and the same edit pushed at the new version lands.</summary>
    [Fact]
    public void A_pre_upgrade_version_is_stale_until_a_pull_which_changes_only_the_abstract_lines()
    {
        var ide = Ide();
        var refs = RefsService.Handle(ide);
        var raw = Assert.Single(FetchService.Handle(ide, new FetchRequest { Init = true }).Changed, c => c.Name == Name).SourceText;
        Assert.Equal(refs.Items[Name], Hasher.ComputeItemVersion("", raw));          // the version IS the hash of the text
        var preUpgrade = raw.Replace("IMPLEMENTATION NONE", "IMPLEMENTATION ST");    // what the old pull wrote
        var preVersion = Hasher.ComputeItemVersion("", preUpgrade);
        Assert.NotEqual(refs.Items[Name], preVersion);
        var edit = preUpgrade.Replace("METHOD ABSTRACT Pick : INT", "METHOD ABSTRACT Pick : INT\n// edited");

        var stale = PushService.Handle(ide, new PushRequest
        {
            ExpectedProjectVersion = refs.ProjectVersion,
            Ops = new List<PushOp> { new SetItemOp { Name = Name, IfVersion = preVersion, SourceText = edit } },
        });

        Assert.False(stale.Accepted);
        Assert.Equal(ConflictCodes.StaleItemVersion, Assert.Single(stale.Conflicts!).Code);
        AssertNothingMutated(ide);

        // `volt pull`: the remote change is exactly the three empty abstract slots' lines.
        var changed = preUpgrade.Replace("\r\n", "\n").Split('\n').Zip(raw.Replace("\r\n", "\n").Split('\n'))
                                .Where(p => p.First != p.Second).ToList();
        Assert.Equal(3, changed.Count);
        Assert.All(changed, p => Assert.Equal(("IMPLEMENTATION ST", "IMPLEMENTATION NONE"), p));

        AssertAccepted(Push(ide, edit));                                              // the same edit, at the new version
        Assert.Contains("// edited", Assert.Single(ide.WrittenContent[Bare].Members, m => m.Name == "Pick").Declaration);
    }

    // ── C2l: a slotless object the IDE holds WITHOUT ABSTRACT (gate-3 review: these two rows had no test) ──────

    /// <summary>A CODESYS slotless object can hold its text with no ABSTRACT (C2l): a method and a property's GET, both
    /// read <c>IMPLEMENTATION NONE</c> by the driver, under concrete declarations. The fold leaves them alone (it reads
    /// the declaration, and these say concrete), so the guard's two not-D-over-a-live-not-L rows are what answers.</summary>
    private static FakeIde ConcreteSlotlessIde() => new(
        new FakeIde.Item(Bare, ItemKind.PlcPou, "", true, Decl, "x := x + 1;", null, null, new[] { "Pick", "Busy" }),
        new FakeIde.Item("Pick", ItemKind.PlcMethod, "", false, "METHOD Pick : INT", null, null, null) { NoSlot = true },
        new FakeIde.Item("Busy", ItemKind.PlcProp, "", false, "PROPERTY PUBLIC Busy : BOOL", null, null, null,
                         new[] { "Get" }),
        new FakeIde.Item("Get", ItemKind.PlcPropGet, "", false, "VAR\nEND_VAR", null, null, null) { NoSlot = true });

    /// <summary>The C2l fixture's site: the text before its IMPLEMENTATION line, the declaration line an edit goes
    /// under, and how a refusal names it.</summary>
    private static (string Head, string Line, string Named) ConcreteSite(string site) =>
        site == "method" ? ("METHOD Pick : INT", "METHOD Pick : INT", "'Pick'")
                         : (GetHead, "PROPERTY PUBLIC Busy : BOOL", "'Busy' GET");

    /// <summary>Row "NONE, not D over a live NONE, not L → accepted, unchanged" (C2l): the IDE already holds the member
    /// so, and an edit to its declaration lands with no body written. Without the C2l return this answered
    /// <c>NoneWithoutAbstract</c> for a text the IDE itself published.</summary>
    [Theory]
    [InlineData("method")]
    [InlineData("get")]
    public void NONE_under_a_concrete_declaration_the_IDE_holds_so_is_accepted_unchanged(string site)
    {
        var ide = ConcreteSlotlessIde();
        var pulled = Pulled(ide);
        var (head, line, _) = ConcreteSite(site);
        Assert.Contains(head + None, pulled);
        var edited = pulled.Replace(line, line + "\n// edited");
        Assert.NotEqual(pulled, edited);

        var resp = Push(ide, edited);

        AssertAccepted(resp);
        var member = Assert.Single(ide.WrittenContent[Bare].Members, m => m.Name == (site == "method" ? "Pick" : "Busy"));
        Assert.Contains("// edited", member.Declaration);
        Assert.Equal(edited, Pulled(ide));
    }

    /// <summary>Row "ST (any), not D over a live NONE, not L → refused": a body over a slotless concrete member has
    /// nowhere to go — refused by name with the <c>volt pull</c> remedy, before any write, for code and for an empty
    /// body alike.</summary>
    [Theory]
    [InlineData("method", "Pick := 1;")]
    [InlineData("method", "")]
    [InlineData("get", "Busy := TRUE;")]
    [InlineData("get", "")]
    public void A_body_over_a_concrete_member_the_IDE_holds_as_NONE_is_refused(string site, string code)
    {
        var ide = ConcreteSlotlessIde();
        var pulled = Pulled(ide);
        var (head, _, named) = ConcreteSite(site);
        var at = pulled.IndexOf(head + None, System.StringComparison.Ordinal);
        Assert.True(at >= 0);
        var withBody = pulled.Substring(0, at) + head + "\nIMPLEMENTATION ST" + (code.Length > 0 ? "\n" + code : "")
                       + pulled.Substring(at + (head + None).Length);

        var reason = Refused(Push(ide, withBody));

        Assert.Contains(named, reason);
        Assert.Contains("no body slot", reason);
        Assert.Contains("volt pull", reason);
        AssertNothingMutated(ide);
    }

    // ── NONE + ABSTRACT over a live LD/FBD body: the language rules (N24), at engine level ──────────────────

    private const string LdBody = "IMPLEMENTATION LD\nNETWORK\n  Pick := 1;\nEND_NETWORK";

    /// <summary>An abstract owner whose member holds a live LD body, and the same owner pushed with NONE at the METHOD or
    /// at the GET.</summary>
    private static (ItemContent Live, ItemContent Pushed) OverLd(string site)
    {
        var ld = StatedLanguage.Shown(Languages.Ld);
        var none = ImplementationMarker.NoneLine;
        Member live = site == "method"
            ? new Member(ItemKind.Kinds.Method, "Pick", "METHOD ABSTRACT Pick : INT", LdBody, ObjectProperties.None, Stated: ld)
            : new Member(ItemKind.Kinds.Property, "Busy", "PROPERTY PUBLIC ABSTRACT Busy : BOOL", null, ObjectProperties.None,
                         Getter: new Accessor("VAR\nEND_VAR", LdBody, Stated: ld));
        Member pushed = site == "method"
            ? new Member(ItemKind.Kinds.Method, "Pick", "METHOD ABSTRACT Pick : INT", none, ObjectProperties.None, Stated: StatedLanguage.None)
            : new Member(ItemKind.Kinds.Property, "Busy", "PROPERTY PUBLIC ABSTRACT Busy : BOOL", null, ObjectProperties.None,
                         Getter: new Accessor("VAR\nEND_VAR", none, Stated: StatedLanguage.None));
        static ItemContent Owner(Member m) =>
            new(ItemKind.Kinds.Pou, Decl, "x := x + 1;", new List<Member> { m }, ObjectProperties.None, Stated: StatedLanguage.St);
        return (Owner(live), Owner(pushed));
    }

    /// <summary>Row "NONE, D over a live LD/FBD → language rules (N24)": NONE is an empty ST body there, so the vendor is
    /// asked about LD → ST at the member's own site. Where it writes the change (CODESYS) the push is accepted; where it
    /// has no route (TwinCAT) it is refused with the vendor's reason. Only the CODESYS driver test covered this.</summary>
    [Theory]
    [InlineData("method", ItemKind.Kinds.Method)]
    [InlineData("get", ItemKind.Kinds.PropertyGet)]
    public void NONE_under_ABSTRACT_over_a_live_LD_body_is_an_ST_language_change_the_vendor_answers(string site, string asked)
    {
        var (live, pushed) = OverLd(site);
        var questions = new List<(string, string, string)>();

        BodyFormatGuard.RequireWritable(live, pushed, (s, f, t) => { questions.Add((s, f, t)); return null; });
        Assert.Equal((asked, Languages.Ld, Languages.St), Assert.Single(questions));

        var e = Assert.Throws<BridgeException>(() => BodyFormatGuard.RequireWritable(live, pushed, (_, _, _) => "no route."));
        Assert.Equal(BridgeErrorCodes.Unsupported, e.ErrorCode);
        Assert.StartsWith((site == "method" ? "'Pick'" : "'Busy' GET") + " is LD in the IDE and pushed as ST", e.Message);
        Assert.Contains("no route.", e.Message);
    }

    /// <summary>pro2193's slotless shape (CODESYS <c>AbstractPOUMethodObject</c>, <c>InterfacePropertyAccessorObject</c>),
    /// with the same concrete method beside it.</summary>
    private static FakeIde SlotlessIde() => new(
        new FakeIde.Item(Bare, ItemKind.PlcPou, "", true, Decl, "x := x + 1;", null, null, new[] { "Pick", "Busy", "Run" }),
        new FakeIde.Item("Pick", ItemKind.PlcMethod, "", false, "METHOD ABSTRACT Pick : INT", null, null, null) { NoSlot = true },
        new FakeIde.Item("Busy", ItemKind.PlcProp, "", false, "PROPERTY PUBLIC ABSTRACT Busy : BOOL", null, null, null,
                         new[] { "Get" }),
        new FakeIde.Item("Get", ItemKind.PlcPropGet, "", false, "VAR\nEND_VAR", null, null, null) { NoSlot = true },
        new FakeIde.Item("Run", ItemKind.PlcMethod, "", false, "METHOD Run : BOOL\nVAR\nEND_VAR", "Run := TRUE;", null, null));
}
