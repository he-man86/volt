using Xunit;
using Volt.Contracts;
using Volt.Engine.Format.Task;
using Volt.Engine.Sync;

namespace Volt.Engine.Tests;

/// <summary>
/// THE POST-PUSH COMPARISON READS AN ITEM BY THE PUSH'S OWN FORMAT DISPATCH (<see cref="PushedText"/>): a task by its
/// descriptor format, anything else by the ST reader AT ITS WIRE KIND. A second copy of that dispatch in the CLI is
/// what once handed a `.task` to the ST reader after the IDE had applied the push.
/// </summary>
public class PushedTextTests
{
    [Fact]
    public void A_task_is_compared_as_a_descriptor()
    {
        var canonical = TaskDescriptorFormat.Write(new TaskSettings("cyclic", "t#10ms", "", "1", null, null, new[] { "PLC_PRG" }));
        Assert.True(PushedText.SameExceptLayout("MainTask.task", canonical.TrimEnd('\n') + "   \n", canonical));
    }

    /// <summary>A graphical body laid out otherwise is the same item; a changed token is not.</summary>
    [Theory]
    [InlineData("  out := ( a AND\n    b );", true)]
    [InlineData("  out := (a OR b);", false)]
    public void A_graphical_body_is_compared_by_its_tokens(string statement, bool same)
    {
        static string Prg(string s) =>
            "PROGRAM P\nVAR\n  a, b, out : BOOL;\nEND_VAR\n(* @volt-implementation FBD *)\nNETWORK\n" + s + "\nEND_NETWORK\nEND_PROGRAM\n";
        Assert.Equal(same, PushedText.SameExceptLayout("P.prg", Prg("  out := (a AND b);"), Prg(statement)));
    }

    /// <summary>The extension is the kind wherever a wire name exists (the ST reader's contract): a text whose header
    /// says otherwise is refused as the push refuses it, never compared as another kind.</summary>
    [Fact]
    public void An_item_is_read_at_its_wire_kind()
    {
        const string prg = "PROGRAM P\nVAR\nEND_VAR\n(* @volt-implementation *)\nx := 1;\nEND_PROGRAM\n";
        var e = Assert.Throws<BridgeException>(() => PushedText.SameExceptLayout("P.fb", prg, prg));
        Assert.Equal(BridgeErrorCodes.InvalidSt, e.ErrorCode);
    }
}
