using System.Collections.Generic;
using System.Linq;
using Xunit;

using Volt.Wire;
using Volt.Contracts;
using Volt.Engine.Sync;
using Volt.Engine.Format.St;
using Volt.Engine.Item;

namespace Volt.Engine.Tests;

/// <summary>
/// A MEMBER WITH NO BODY SLOT (openspec <c>abstract-member-push</c>, DIALECT C2n): CODESYS holds an abstract method as an
/// <c>AbstractPOUMethodObject</c> and an abstract property's GET as an <c>InterfacePropertyAccessorObject</c>, neither with
/// an <c>Implementation</c> aspect. The pull states it <c>IMPLEMENTATION NONE</c>; the push writes no body there. The
/// double models the slot as the CODESYS driver reads it (<see cref="FakeIde.Item.NoSlot"/>) and refuses a body written
/// there as the driver's <c>RequireSlot</c> does.
///
/// <para>Since openspec <c>abstract-member-parity</c> the text is decided by the declaration, not the slot, so the same
/// rules hold for a slotted abstract member (<see cref="AbstractMemberParityTests"/>, one test per guard row). Four
/// tests here asserted the slot-based answers step 2 measured wrong and now assert the declaration-based ones: an empty
/// <c>IMPLEMENTATION ST</c> under ABSTRACT is NONE (accepted, nothing written), code under ABSTRACT is refused with the
/// IDE's words ("must not contain any statements", C0433 on both compilers), and an abstract member stated NONE on a
/// create or a rename is accepted (a created member has a slot on both vendors; <c>""</c> is written there).</para>
/// </summary>
public class AbstractMemberNoSlotTests
{
    private const string Bare = "FB_Base";
    private const string Name = Bare + ".pou";
    private const string Decl = "FUNCTION_BLOCK ABSTRACT FB_Base\nVAR\n\tx : INT;\nEND_VAR";

    /// <summary>pro2193's shape: an abstract method and an abstract property's GET with no slot, a method with an EMPTY
    /// ST body (a slot holding nothing) beside them.</summary>
    private static FakeIde Ide() => new(
        new FakeIde.Item(Bare, ItemKind.PlcPou, "", true, Decl, "x := x + 1;", null, null,
                         new[] { "TakePicture", "Busy", "Run" }),
        new FakeIde.Item("TakePicture", ItemKind.PlcMethod, "", false, "METHOD ABSTRACT TakePicture : INT", null, null, null)
            { NoSlot = true },
        new FakeIde.Item("Busy", ItemKind.PlcProp, "", false, "PROPERTY PUBLIC ABSTRACT Busy : BOOL", null, null, null,
                         new[] { "Get" }),
        new FakeIde.Item("Get", ItemKind.PlcPropGet, "", false, "VAR\nEND_VAR", null, null, null) { NoSlot = true },
        new FakeIde.Item("Run", ItemKind.PlcMethod, "", false, "METHOD Run : BOOL\nVAR\nEND_VAR", "", null, null));

    private static string Pulled(FakeIde ide) =>
        Assert.Single(FetchService.Handle(ide, new FetchRequest { Init = true }).Changed, c => c.Name == Name).SourceText;

    private static PushResponse Push(FakeIde ide, string sourceText)
    {
        var refs = RefsService.Handle(ide);
        return PushService.Handle(ide, new PushRequest
        {
            ExpectedProjectVersion = refs.ProjectVersion,
            Ops = new List<PushOp> { new SetItemOp { Name = Name, IfVersion = refs.Items[Name], SourceText = sourceText } },
        });
    }

    private static void AssertNothingMutated(FakeIde ide) =>
        Assert.DoesNotContain(ide.Recorded, r =>
            r.StartsWith("write") || r.StartsWith("create:") || r.StartsWith("delete:") || r.StartsWith("move:")
            || r.StartsWith("rename:"));

    /// <summary>The pull states the missing slot, and only there: the empty body of a method that HAS a slot keeps
    /// <c>IMPLEMENTATION ST</c>.</summary>
    [Fact]
    public void The_pull_states_IMPLEMENTATION_NONE_under_a_member_with_no_slot_and_ST_under_an_empty_body()
    {
        var text = Pulled(Ide()).Replace("\r\n", "\n");

        Assert.Contains("METHOD ABSTRACT TakePicture : INT\nIMPLEMENTATION NONE\nEND_METHOD", text);
        Assert.Contains("GET\nVAR\nEND_VAR\nIMPLEMENTATION NONE\nEND_GET", text);
        Assert.Contains("METHOD Run : BOOL\nVAR\nEND_VAR\nIMPLEMENTATION ST\n", text);
        Assert.Equal(2, text.Split('\n').Count(l => l == "IMPLEMENTATION NONE"));
    }

    /// <summary>The spec's first scenario: an edit beside the abstract members lands, and no body is written at them.</summary>
    [Fact]
    public void A_declaration_edit_beside_the_abstract_members_is_accepted_and_writes_no_body_at_them()
    {
        var ide = Ide();
        var edited = Pulled(ide).Replace("METHOD ABSTRACT TakePicture : INT", "METHOD ABSTRACT TakePicture : INT\n// edited");

        var resp = Push(ide, edited);

        Assert.True(resp.Accepted, string.Join("; ", (resp.Conflicts ?? []).Select(c => c.Reason)));
        var written = Assert.Single(ide.WrittenContent[Bare].Members, m => m.Name == "TakePicture");
        Assert.Contains("// edited", written.Declaration);
        Assert.Null(ImplementationMarker.Written(written.Body));                          // no body at the missing slot
        Assert.Equal(edited.Replace("\r\n", "\n"), Pulled(ide).Replace("\r\n", "\n"));   // still NONE, nothing else moved
    }

    /// <summary>Code under an abstract member with no slot: refused before any write, naming the member and the IDE's
    /// words (an empty <c>IMPLEMENTATION ST</c> there is NONE: <see cref="AbstractMemberParityTests"/>).</summary>
    [Fact]
    public void Code_stated_ST_over_a_member_with_no_slot_is_refused_naming_it()
    {
        var ide = Ide();
        var stale = Pulled(ide).Replace("METHOD ABSTRACT TakePicture : INT\nIMPLEMENTATION NONE",
                                        "METHOD ABSTRACT TakePicture : INT\nIMPLEMENTATION ST\nTakePicture := 1;");

        var resp = Push(ide, stale);

        Assert.False(resp.Accepted);
        var reason = Assert.Single(resp.Conflicts!).Reason;
        Assert.Contains("'TakePicture'", reason);
        Assert.Contains("must not contain any statements", reason);
        AssertNothingMutated(ide);
    }

    [Fact]
    public void Code_in_a_GET_over_an_accessor_with_no_slot_is_refused_naming_it()
    {
        var ide = Ide();
        var stale = Pulled(ide).Replace("GET\nVAR\nEND_VAR\nIMPLEMENTATION NONE", "GET\nVAR\nEND_VAR\nIMPLEMENTATION ST\nBusy := TRUE;");

        var resp = Push(ide, stale);

        var reason = Assert.Single(resp.Conflicts!).Reason;
        Assert.Contains("'Busy' GET", reason);
        Assert.Contains("must not contain any statements", reason);
        AssertNothingMutated(ide);
    }

    /// <summary>NONE over a CONCRETE member: the line says abstract and the declaration says concrete — refused with its
    /// own message: the member, <c>volt pull</c> and the <c>IMPLEMENTATION ST</c> remedy.</summary>
    [Fact]
    public void IMPLEMENTATION_NONE_over_a_member_with_a_slot_is_refused_naming_it_and_both_remedies()
    {
        var ide = Ide();
        var wrong = Pulled(ide).Replace("METHOD Run : BOOL\nVAR\nEND_VAR\nIMPLEMENTATION ST", "METHOD Run : BOOL\nVAR\nEND_VAR\nIMPLEMENTATION NONE");
        Assert.Contains("METHOD Run : BOOL\nVAR\nEND_VAR\nIMPLEMENTATION NONE", wrong);

        var resp = Push(ide, wrong);

        var reason = Assert.Single(resp.Conflicts!).Reason;
        Assert.Contains("'Run'", reason);
        Assert.Contains("not ABSTRACT", reason);
        Assert.Contains("volt pull", reason);
        Assert.Contains("IMPLEMENTATION ST", reason);
        AssertNothingMutated(ide);
    }

    /// <summary>An abstract member ADDED with NONE: accepted (the migration refusal is gone) — the create makes a member
    /// with a slot, <c>""</c> is written there, and the next pull reads NONE by the fold.</summary>
    [Fact]
    public void A_member_added_with_IMPLEMENTATION_NONE_is_accepted_and_pulls_back_NONE()
    {
        var ide = Ide();
        var added = Pulled(ide).TrimEnd('\n') + "\n\nMETHOD ABSTRACT Pick : INT\nIMPLEMENTATION NONE\nEND_METHOD\n";

        var resp = Push(ide, added);

        Assert.True(resp.Accepted, string.Join("; ", (resp.Conflicts ?? []).Select(c => c.Reason)));
        Assert.Equal("", ide.StoredImplementation("Pick"));
        Assert.Contains("METHOD ABSTRACT Pick : INT\nIMPLEMENTATION NONE\nEND_METHOD", Pulled(ide).Replace("\r\n", "\n"));
    }

    /// <summary>A rename is delete + create to the reconciler, so a renamed abstract member is a create, accepted the
    /// same way. (On CODESYS the new object is a slotted <c>POUMethodObject</c>; the wire does not name the class.)</summary>
    [Fact]
    public void Renaming_a_member_with_no_slot_is_accepted_and_pulls_back_NONE()
    {
        var ide = Ide();
        var renamed = Pulled(ide).Replace("METHOD ABSTRACT TakePicture : INT", "METHOD ABSTRACT TakeImage : INT");

        var resp = Push(ide, renamed);

        Assert.True(resp.Accepted, string.Join("; ", (resp.Conflicts ?? []).Select(c => c.Reason)));
        Assert.Contains("METHOD ABSTRACT TakeImage : INT\nIMPLEMENTATION NONE\nEND_METHOD", Pulled(ide).Replace("\r\n", "\n"));
    }

    /// <summary>Removing ABSTRACT while keeping <c>IMPLEMENTATION NONE</c> makes the member concrete in the file only: the
    /// IDE's slotless object stays abstract whatever its text (DIALECT C2l) and NONE writes no body, so the push would
    /// report success over a member the IDE does not hold. Refused as the re-type it is (gate 3 review), naming the member
    /// and the remedy, before any write.</summary>
    [Fact]
    public void Removing_ABSTRACT_from_a_member_with_no_slot_is_refused_as_a_retype()
    {
        var ide = Ide();
        var concrete = Pulled(ide).Replace("METHOD ABSTRACT TakePicture : INT", "METHOD TakePicture : INT");

        var resp = Push(ide, concrete);

        Assert.False(resp.Accepted);
        var reason = Assert.Single(resp.Conflicts!).Reason;
        Assert.Contains("'TakePicture'", reason);
        Assert.Contains("ABSTRACT", reason);
        Assert.Contains("re-type", reason);
        // The engine names no vendor (spec: "saying the IDE keeps it abstract"); the guard runs above the vendor seam.
        Assert.Contains("the IDE keeps it abstract", reason);
        Assert.DoesNotContain("CODESYS", reason);
        AssertNothingMutated(ide);
    }

    /// <summary>The same for the abstract property: its GET's slot is decided by the PROPERTY's ABSTRACT.</summary>
    [Fact]
    public void Removing_ABSTRACT_from_a_property_whose_GET_has_no_slot_is_refused_as_a_retype()
    {
        var ide = Ide();
        var concrete = Pulled(ide).Replace("PROPERTY PUBLIC ABSTRACT Busy : BOOL", "PROPERTY PUBLIC Busy : BOOL");

        var resp = Push(ide, concrete);

        var reason = Assert.Single(resp.Conflicts!).Reason;
        Assert.Contains("'Busy' GET", reason);
        Assert.Contains("re-type", reason);
        // The engine names no vendor (spec: "saying the IDE keeps it abstract"); the guard runs above the vendor seam.
        Assert.Contains("the IDE keeps it abstract", reason);
        Assert.DoesNotContain("CODESYS", reason);
        AssertNothingMutated(ide);
    }

    /// <summary>Code under the line has no slot to go to: refused by the reader, naming the member.</summary>
    [Fact]
    public void Code_under_IMPLEMENTATION_NONE_is_refused_by_name()
    {
        var ide = Ide();
        var withCode = Pulled(ide).Replace("METHOD ABSTRACT TakePicture : INT\nIMPLEMENTATION NONE",
                                           "METHOD ABSTRACT TakePicture : INT\nIMPLEMENTATION NONE\nTakePicture := 1;");

        var resp = Push(ide, withCode);

        var reason = Assert.Single(resp.Conflicts!).Reason;
        Assert.Contains("TakePicture", reason);
        Assert.Contains("holds code under 'IMPLEMENTATION NONE'", reason);
        AssertNothingMutated(ide);
    }
}
