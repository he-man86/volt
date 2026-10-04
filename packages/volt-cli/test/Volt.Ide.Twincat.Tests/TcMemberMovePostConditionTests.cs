using Volt.Contracts;
using Volt.Engine;
using Xunit;

namespace Volt.Ide.Twincat.Tests;

/// <summary>
/// A MEMBER MOVE THAT DID NOT LAND IS IDE_LOST_ITEM — A BROKEN POST-CONDITION, NOT UNSUPPORTED (openspec
/// <c>bridge-refusal-review</c> 2.35, V.1). The move rewrote the POU's archive and re-imported it, so a member that is not
/// where its <c>FolderPath</c> now says is the IDE not holding what Volt just wrote — 7.2's situation, the code every
/// other post-condition answers — never a request TwinCAT cannot honour. (It was INTERNAL_ERROR between 2.35 and V.1.) It had no test
/// (review 2e+2g, low): the move needs a project walk no double has, so the check is its own function.
/// </summary>
public class TcMemberMovePostConditionTests
{
    /// <summary>Drive the real private check. A reimplementation here would test itself.</summary>
    private static void Landed(string folder, bool atPouRoot)
    {
        var m = typeof(BeckhoffDriver).GetMethod("RequireMemberLanded",
            System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Static);
        Assert.NotNull(m);
        try { m!.Invoke(null, new object[] { "Run", "FB_A", folder, atPouRoot }); }
        catch (System.Reflection.TargetInvocationException tie) { throw tie.InnerException!; }
    }

    [Theory]
    [InlineData("Sub", true)]     // asked for a folder, still at the root
    [InlineData("", false)]       // asked for the root, not there
    public void A_placement_that_did_not_land_is_IDE_LOST_ITEM(string folder, bool atPouRoot)
    {
        var ex = Assert.Throws<BridgeException>(() => Landed(folder, atPouRoot));
        Assert.Equal(BridgeErrorCodes.IdeLostItem, ex.ErrorCode);
        Assert.Contains("did not land", ex.Message);
        Assert.DoesNotContain("Volt bug", ex.Message);
        Assert.Contains("'Run'", ex.Message);
    }

    [Theory]
    [InlineData("Sub", false)]
    [InlineData("", true)]
    public void A_placement_that_landed_passes(string folder, bool atPouRoot) =>
        Landed(folder, atPouRoot);
}
