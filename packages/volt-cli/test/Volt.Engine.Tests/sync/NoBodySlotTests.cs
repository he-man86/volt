using System.Collections.Generic;
using System.Linq;
using Xunit;

using Volt.Wire;
using Volt.Contracts;
using Volt.Engine.Sync;
using Volt.Engine.Format.St;
using Volt.Engine.Item;
using Volt.Tests.Shared;

namespace Volt.Engine.Tests;

/// <summary>
/// A MEMBER WITH NO BODY SLOT HAS NO <c>%LANGUAGE</c> LINE (openspec <c>language-line</c>, DIALECT C2n). CODESYS holds an
/// abstract method the IDE made as an <c>AbstractPOUMethodObject</c> and an abstract property's GET as an
/// <c>InterfacePropertyAccessorObject</c>, neither with an <c>Implementation</c> aspect: the pull writes them with no line
/// and nothing after the declaration. Every other member has a slot — a script-made CODESYS abstract member and every
/// TwinCAT one — and pulls <c>%LANGUAGE ST</c> with its (empty) body. The double models the slot as the CODESYS driver
/// reads it (<see cref="FakeIde.Item.NoSlot"/>) and refuses a body written there as the driver's <c>RequireSlot</c> does.
///
/// <para>The push guard against the live object (design.md, point 3): no line over a live member WITH a slot is the lost
/// line, refused naming <c>volt pull</c>; a stated language over a live slotless member is refused; no line on a member
/// the push CREATES is accepted only for an ABSTRACT METHOD, created as the vendor's abstract class (C2r); dropping
/// ABSTRACT over a live slotless member is refused (C2l). Statements under ABSTRACT are refused as both compilers refuse
/// them (C0433), wherever there is a slot.</para>
/// </summary>
public class NoBodySlotTests
{
    private const string Bare = "FB_Base";
    private const string Name = Bare + ".pou";
    private const string Decl = "FUNCTION_BLOCK ABSTRACT FB_Base\nVAR\n\tx : INT;\nEND_VAR";

    /// <summary>pro2193's shape: an abstract method and an abstract property's GET with no slot; beside them a slotted
    /// abstract method holding nothing (a script-made or TwinCAT one), one holding code, a concrete method and an action.</summary>
    private static FakeIde Ide() => new(
        new FakeIde.Item(Bare, ItemKind.PlcPou, "", true, Decl, "x := x + 1;", null, null,
                         new[] { "Take", "Busy", "Pick", "Held", "Run", "Step" }),
        new FakeIde.Item("Take", ItemKind.PlcMethod, "", false, "METHOD ABSTRACT Take : INT", null, null, null) { NoSlot = true },
        new FakeIde.Item("Busy", ItemKind.PlcProp, "", false, "PROPERTY PUBLIC ABSTRACT Busy : BOOL", null, null, null,
                         new[] { "Get" }),
        new FakeIde.Item("Get", ItemKind.PlcPropGet, "", false, "VAR\nEND_VAR", null, null, null) { NoSlot = true },
        new FakeIde.Item("Pick", ItemKind.PlcMethod, "", false, "METHOD ABSTRACT Pick : INT", null, null, null),
        new FakeIde.Item("Held", ItemKind.PlcMethod, "", false, "METHOD ABSTRACT Held : INT", "Held := 1;", null, null),
        new FakeIde.Item("Run", ItemKind.PlcMethod, "", false, "METHOD Run : BOOL\nVAR\nEND_VAR", "Run := TRUE;", null, null),
        new FakeIde.Item("Step", ItemKind.PlcAction, "", false, null, "x := 0;", null, null));

    /// <summary>An abstract property whose GET HAS a slot (TwinCAT's, a script-made CODESYS one), empty.</summary>
    private static FakeIde SlottedGetIde() => new(
        new FakeIde.Item(Bare, ItemKind.PlcPou, "", true, Decl, "x := x + 1;", null, null, new[] { "Rdy" }),
        new FakeIde.Item("Rdy", ItemKind.PlcProp, "", false, "PROPERTY PUBLIC ABSTRACT Rdy : BOOL", null, null, null,
                         new[] { "Get" }),
        new FakeIde.Item("Get", ItemKind.PlcPropGet, "", false, "VAR\nEND_VAR", null, null, null));

    private static string Pulled(FakeIde ide) =>
        Assert.Single(FetchService.Handle(ide, new FetchRequest { Init = true }).Changed, c => c.Name == Name)
              .SourceText.Replace("\r\n", "\n");

    private static PushResponse Push(FakeIde ide, string sourceText)
    {
        var refs = RefsService.Handle(ide);
        return BoundWrite.Push(ide, new PushRequest
        {
            ExpectedProjectVersion = refs.ProjectVersion,
            Ops = new List<PushOp> { new SetItemOp { Name = Name, IfVersion = refs.Items[Name], SourceText = sourceText } },
        });
    }

    private static void AssertAccepted(PushResponse resp) =>
        Assert.True(resp.Landed(), string.Join("; ", (resp.Conflicts ?? []).Select(c => c.Reason)));

    private static string Refused(PushResponse resp)
    {
        Assert.False(resp.Landed());
        return Assert.Single(resp.Conflicts!).Reason;
    }

    private static void AssertNothingMutated(FakeIde ide) =>
        Assert.DoesNotContain(ide.Recorded, r =>
            r.StartsWith("write") || r.StartsWith("create:") || r.StartsWith("delete:") || r.StartsWith("move:")
            || r.StartsWith("rename:"));

    private static string Edit(string text, string from, string to)
    {
        Assert.Contains(from, text);
        return text.Replace(from, to);
    }

    // ── the pull: the slot is in the text ─────────────────────────────────────────────────────────

    [Fact]
    public void A_member_with_no_slot_pulls_with_no_line_and_a_slotted_one_with_its_line()
    {
        var text = Pulled(Ide());

        Assert.Contains("\nMETHOD ABSTRACT Take : INT\nEND_METHOD\n", text);
        Assert.Contains("\nPROPERTY PUBLIC ABSTRACT Busy : BOOL\nGET\nVAR\nEND_VAR\nEND_GET\nEND_PROPERTY\n", text);
        Assert.Contains("\nMETHOD ABSTRACT Pick : INT\n%LANGUAGE ST\nEND_METHOD\n", text);
        Assert.Contains("\nMETHOD ABSTRACT Held : INT\n%LANGUAGE ST\nHeld := 1;\nEND_METHOD\n", text);
        Assert.Contains("GET\nVAR\nEND_VAR\n%LANGUAGE ST\nEND_GET", Pulled(SlottedGetIde()));
        Assert.DoesNotContain("IMPLEMENTATION", text);
    }

    // ── the push against the live object ─────────────────────────────────────────────────────────

    /// <summary>An edit beside the slotless members lands, and no body is written at them.</summary>
    [Fact]
    public void A_declaration_edit_at_a_member_with_no_slot_lands_and_writes_no_body()
    {
        var ide = Ide();
        var edited = Edit(Pulled(ide), "METHOD ABSTRACT Take : INT", "METHOD ABSTRACT Take : INT\n// edited");

        AssertAccepted(Push(ide, edited));

        var written = Assert.Single(ide.WrittenContent[Bare].Members, m => m.Name == "Take");
        Assert.Contains("// edited", written.Declaration);
        Assert.Null(written.Body);
        Assert.Equal(edited, Pulled(ide));
    }

    /// <summary>No line over a live member WITH a slot is the lost line: refused naming the member and <c>volt pull</c>,
    /// before any write — never read as "the member has no slot".</summary>
    [Theory]
    [InlineData("\nMETHOD ABSTRACT Pick : INT\n%LANGUAGE ST\nEND_METHOD", "\nMETHOD ABSTRACT Pick : INT\nEND_METHOD", "'Pick'")]
    [InlineData("\nMETHOD ABSTRACT Held : INT\n%LANGUAGE ST\nHeld := 1;\nEND_METHOD", "\nMETHOD ABSTRACT Held : INT\nEND_METHOD", "'Held'")]
    [InlineData("\nMETHOD Run : BOOL\nVAR\nEND_VAR\n%LANGUAGE ST\nRun := TRUE;\nEND_METHOD", "\nMETHOD Run : BOOL\nVAR\nEND_VAR\nEND_METHOD", "'Run'")]
    public void No_line_over_a_live_member_with_a_slot_is_refused_naming_volt_pull(string from, string to, string named)
    {
        var ide = Ide();

        var reason = Refused(Push(ide, Edit(Pulled(ide), from, to)));

        Assert.Contains(named, reason);
        Assert.Contains("states no %LANGUAGE line", reason);
        Assert.Contains("volt pull", reason);
        AssertNothingMutated(ide);
    }

    [Fact]
    public void No_line_over_a_live_accessor_with_a_slot_is_refused_naming_volt_pull()
    {
        var ide = SlottedGetIde();

        var reason = Refused(Push(ide, Edit(Pulled(ide), "GET\nVAR\nEND_VAR\n%LANGUAGE ST\nEND_GET", "GET\nVAR\nEND_VAR\nEND_GET")));

        Assert.Contains("'Rdy' GET", reason);
        Assert.Contains("volt pull", reason);
        AssertNothingMutated(ide);
    }

    /// <summary>A stated language over a live slotless member has nowhere to go — refused by name, for an empty body and
    /// for code alike, before any write.</summary>
    [Theory]
    [InlineData("\nMETHOD ABSTRACT Take : INT\nEND_METHOD", "\nMETHOD ABSTRACT Take : INT\n%LANGUAGE ST\nEND_METHOD", "'Take'")]
    [InlineData("\nMETHOD ABSTRACT Take : INT\nEND_METHOD", "\nMETHOD ABSTRACT Take : INT\n%LANGUAGE ST\n// later\nEND_METHOD", "'Take'")]
    [InlineData("GET\nVAR\nEND_VAR\nEND_GET", "GET\nVAR\nEND_VAR\n%LANGUAGE ST\nEND_GET", "'Busy' GET")]
    public void A_stated_language_over_a_live_member_with_no_slot_is_refused(string from, string to, string named)
    {
        var ide = Ide();

        var reason = Refused(Push(ide, Edit(Pulled(ide), from, to)));

        Assert.Contains(named, reason);
        Assert.Contains("no body slot", reason);
        AssertNothingMutated(ide);
    }

    /// <summary>The LD row of the theory above, apart: an LD body's push is refused by name in the read-only phase before
    /// the slot rule is reached (network-text-st 2.1); 3.1 returns it to the theory.</summary>
    [Theory(Skip = ReadOnlyNetworkPush.Skip)]
    [InlineData("GET\nVAR\nEND_VAR\nEND_GET", "GET\nVAR\nEND_VAR\n%LANGUAGE LD\nEND_GET", "'Busy' GET")]
    public void A_stated_graphical_language_over_a_live_member_with_no_slot_is_refused(string from, string to, string named)
    {
        var ide = Ide();

        var reason = Refused(Push(ide, Edit(Pulled(ide), from, to)));

        Assert.Contains(named, reason);
        Assert.Contains("no body slot", reason);
        AssertNothingMutated(ide);
    }

    /// <summary>An ABSTRACT METHOD with no line, CREATED: the text states a member with no slot, and the create makes the
    /// vendor's abstract class (CODESYS constructs <c>AbstractPOUMethodObject</c>, DIALECT C2r — the fake makes it as
    /// CODESYS does), so it pulls back as pushed. The migration of a pro2193 owner, as pulled, rests on it.</summary>
    [Fact]
    public void An_abstract_method_created_with_no_line_is_made_without_a_slot_and_pulls_back_as_pushed()
    {
        var ide = Ide();
        var added = Pulled(ide).TrimEnd('\n') + "\n\nMETHOD ABSTRACT Later : INT\nVAR_INPUT\n\tn : INT;\nEND_VAR\nEND_METHOD\n";

        AssertAccepted(Push(ide, added));

        Assert.Equal("AbstractPOUMethodObject", ide.ClassOf("Later"));
        Assert.Contains("\nMETHOD ABSTRACT Later : INT\nVAR_INPUT\n\tn : INT;\nEND_VAR\nEND_METHOD\n", Pulled(ide));
    }

    /// <summary>…and so is a whole owner created with one (a blank-project or cross-project push of a pulled file).</summary>
    [Fact]
    public void An_owner_created_with_an_abstract_method_stating_no_line_lands_and_pulls_back_as_pushed()
    {
        var ide = Ide();
        const string src = "FUNCTION_BLOCK ABSTRACT FB_Mig\nVAR\n\tbusy : BOOL;\nEND_VAR\n%LANGUAGE ST\n\nEND_FUNCTION_BLOCK\n\n" +
                           "METHOD Run : BOOL\n%LANGUAGE ST\nRun := busy;\nEND_METHOD\n\n" +
                           "METHOD ABSTRACT TakePicture : INT\nEND_METHOD\n";
        var refs = RefsService.Handle(ide);

        var resp = BoundWrite.Push(ide, new PushRequest
        {
            ExpectedProjectVersion = refs.ProjectVersion,
            Ops = new List<PushOp> { new SetItemOp { Name = "FB_Mig.pou", SourceText = src, IfVersion = null } },
        });

        AssertAccepted(resp);
        Assert.Equal("AbstractPOUMethodObject", ide.ClassOf("TakePicture"));
        var pulled = Assert.Single(FetchService.Handle(ide, new FetchRequest { Init = true }).Changed, c => c.Name == "FB_Mig.pou");
        Assert.Equal(src, pulled.SourceText.Replace("\r\n", "\n"));
    }

    /// <summary>No line on a created member that is no ABSTRACT METHOD: a concrete method has a body, and no accessor class
    /// without a slot has a measured create — refused by name, saying to state <c>%LANGUAGE ST</c>.</summary>
    [Theory]
    [InlineData("METHOD Later : INT\nEND_METHOD", "'Later'", "not declared ABSTRACT")]
    [InlineData("PROPERTY PUBLIC ABSTRACT Ready : BOOL\nGET\nEND_GET\nEND_PROPERTY", "'Ready' GET", "creates no accessor without one")]
    public void No_line_on_a_created_member_that_is_no_abstract_method_is_refused(string member, string named, string why)
    {
        var ide = Ide();

        var reason = Refused(Push(ide, Pulled(ide).TrimEnd('\n') + "\n\n" + member + "\n"));

        Assert.Contains(named, reason);
        Assert.Contains(why, reason);
        Assert.Contains("%LANGUAGE ST", reason);
        AssertNothingMutated(ide);
    }

    /// <summary>An accessor the IDE does not hold, added with no line, is a CREATE of that accessor: refused as one — never
    /// as a line lost from an accessor that does not exist, whose remedy (<c>volt pull</c>) could not help.</summary>
    [Fact]
    public void An_accessor_added_with_no_line_is_refused_as_a_create_and_not_as_a_lost_line()
    {
        var ide = SlottedGetIde();

        var reason = Refused(Push(ide, Edit(Pulled(ide), "%LANGUAGE ST\nEND_GET\n", "%LANGUAGE ST\nEND_GET\nSET\nVAR\nEND_VAR\nEND_SET\n")));

        Assert.Contains("'Rdy' SET", reason);
        Assert.Contains("creates no accessor without one", reason);
        Assert.DoesNotContain("volt pull", reason);
        AssertNothingMutated(ide);
    }

    /// <summary>…and the same member stated <c>%LANGUAGE ST</c> with an empty body lands, and pulls back as pushed.</summary>
    [Fact]
    public void An_abstract_member_created_with_an_empty_ST_body_lands_and_pulls_back_unchanged()
    {
        var ide = Ide();
        var added = Pulled(ide).TrimEnd('\n') + "\n\nMETHOD ABSTRACT Later : INT\n%LANGUAGE ST\nEND_METHOD\n";

        AssertAccepted(Push(ide, added));

        Assert.Contains("\nMETHOD ABSTRACT Later : INT\n%LANGUAGE ST\nEND_METHOD\n", Pulled(ide));
    }

    /// <summary>A rename of a member with no slot into one with none is the vendor's rename (the object and its class
    /// kept), accepted; it pulls back with no line.</summary>
    [Fact]
    public void Renaming_a_member_with_no_slot_is_accepted_and_pulls_back_with_no_line()
    {
        var ide = Ide();

        AssertAccepted(Push(ide, Edit(Pulled(ide), "METHOD ABSTRACT Take : INT", "METHOD ABSTRACT TakeImage : INT")));

        Assert.Contains("\nMETHOD ABSTRACT TakeImage : INT\nEND_METHOD\n", Pulled(ide));
    }

    /// <summary>Dropping ABSTRACT from an abstract member with no slot: the IDE keeps the object's class whatever its text
    /// (DIALECT C2l), so the member would stay abstract and slotless under a declaration that says concrete — refused by
    /// name, before any write, naming the two routes that exist. The same for an abstract property's slotless GET.</summary>
    [Theory]
    [InlineData("METHOD ABSTRACT Take : INT", "METHOD Take : INT", "'Take'")]
    [InlineData("PROPERTY PUBLIC ABSTRACT Busy : BOOL", "PROPERTY PUBLIC Busy : BOOL", "'Busy' GET")]
    public void Dropping_ABSTRACT_from_a_member_with_no_slot_is_refused(string from, string to, string named)
    {
        var ide = Ide();

        var reason = Refused(Push(ide, Edit(Pulled(ide), from, to)));

        Assert.Contains(named, reason);
        Assert.Contains("drops ABSTRACT", reason);
        Assert.Contains("volt pull", reason);
        AssertNothingMutated(ide);
    }

    /// <summary>A member's kind is its class, which never changes in place (DIALECT C2l): an action pushed as a METHOD is
    /// refused by name, before anything is written — with or without a line.</summary>
    [Fact]
    public void An_action_retyped_to_a_method_with_no_line_is_refused_by_name()
    {
        var ide = Ide();
        var pulled = Pulled(ide);
        var at = pulled.IndexOf("ACTION Step", System.StringComparison.Ordinal);
        var end = pulled.IndexOf("END_ACTION", at, System.StringComparison.Ordinal) + "END_ACTION".Length;

        var reason = Refused(Push(ide, pulled.Substring(0, at) + "METHOD ABSTRACT Step : INT\nEND_METHOD" + pulled.Substring(end)));

        Assert.Contains("'Step'", reason);
        AssertNothingMutated(ide);
    }

    /// <summary>The CLI's post-push check compares the texts as they read: a member stated <c>%LANGUAGE ST</c> and one
    /// with no line are two texts, never the same one laid out otherwise.</summary>
    [Fact]
    public void PushedText_tells_a_member_with_no_line_from_one_with_an_empty_ST_body()
    {
        var held = Pulled(Ide());
        var stated = Edit(held, "\nMETHOD ABSTRACT Take : INT\nEND_METHOD", "\nMETHOD ABSTRACT Take : INT\n%LANGUAGE ST\nEND_METHOD");

        Assert.True(PushedText.SameExceptLayout(Name, held, held));
        Assert.False(PushedText.SameExceptLayout(Name, stated, held));
    }

    // ── statements under ABSTRACT, where there is a slot ─────────────────────────────────────────────

    /// <summary>Both compilers refuse them (C0433). Refused before any write, naming the member and the IDE's words.</summary>
    [Theory]
    [InlineData("\nMETHOD ABSTRACT Pick : INT\n%LANGUAGE ST\nEND_METHOD", "\nMETHOD ABSTRACT Pick : INT\n%LANGUAGE ST\nPick := 1;\nEND_METHOD", "'Pick'")]
    [InlineData("METHOD Run : BOOL", "METHOD ABSTRACT Run : BOOL", "'Run'")]   // a member with code made abstract
    [InlineData("Held := 1;", "Held := 2;", "'Held'")]                         // the IDE's own code, changed
    public void Statements_under_ABSTRACT_are_refused_naming_the_member_and_the_IDEs_words(string from, string to, string named)
    {
        var ide = Ide();

        var reason = Refused(Push(ide, Edit(Pulled(ide), from, to)));

        Assert.Contains(named, reason);
        Assert.Contains("must not contain any statements", reason);
        AssertNothingMutated(ide);
    }

    [Fact]
    public void Statements_in_an_abstract_propertys_GET_are_refused()
    {
        var ide = SlottedGetIde();

        var reason = Refused(Push(ide, Edit(Pulled(ide), "%LANGUAGE ST\nEND_GET", "%LANGUAGE ST\nRdy := TRUE;\nEND_GET")));

        Assert.Contains("'Rdy' GET", reason);
        Assert.Contains("must not contain any statements", reason);
        AssertNothingMutated(ide);
    }

    /// <summary>The code the IDE already holds under ABSTRACT, pushed back unchanged, is accepted and not written — so a
    /// project that does not compile can still push its other items.</summary>
    [Fact]
    public void The_IDEs_own_code_under_ABSTRACT_pushed_back_unchanged_is_accepted_and_not_written()
    {
        var ide = Ide();

        AssertAccepted(Push(ide, Edit(Pulled(ide), "METHOD Run : BOOL", "METHOD Run : BOOL\n// edited")));

        Assert.DoesNotContain(ide.WrittenContent[Bare].Members, m => m.Name == "Held");
        Assert.Equal("Held := 1;", ide.StoredImplementation("Held"));
    }

    /// <summary>A comment is not a statement on either compiler (measured): under ABSTRACT it is accepted and written, over
    /// a live body and on a create alike.</summary>
    [Fact]
    public void A_comment_only_body_under_ABSTRACT_is_accepted_and_written()
    {
        var ide = Ide();
        var edited = Edit(Pulled(ide), "Held := 1;", "// to be overridden").TrimEnd('\n')
                     + "\n\nMETHOD ABSTRACT Later : INT\n%LANGUAGE ST\n(* later *)\nEND_METHOD\n";

        AssertAccepted(Push(ide, edited));

        Assert.Equal("// to be overridden", ide.StoredImplementation("Held"));
        Assert.Equal("(* later *)", ide.StoredImplementation("Later"));
    }

    [Fact]
    public void An_abstract_member_created_with_statements_is_refused()
    {
        var ide = Ide();

        var reason = Refused(Push(ide, Pulled(ide).TrimEnd('\n') + "\n\nMETHOD ABSTRACT Later : INT\n%LANGUAGE ST\nLater := 1;\nEND_METHOD\n"));

        Assert.Contains("'Later'", reason);
        Assert.Contains("must not contain any statements", reason);
        AssertNothingMutated(ide);
    }
}
