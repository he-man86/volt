using Volt.Contracts;
using Volt.Engine;
using Xunit;

namespace Volt.Ide.Twincat.Tests;

/// <summary>
/// A MEMBER MOVE THAT DID NOT LAND IS A VOLT BUG — INTERNAL_ERROR, NOT UNSUPPORTED (openspec <c>bridge-refusal-review</c>
/// 2.35). The post-condition is Volt's own: the move rewrote the POU's archive and re-imported it, so a member that is not
/// where its <c>FolderPath</c> now says is Volt's round trip failing, never a request TwinCAT cannot honour. It had no test
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
    public void A_placement_that_did_not_land_is_an_internal_error(string folder, bool atPouRoot)
    {
        var ex = Assert.Throws<BridgeException>(() => Landed(folder, atPouRoot));
        Assert.Equal(BridgeErrorCodes.InternalError, ex.ErrorCode);
        Assert.Contains("Volt bug", ex.Message);
        Assert.Contains("'Run'", ex.Message);
    }

    [Theory]
    [InlineData("Sub", false)]
    [InlineData("", true)]
    public void A_placement_that_landed_passes(string folder, bool atPouRoot) =>
        Landed(folder, atPouRoot);
}
