using System;
using System.Linq;
using Xunit;
using Volt.Engine.Ide;
using Volt.Engine.Item;

namespace Volt.Engine.Tests;

/// <summary>
/// THE MEMBER WALK BOTH DRIVERS RUN ON, tested once at the layer that owns it.
///
/// <para><c>MemberSites.Of</c> existed twice byte-for-byte — the struct, the walk and their doc comments
/// duplicated across the CODESYS and TwinCAT drivers — before being lifted into the engine. It had zero direct
/// tests either way, which is the worst combination: shared code that both vendors depend on and neither suite
/// covers.</para>
///
/// <para>What it decides is not cosmetic. A member's FOLDER comes from here, and the walk's own doc names the
/// failure: a member reached with a null folder materializes with no <c>%FOLDER</c> directive, the pulled file
/// looks legitimately folder-less, and the next push resolves that null to the POU ROOT and creates a DUPLICATE
/// beside the real member — with <c>volt status</c> clean the whole way through, because the version hash was
/// taken over the folder-less text.</para>
/// </summary>
public class MemberSitesTests
{
    private static FakeIde.Item Node(string name, int code, params string[] children) =>
        new(name, code, "", false, null, null, null, null,
            Children: children.Length == 0 ? null : children);

    /// <summary>A POU carrying a method at its root, a method inside `Helpers`, and one nested two deep.</summary>
    private static FakeIde Project() => new(
        new FakeIde.Item("FB_Host", ItemKind.PlcPouFb, "", true, "FUNCTION_BLOCK FB_Host", "", null, null,
                         Children: new[] { "AtRoot", "Helpers" }),
        Node("AtRoot", ItemKind.PlcMethod),
        Node("Helpers", ItemKind.PlcFolder, "Inner", "Deep"),
        Node("Inner", ItemKind.PlcMethod),
        Node("Deep", ItemKind.PlcFolder, "Buried"),
        Node("Buried", ItemKind.PlcAction));

    private static MemberSites.Site[] Walk(FakeIde ide) =>
        MemberSites.Of(ide, new ItemRef("FB_Host")).ToArray();

    /// <summary>A MEMBER AT THE POU ROOT HAS A NULL FOLDER, NOT AN EMPTY ONE.
    ///
    /// <para>Null and empty are different here and the difference is the whole point: null means "no folder"
    /// and the writer emits no <c>%FOLDER</c> directive at all. An empty string would emit an empty directive,
    /// which is a different document.</para></summary>
    [Fact]
    public void A_root_member_has_a_null_folder()
    {
        var root = Assert.Single(Walk(Project()).Where(s => s.Name == "AtRoot"));

        Assert.Null(root.Folder);
        Assert.Equal(ItemKind.PlcMethod, root.Code);
    }

    /// <summary>A FOLDERED MEMBER CARRIES ITS FOLDER — the value a push needs to put it back where it was.</summary>
    [Fact]
    public void A_foldered_member_carries_its_folder()
        => Assert.Equal("Helpers", Assert.Single(Walk(Project()).Where(s => s.Name == "Inner")).Folder);

    /// <summary>AND NESTING COMPOSES. A member two folders deep gets the whole path, not the last segment.</summary>
    [Fact]
    public void A_nested_folder_path_composes()
        => Assert.Equal("Helpers/Deep", Assert.Single(Walk(Project()).Where(s => s.Name == "Buried")).Folder);

    /// <summary>A FOLDER IS DESCENDED INTO, NEVER YIELDED. It is not a member; yielding it would put it in the
    /// member reconciliation, where a push compares the pushed member set against this one — and a folder the
    /// source never declares is a member the push would DELETE.</summary>
    [Fact]
    public void A_folder_is_not_a_member()
    {
        var walked = Walk(Project());

        Assert.DoesNotContain(walked, s => s.Name is "Helpers" or "Deep");
        Assert.Equal(3, walked.Length);       // AtRoot, Inner, Buried — and nothing else
    }

    /// <summary>AN ACCESSOR IS NOT A MEMBER EITHER. A property's GET/SET are read WITH the property, so a walk
    /// that yielded them would reconcile them twice — and the second pass has no accessor in the pushed member
    /// set to match, so it deletes them.</summary>
    [Fact]
    public void An_accessor_is_not_a_member()
    {
        var ide = new FakeIde(
            new FakeIde.Item("FB_Host", ItemKind.PlcPouFb, "", true, "FUNCTION_BLOCK FB_Host", "", null, null,
                             Children: new[] { "Val" }),
            Node("Val", ItemKind.PlcProp, "Get", "Set"),
            Node("Get", ItemKind.PlcPropGet),
            Node("Set", ItemKind.PlcPropSet));

        var walked = MemberSites.Of(ide, new ItemRef("FB_Host")).ToArray();

        Assert.Equal("Val", Assert.Single(walked).Name);
    }

    /// <summary>AND NEITHER IS A TRANSITION. It is inlined in the POU and no reader models one, so it can never
    /// appear in a pushed member set — yielding it here would put it in the reconciliation, where the push would
    /// then delete a thing the engineer never touched.</summary>
    [Fact]
    public void A_transition_is_not_a_member()
    {
        var ide = new FakeIde(
            new FakeIde.Item("FB_Host", ItemKind.PlcPouFb, "", true, "FUNCTION_BLOCK FB_Host", "", null, null,
                             Children: new[] { "Step1", "Go" }),
            Node("Step1", ItemKind.PlcTrans),
            Node("Go", ItemKind.PlcMethod));

        Assert.Equal("Go", Assert.Single(MemberSites.Of(ide, new ItemRef("FB_Host"))).Name);
    }

    /// <summary>A FAULT PROPAGATES — the walk has no catch, deliberately, and that must stay true.
    ///
    /// <para>A swallowed fault here does not degrade gracefully, it MUTATES the project on the next push: the
    /// unreachable member comes back folder-less and gets duplicated at the POU root. A partial map is not a
    /// degraded answer, it is a wrong one. The isolation boundary is one level up, in `Versioning`, which
    /// catches per item and can say WHICH item — this level cannot, so it must not try.</para></summary>
    [Fact]
    public void A_tree_fault_propagates_rather_than_yielding_a_partial_map()
    {
        var ide = new FakeIde(
            new FakeIde.Item("FB_Host", ItemKind.PlcPouFb, "", true, "FUNCTION_BLOCK FB_Host", "", null, null,
                             Children: new[] { "AtRoot", "Helpers" }),
            Node("AtRoot", ItemKind.PlcMethod),
            Node("Helpers", ItemKind.PlcFolder, "Inner"),
            Node("Inner", ItemKind.PlcMethod))
        { FaultingNodes = new[] { "Helpers" } };

        Assert.ThrowsAny<Exception>(() => MemberSites.Of(ide, new ItemRef("FB_Host")).ToArray());
    }
}
