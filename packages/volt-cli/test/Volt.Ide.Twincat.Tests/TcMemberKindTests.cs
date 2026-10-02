using Volt.Contracts;
using Volt.Engine;
using Volt.Engine.Ide;
using Volt.Engine.Item;
using Xunit;

namespace Volt.Ide.Twincat.Tests;

/// <summary>
/// A MEMBER'S KIND IS ITS TREE CODE, AND A CODE WITH NO KIND IS REFUSED BY NAME (openspec <c>push-without-header-check</c>
/// 5.Q.5 / 5.Q.7). <c>ReadMember</c> read <c>ItemKind.Map(code) ?? Method</c>, so any member TwinCAT reports under a code
/// Volt does not know became a "method" — read, versioned and pushed back as one. It is <c>UNSUPPORTED</c> now, naming the
/// member and its code, as <c>CodesysDriver.MemberKind</c> and <c>ItemKind.MemberCode</c> already were. No test pinned it.
/// </summary>
public class TcMemberKindTests
{
    [Fact]
    public void A_member_whose_tree_code_names_no_kind_is_refused_by_name()
    {
        var node = new TcHiddenBodyWriteTests.Node("Mystery", 9999, "METHOD Mystery : BOOL", "");
        var site = new MemberSites.Site(null, new ItemRef(node), "Mystery", 9999);

        var ex = Assert.Throws<BridgeException>(() => TcUntouchablePouTests.BoundDriver().ReadMember(site, "FUNCTION_BLOCK K"));

        Assert.Equal(BridgeErrorCodes.Unsupported, ex.ErrorCode);
        Assert.Contains("member 'Mystery' has tree item type 9999", ex.Message);
        Assert.Contains("refusing to treat it as a method", ex.Message);
    }
}
