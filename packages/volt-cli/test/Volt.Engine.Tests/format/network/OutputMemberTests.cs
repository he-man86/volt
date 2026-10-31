using System;
using System.Collections.Generic;
using System.Linq;
using Volt.Engine.Format.Network;
using Xunit;

namespace Volt.Engine.Tests.Format.Network;

/// <summary>
/// openspec <c>network-output-member</c> 1.2 / 2a: the call is the box, and what its <c>EN :=</c>, <c>.ENO</c> and <c>.NAME</c>
/// read as is decided by the callee's declaration in the scope (<see cref="NetworkScope.Signature"/>). A callee no declaration
/// in reach states gives <c>EN :=</c>, <c>.ENO</c>, <c>ENO =&gt;</c>, <c>OUT =&gt;</c> and its type's call no meaning, and the reader
/// refuses them by name (network-text-one-to-one F9); the post-push comparison, which holds no project, then claims no
/// layout-equal body for them (byte-equal texts are still one). The case set holds the spellings
/// (<c>test/fixtures/network-text-st</c>); these are the push's refusals and the comparison.
/// </summary>
public class OutputMemberTests
{
    const string Text = "%LANGUAGE FBD\n%NETWORK\nok := w1(EN := TRUE, xOn := a).ENO;\n";

    static NetworkScope Scope(IReadOnlyDictionary<string, CalleeSignature>? signatures = null) =>
        new(new[] { "ok", "a", "q", "v" }, Array.Empty<string>(), new Dictionary<string, string> { ["w1"] = "WSM" }, signatures: signatures);

    static Volt.Engine.Format.Network.Network Read(string text, NetworkScope scope) => StNetworkReader.Read(text, scope).Networks[0];

    [Fact]
    public void An_unstated_callee_s_EN_is_refused_by_name_at_the_read()
    {
        var ex = Assert.Throws<StNetworkReadException>(() => Read(Text, Scope()));
        Assert.Contains("EN := on the call w1, whose callee no declaration in reach states", ex.Message);
    }

    /// <summary>The call of an FB type whose pins no declaration states: the unnamed-instance box or a function, which only a
    /// declaration says (F9). The LSP never meets it: every FB type in its reach is a declaration.</summary>
    [Fact]
    public void The_call_of_an_unstated_FB_type_is_refused_by_name_at_the_read()
    {
        var scope = new NetworkScope(new[] { "a" }, Array.Empty<string>(), new Dictionary<string, string>(), new[] { "Axis" });
        var ex = Assert.Throws<StNetworkReadException>(() => Read("%LANGUAGE FBD\n%NETWORK\nAxis(a);\n", scope));
        Assert.Contains("the call of the FB type Axis on the call Axis, whose callee no declaration in reach states", ex.Message);
    }

    [Fact]
    public void A_stated_callee_declaring_EN_and_ENO_reads_them_as_its_pins_and_is_built()
    {
        var scope = Scope(new Dictionary<string, CalleeSignature> { ["WSM"] = new(CalleeShape.Block, new[] { "EN", "xOn" }, new[] { "ENO", "xBusy" }) });
        var network = Read(Text, scope);
        var box = (Box)((Assign)network.Trees[0]).Value;
        Assert.Null(box.Enable);
        Assert.False(box.HasEnoOutput);
        Assert.Equal(("EN", "ENO"), (box.Inputs[0].Formal, box.MainOutputName));
        NetworkPairing.RefuseUnbuildableBoxes("CODESYS", network, scope);
    }

    /// <summary>The CLI's post-push check reads with the body's own declaration only (<c>PushedText.SameBody</c>): every
    /// callee is unstated there, so a body showing an unstated callee's EN reads in no scope and is claimed equal only
    /// byte for byte.</summary>
    [Fact]
    public void The_post_push_check_compares_an_unstated_callee_as_written()
    {
        var thin = NetworkScope.FromDeclarations("PROGRAM P\nVAR\n\tok : BOOL;\n\ta : BOOL;\n\tw1 : WSM;\nEND_VAR", _ => null,
            () => Array.Empty<string>(), kindOf: _ => null, isRefusedPouName: _ => false, libraryFunction: _ => null);
        Assert.Null(thin.Signature("WSM"));
        Assert.False(StNetworkGate.SameBody(Text, Text.Replace("w1(EN", "w1( EN"), thin));
    }

    /// <summary>A function read through a VAR_OUTPUT is spelled (<c>.Q</c>), and the push refuses it by name until its
    /// build is measured (1.2: the null-slot route is an FB's; 0 in the corpora).</summary>
    [Fact]
    public void A_function_read_through_a_VAR_OUTPUT_is_refused_by_name_at_a_push()
    {
        var scope = Scope(new Dictionary<string, CalleeSignature> { ["g"] = new(CalleeShape.Function, new[] { "IN" }, new[] { "Q" }) });
        var gate = StNetworkGate.Validate("%LANGUAGE FBD\n%NETWORK\nq := g(v).Q;\n", scope);
        Assert.True(gate.Ok, string.Join("\n", gate.Diagnostics.Select(d => d.Message)));
        var ex = Assert.Throws<NetworkTextException>(() => NetworkPairing.RefuseUnbuildableBoxes("TwinCAT", gate.Body!.Networks[0], scope));
        Assert.Contains("a function box read by a VAR_OUTPUT has no measured build", ex.Message);
        // …and its value, `.OUT`, is built.
        var value = StNetworkGate.Validate("%LANGUAGE FBD\n%NETWORK\nq := g(v).OUT;\n", scope);
        NetworkPairing.RefuseUnbuildableBoxes("TwinCAT", value.Body!.Networks[0], scope);
    }

    /// <summary>An IEC operator box other than the 14 keywords, MOVE and NOT (LIMIT, the conversions, …) declares its pins
    /// as an operator does — one value, no EN or ENO of its own — so an edited network showing its EN and ENO is built, as
    /// the LSP reads it (review 2a, finding 1).</summary>
    [Theory]
    [InlineData("LIMIT(EN := a, MN := 0, IN := v, MX := 100, OUT => q).ENO;")]
    [InlineData("ok := INT_TO_BOOL(EN := a, v).ENO;")]
    public void An_IEC_operator_box_states_its_pins_so_a_push_builds_it_with_EN_and_ENO(string line)
    {
        var scope = Scope();
        var network = Read("%LANGUAGE FBD\n%NETWORK\n" + line + "\n", scope);
        var box = (Box)(network.Trees[0] is Assign assign ? assign.Value : network.Trees[0]);
        Assert.NotNull(box.Enable);
        Assert.True(box.HasEnoOutput);
        Assert.NotNull(NetworkSpelling.SignatureOf(box, scope));
        NetworkPairing.RefuseUnbuildableBoxes("CODESYS", network, scope);
    }

    /// <summary>A program box read through a data output is spelled as a function's (review 2a, finding 3): through its one
    /// or first output it is built as before 2a; through a later one it has no measured build, as a function's, and the
    /// push refuses it by name.</summary>
    [Fact]
    public void A_program_box_read_by_a_data_output_is_spelled_and_its_moved_pin_refused_at_a_push()
    {
        var scope = Scope(new Dictionary<string, CalleeSignature> { ["p"] = new(CalleeShape.Program, new[] { "IN" }, new[] { "Q1", "Q2" }) });
        var first = StNetworkGate.Validate("%LANGUAGE FBD\n%NETWORK\nq := p(IN := v).Q1;\n", scope);
        Assert.True(first.Ok, string.Join("\n", first.Diagnostics.Select(d => d.Message)));
        NetworkPairing.RefuseUnbuildableBoxes("CODESYS", first.Body!.Networks[0], scope);
        var moved = StNetworkGate.Validate("%LANGUAGE FBD\n%NETWORK\nq := p(IN := v).Q2;\n", scope);
        Assert.True(moved.Ok, string.Join("\n", moved.Diagnostics.Select(d => d.Message)));
        var ex = Assert.Throws<NetworkTextException>(() => NetworkPairing.RefuseUnbuildableBoxes("CODESYS", moved.Body!.Networks[0], scope));
        Assert.Contains("has no measured build", ex.Message);
    }

    /// <summary>The writer refuses a model its text would read back as another box (review 2a, finding 7): with the callee
    /// unstated, a first pin named EN reads back as the shown EN, and a read through an output named ENO as the shown ENO.</summary>
    [Theory]
    [InlineData("ok := w1(EN := TRUE, xOn := a).xBusy;")]
    [InlineData("ok := w1(xOn := a).ENO;")]
    public void An_unstated_callee_s_own_EN_pin_or_ENO_output_is_unspellable(string line)
    {
        var stated = Scope(new Dictionary<string, CalleeSignature> { ["WSM"] = new(CalleeShape.Block, new[] { "EN", "xOn" }, new[] { "ENO", "xBusy" }) });
        var body = StNetworkReader.Read("%LANGUAGE FBD\n%NETWORK\n" + line + "\n", stated);
        Assert.Null(((Box)((Assign)body.Networks[0].Trees[0]).Value).Enable);
        Assert.Throws<StNetworkUnspellableException>(() => StNetworkWriter.Write(body, Scope()));
    }
}
