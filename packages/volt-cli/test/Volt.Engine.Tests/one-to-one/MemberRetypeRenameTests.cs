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
        ExpectRed.Until(Task, "finding 2: a member re-type is delete + create", () =>
        {
            var ide = Owner(new FakeIde.Item("Ready", ItemKind.PlcProp, "", false, "PROPERTY Ready : BOOL", null, null, null));
            var text = Pulled(ide, "FB_Owner.pou");
            var retyped = text.Substring(0, text.IndexOf("PROPERTY Ready", StringComparison.Ordinal))
                          + "METHOD Ready : BOOL\nIMPLEMENTATION ST\nReady := TRUE;\nEND_METHOD\n";

            var resp = Update(ide, "FB_Owner.pou", retyped);

            RefusedNaming(resp, "Ready");
            Assert.False(Replaced(ide), string.Join(", ", ide.Recorded));
        });
    }

    /// <summary>A renamed member keeps its object — through the vendor's rename, its class (here the abstract method's)
    /// and its properties (here exclude-from-build) kept — or the push refuses it by name. It is never a delete of the
    /// old object and a create of a plain one.</summary>
    [Fact]
    public void A_member_rename_keeps_the_object_or_is_refused_by_name()
    {
        ExpectRed.Until(Task, "finding 2: a member rename is delete + create", () =>
        {
            var props = Props(exclude: true);
            var ide = Owner(new FakeIde.Item("TakePicture", ItemKind.PlcMethod, "", false,
                                             "METHOD ABSTRACT TakePicture : BOOL\nVAR_INPUT\nEND_VAR", "", null, null,
                                             Class: "AbstractPOUMethodObject") { Properties = props });
            var text = Pulled(ide, "FB_Owner.pou");

            var resp = Update(ide, "FB_Owner.pou", text.Replace("TakePicture", "TakePhoto"));

            Assert.False(Replaced(ide), string.Join(", ", ide.Recorded));
            if (!resp.Accepted) { RefusedNaming(resp, "TakePicture"); return; }
            Assert.Contains("rename:TakePicture->TakePhoto", ide.Recorded);
            Assert.Equal("AbstractPOUMethodObject", ide.ClassOf("TakePhoto"));
            Assert.Equal(props, ide.PropertiesOf("TakePhoto"));
        });
    }

    /// <summary>The same for a plain method that carries properties: the push must not trade an excluded method for an
    /// included one under a new name.</summary>
    [Fact]
    public void A_renamed_excluded_method_stays_excluded_or_the_rename_is_refused()
    {
        ExpectRed.Until(Task, "finding 2: a renamed member loses its build properties", () =>
        {
            var props = Props(exclude: true);
            var ide = Owner(new FakeIde.Item("Calc", ItemKind.PlcMethod, "", false,
                                             "METHOD Calc : INT", "Calc := 1;", null, null) { Properties = props });
            var text = Pulled(ide, "FB_Owner.pou");

            var resp = Update(ide, "FB_Owner.pou", text.Replace("Calc", "Compute"));

            Assert.False(Replaced(ide), string.Join(", ", ide.Recorded));
            if (!resp.Accepted) { RefusedNaming(resp, "Calc"); return; }
            Assert.Equal(props, ide.PropertiesOf("Compute"));
        });
    }
}
