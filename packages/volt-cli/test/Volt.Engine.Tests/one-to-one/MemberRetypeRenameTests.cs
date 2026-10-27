using System;
using System.Linq;
using Volt.Engine.Item;
using Xunit;
using static Volt.Engine.Tests.OneToOne.OneToOneSteps;

namespace Volt.Engine.Tests.OneToOne;

/// <summary>
/// FINDING 2 — A MEMBER RE-TYPE OR RENAME IS DELETE + CREATE (openspec <c>bridge-one-to-one</c> proposal 2, design §1.2
/// "Re-type / rename", §2.2).
///
/// <para><c>PushService.ReconcileMembers</c> (<c>:1984-2013</c>) deletes a member whose kind changed and creates it anew,
/// and a renamed member is an old name the text dropped plus a new one it added — delete + create again. Either way the
/// vendor object is REPLACED: an <c>AbstractPOUMethodObject</c> comes back a <c>POUMethodObject</c>, a method's
/// <c>BuildProperty</c> (7 excluded methods in the corpora) and its object GUID are gone, and the push says ACCEPTED.
/// The design: a rename goes through the vendor's rename (the object kept), a re-type is refused by name (a class never
/// changes in place, C2l) — never delete + create.</para>
///
/// <para>Red until 3.4. The FakeIde models the vendor: its <c>Rename</c> keeps the object (class and properties), its
/// <c>CreateChild</c> makes a plain one.</para>
/// </summary>
public class MemberRetypeRenameTests
{
    private const string Task = "3.4";
    private const string NL = "\n";

    private static FakeIde Owner(FakeIde.Item member) =>
        new(new FakeIde.Item("FB_Owner", ItemKind.PlcPou, "FBs", true,
                             "FUNCTION_BLOCK ABSTRACT FB_Owner\nVAR\nEND_VAR", ";", null, null,
                             Children: new[] { member.Name }),
            member);

    private static bool Replaced(FakeIde ide) =>
        ide.Recorded.Any(r => r.StartsWith("delete:", StringComparison.Ordinal))
        && ide.Recorded.Any(r => r.StartsWith("create:", StringComparison.Ordinal));

    /// <summary>A member whose KIND changed (<c>PROPERTY Ready</c> → <c>METHOD Ready</c>) is another class of object: the
    /// push refuses it by name, the member and both kinds, and lands nothing.</summary>
    [Fact]
    public void A_member_re_type_is_refused_by_name()
    {
        var ide = Owner(new FakeIde.Item("Ready", ItemKind.PlcProp, "", false, "PROPERTY Ready : BOOL", null, null, null));
        var text = Pulled(ide, "FBs/FB_Owner.pou");
        var retyped = text.Substring(0, text.IndexOf("PROPERTY Ready", StringComparison.Ordinal))
                      + "METHOD Ready : BOOL\n%LANGUAGE ST\nReady := TRUE;\nEND_METHOD\n";

        var resp = Update(ide, "FBs/FB_Owner.pou", retyped);

        RefusedNaming(resp, "Ready");
        Assert.False(Replaced(ide), string.Join(", ", ide.Recorded));
    }

    /// <summary>A renamed member keeps its object — through the vendor's rename, its class (here the abstract method's)
    /// and its properties (here exclude-from-build) kept — or the push refuses it by name. It is never a delete of the
    /// old object and a create of a plain one.</summary>
    [Fact]
    public void A_member_rename_keeps_the_object_or_is_refused_by_name()
    {
        var props = Props(exclude: true);
        var ide = Owner(new FakeIde.Item("TakePicture", ItemKind.PlcMethod, "", false,
                                         "METHOD ABSTRACT TakePicture : BOOL\nVAR_INPUT\nEND_VAR", "", null, null,
                                         Class: "AbstractPOUMethodObject") { Properties = props });
        var text = Pulled(ide, "FBs/FB_Owner.pou");

        var resp = Update(ide, "FBs/FB_Owner.pou", text.Replace("TakePicture", "TakePhoto"));

        Assert.False(Replaced(ide), string.Join(", ", ide.Recorded));
        if (!resp.Landed()) { RefusedNaming(resp, "TakePicture"); return; }
        Assert.Contains("rename:TakePicture->TakePhoto", ide.Recorded);
        Assert.Equal("AbstractPOUMethodObject", ide.ClassOf("TakePhoto"));
        Assert.Equal(props, ide.PropertiesOf("TakePhoto"));
    }

    /// <summary>The same for a plain method that carries properties: the push must not trade an excluded method for an
    /// included one under a new name.</summary>
    [Fact]
    public void A_renamed_excluded_method_stays_excluded_or_the_rename_is_refused()
    {
        var props = Props(exclude: true);
        var ide = Owner(new FakeIde.Item("Calc", ItemKind.PlcMethod, "", false,
                                         "METHOD Calc : INT", "Calc := 1;", null, null) { Properties = props });
        var text = Pulled(ide, "FBs/FB_Owner.pou");

        var resp = Update(ide, "FBs/FB_Owner.pou", text.Replace("Calc", "Compute"));

        Assert.False(Replaced(ide), string.Join(", ", ide.Recorded));
        if (!resp.Landed()) { RefusedNaming(resp, "Calc"); return; }
        Assert.Equal(props, ide.PropertiesOf("Compute"));
    }

    /// <summary>A rename that also moves a method ACROSS its body slot is no rename (gate review of step 3, finding 1): the
    /// vendor's rename keeps the class, and the class follows the text (§1.1, <c>abstract-member-equivalence</c>) — an
    /// <c>AbstractPOUMethodObject</c> renamed into a method with code would keep no body slot, and the write of its body would
    /// be refused after the rename had landed. The drop and the add are a delete and a create, accepted, and the create
    /// makes the method the text states (slotted, plain).</summary>
    [Fact]
    public void An_abstract_method_renamed_into_one_with_code_is_a_delete_and_a_create()
    {
        var ide = Owner(new FakeIde.Item("Pick", ItemKind.PlcMethod, "", false, "METHOD ABSTRACT Pick : BOOL", null, null, null,
                                         Class: "AbstractPOUMethodObject") { NoSlot = true });
        var text = Pulled(ide, "FBs/FB_Owner.pou");
        var at = text.IndexOf("METHOD ABSTRACT Pick", StringComparison.Ordinal);
        var end = text.IndexOf("END_METHOD", at, StringComparison.Ordinal) + "END_METHOD".Length;
        var pushed = text.Substring(0, at) + "METHOD Choose : BOOL" + NL + "%LANGUAGE ST" + NL + "Choose := TRUE;" + NL + "END_METHOD" + text.Substring(end);

        var resp = Update(ide, "FBs/FB_Owner.pou", pushed);

        AcceptedOk(resp);
        Assert.DoesNotContain(ide.Recorded, r => r.StartsWith("rename:", StringComparison.Ordinal));
        Assert.Contains("delete:Pick", ide.Recorded);
        Assert.Contains("create:Choose", ide.Recorded);
        Assert.Null(ide.ClassOf("Choose"));
    }

    /// <summary>The reverse: a method with code renamed into <c>METHOD ABSTRACT</c> stating no <c>%LANGUAGE</c> line (no body
    /// slot) is a delete and a create, and the create makes the vendor's abstract class (§1.1: "A create of METHOD ABSTRACT
    /// with no code makes the vendor's abstract class"; openspec <c>language-line</c>: the text states no slot) — the rename
    /// would have kept the slotted class under a text that states none. Stated <c>%LANGUAGE ST</c>, the same rename keeps
    /// the object.</summary>
    [Fact]
    public void A_method_with_code_renamed_into_an_abstract_one_with_no_slot_is_created_abstract()
    {
        var ide = Owner(new FakeIde.Item("Calc", ItemKind.PlcMethod, "", false, "METHOD Calc : BOOL", "Calc := TRUE;", null, null));
        var text = Pulled(ide, "FBs/FB_Owner.pou");
        var at = text.IndexOf("METHOD Calc", StringComparison.Ordinal);
        var end = text.IndexOf("END_METHOD", at, StringComparison.Ordinal) + "END_METHOD".Length;
        var noSlot = text.Substring(0, at) + "METHOD ABSTRACT Compute : BOOL" + NL + "END_METHOD" + text.Substring(end);

        AcceptedOk(Update(ide, "FBs/FB_Owner.pou", noSlot));
        Assert.DoesNotContain(ide.Recorded, r => r.StartsWith("rename:", StringComparison.Ordinal));
        Assert.Equal("AbstractPOUMethodObject", ide.ClassOf("Compute"));

        var slottedIde = Owner(new FakeIde.Item("Calc", ItemKind.PlcMethod, "", false, "METHOD Calc : BOOL", "Calc := TRUE;", null, null));
        var slotted = text.Substring(0, at) + "METHOD ABSTRACT Compute : BOOL" + NL + "%LANGUAGE ST" + NL + "END_METHOD" + text.Substring(end);
        AcceptedOk(Update(slottedIde, "FBs/FB_Owner.pou", slotted));
        Assert.Contains("rename:Calc", string.Join(",", slottedIde.Recorded));
    }

    /// <summary>The same for a PROPERTY, whose slot is its accessors' (gate review of step 3, second review, finding 2): an
    /// abstract property's GET is the slotless <c>InterfacePropertyAccessorObject</c>, and a property is paired by its own
    /// <c>Stated</c>, which it never has — so <c>PROPERTY ABSTRACT Busy</c> (GET NONE) renamed into a concrete <c>Ready</c>
    /// whose GET has code was renamed, kept the slotless GET, and the GET body was refused AFTER the rename landed. The
    /// drop and the add are a delete and a create, accepted, the GET created with a slot.</summary>
    [Fact]
    public void An_abstract_property_renamed_into_one_whose_get_has_code_is_a_delete_and_a_create()
    {
        var ide = new FakeIde(
            new FakeIde.Item("FB_Owner", ItemKind.PlcPou, "FBs", true, "FUNCTION_BLOCK ABSTRACT FB_Owner" + NL + "VAR" + NL + "END_VAR", ";", null, null,
                             Children: new[] { "Busy" }),
            new FakeIde.Item("Busy", ItemKind.PlcProp, "", false, "PROPERTY ABSTRACT Busy : BOOL", null, null, null, new[] { "Get" }),
            new FakeIde.Item("Get", ItemKind.PlcPropGet, "", false, "VAR" + NL + "END_VAR", null, null, null) { NoSlot = true });
        var text = Pulled(ide, "FBs/FB_Owner.pou").Replace("\r\n", NL);
        var at = text.IndexOf("PROPERTY ABSTRACT Busy", StringComparison.Ordinal);
        var end = text.IndexOf("END_PROPERTY", at, StringComparison.Ordinal) + "END_PROPERTY".Length;
        var pushed = text.Substring(0, at) + "PROPERTY Ready : BOOL" + NL + "GET" + NL + "VAR" + NL + "END_VAR" + NL
                     + "%LANGUAGE ST" + NL + "Ready := TRUE;" + NL + "END_GET" + NL + "END_PROPERTY" + text.Substring(end);

        var resp = Update(ide, "FBs/FB_Owner.pou", pushed);

        AcceptedOk(resp);
        Assert.DoesNotContain(ide.Recorded, r => r.StartsWith("rename:", StringComparison.Ordinal));
        Assert.Contains("delete:Busy", ide.Recorded);
        Assert.Contains("create:Ready", ide.Recorded);
    }
}
