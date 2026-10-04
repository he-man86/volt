using Volt.Contracts;
using Volt.Engine;
using Volt.Engine.Ide;
using Volt.Engine.Item;
using Xunit;

namespace Volt.Ide.Twincat.Tests;

/// <summary>
/// A MEMBER'S KIND IS DECIDED BY ITS CODE AND ITS OWNER, AND A CODE WITH NO KIND IS REFUSED BY NAME (openspec
/// <c>push-without-header-check</c> 5.Q.5 / 5.Q.7, <c>bridge-refusal-review</c> D20). <c>ReadMember</c> read
/// <c>ItemKind.Map(code) ?? Method</c>, so any member TwinCAT reports under a code Volt does not know became a "method" —
/// read, versioned and pushed back as one. It asks <c>ItemKind.MemberKind</c> now, the one map CODESYS asks too: a code
/// with no kind is <c>UNSUPPORTED</c>, naming the member and its code, and the OWNER decides method vs interface method.
/// </summary>
public class TcMemberKindTests
{
    [Fact]
    public void A_member_whose_tree_code_names_no_kind_is_refused_by_name()
    {
        var node = new TcHiddenBodyWriteTests.Node("Mystery", 9999, "METHOD Mystery : BOOL", "");
        var site = new MemberSites.Site(null, new ItemRef(node), "Mystery", 9999);

        var ex = Assert.Throws<BridgeException>(() =>
            TcUntouchablePouTests.BoundDriver().ReadMember(site, ownerIsInterface: false, "FUNCTION_BLOCK K"));

        Assert.Equal(BridgeErrorCodes.Unsupported, ex.ErrorCode);
        // The phrase is the shared rule's (ItemKind.MemberKind), pinned exactly: one map, one message on both vendors.
        // No "TwinCAT:" prefix — the rule is vendor-neutral, and the bridge that answered names the vendor (its pipe).
        Assert.Contains("member 'Mystery' has item type 9999, a member Volt has no kind for", ex.Message);
        Assert.Contains("refusing to treat it as a method", ex.Message);
    }

    /// <summary>THE OWNER DECIDES, as on CODESYS: a method under an INTERFACE is an interface method whatever code the
    /// member carries, and under a function block it is a method. One IEC fact, one rule, both vendors.</summary>
    [Theory]
    [InlineData(ItemKind.PlcMethod, true, ItemKind.Kinds.InterfaceMethod)]
    [InlineData(ItemKind.PlcItfMeth, false, ItemKind.Kinds.Method)]
    [InlineData(ItemKind.PlcMethod, false, ItemKind.Kinds.Method)]
    [InlineData(ItemKind.PlcItfMeth, true, ItemKind.Kinds.InterfaceMethod)]
    public void A_members_kind_is_decided_by_its_owner(int code, bool ownerIsInterface, string expected)
    {
        var node = new TcHiddenBodyWriteTests.Node("Run", code, "METHOD Run : BOOL", "");
        var site = new MemberSites.Site(null, new ItemRef(node), "Run", code);

        var member = TcUntouchablePouTests.BoundDriver().ReadMember(site, ownerIsInterface, "FUNCTION_BLOCK K");

        Assert.Equal(expected, member.Kind);
    }
}
