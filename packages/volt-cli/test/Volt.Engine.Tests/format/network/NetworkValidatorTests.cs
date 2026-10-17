using System;
using System.Collections.Generic;
using Volt.Engine.Format.Network;
using Xunit;
using static Volt.Engine.Tests.NetworkModels;

namespace Volt.Engine.Tests;

/// <summary>
/// The shared validator's refusals that no text can reach (openspec <c>ld-fbd-coverage</c> 2R.6b, review of the gate): a
/// vendor reader's model holds them, the text reader never builds them. Each is the line between a pull that shows the
/// network as its <c>UNSUPPORTED</c> line and one that writes text which reads back as another network. The LSP's port
/// checks the text-reachable subset only, so these have no parity case there.
/// </summary>
public class NetworkValidatorTests
{
    static string? Reason(params Node[] trees) => NetworkValidator.Check(Net(trees))?.Reason;

    static Box FbX(IEnumerable<Output> outputs, bool eno, int? connected = null, string? name = null) =>
        Call("FB_X", Array.Empty<Input>(), outputs, connected: connected, instance: new Operand("fb", IsInstance: true),
            kind: CallKind.FunctionBlock, eno: eno, name: name);

    [Fact]
    public void An_EXECUTE_box_read_by_its_value_is_refused() =>
        Assert.Equal("an EXECUTE box read by its value", Reason(Set(Exec("x := 1;", connected: 1), T("o"))));

    [Fact]
    public void A_top_level_box_with_a_connection_slot_is_refused() =>
        Assert.Equal("a top-level box with a connection slot", Reason(Call("f", new[] { In(L("a")) }, connected: 0)));

    [Fact]
    public void An_assign_with_no_target_is_refused() =>
        Assert.Equal("an assign with no target", Reason(new Assign(L("a"), Array.Empty<Operand>(), Flags.None)));

    [Fact]
    public void A_coil_flag_on_a_value_is_refused() =>
        Assert.Equal("a coil flag on a value", Reason(Set(L("a", SetBit), T("o"))));

    [Fact]
    public void An_operand_whose_flags_disagree_with_its_item_is_refused() =>
        Assert.Equal("an operand whose flags disagree with its item",
            Reason(Set(new Leaf(new Operand("a", Flags: Neg), Flags.None), T("o"))));

    [Fact]
    public void A_flag_on_an_empty_item_is_refused() =>
        Assert.Equal("a flag on an empty item", Reason(new Terminator(Neg)));

    [Fact]
    public void A_split_with_a_negative_VarId_is_refused() =>
        Assert.Equal("a split with a negative VarId", Reason(Set(Def(-1, L("a")), T("o")), Set(Ref(-1), T("p"))));

    /// <summary>An FB's stored ENO with no EN is shown only where a consumer reads it with nothing after the box. At the top
    /// level, or read by <c>.name</c>, the text has no position for it, so a positional output after it would read back
    /// one slot lower — onto the ENO's slot. Refused; with named outputs only, the ENO alone is what a rebuild loses.</summary>
    [Fact]
    public void A_positional_output_after_an_FB_ENO_the_text_cannot_show_is_refused()
    {
        const string reason = "a positional output after an FB's unshown ENO";
        Assert.Equal(reason, Reason(FbX(new[] { Out("v", 1) }, eno: true)));
        Assert.Equal(reason, Reason(Set(FbX(new[] { Out("v", 2) }, eno: true, connected: 1, name: "Q"), T("x"))));
        // Shown: read with nothing after the box, its ENO is slot 0 on both sides.
        Assert.Null(Reason(Set(FbX(new[] { Out("v", 1) }, eno: true, connected: 0), T("x"))));
        // Named outputs carry no slot to shift.
        Assert.Null(Reason(FbX(new[] { Out("v", null, "Q") }, eno: true)));
        Assert.Null(Reason(FbX(new[] { Out("v", 0) }, eno: false)));
    }
}
