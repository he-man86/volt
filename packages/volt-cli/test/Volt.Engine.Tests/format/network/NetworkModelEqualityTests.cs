using System.Collections.Generic;
using Xunit;
using Volt.Engine.Format.Network;
using Parallel = Volt.Engine.Format.Network.Parallel;

namespace Volt.Engine.Tests;

/// <summary>
/// The structural model comparer the network text v2 oracle stands on (<c>Read(Write(m)) ≅ m</c>). Record
/// <c>==</c> compares the model's lists by reference, so two bodies built independently are never equal by it —
/// which is why the comparer exists, and why its first test pins that premise.
/// </summary>
public class NetworkModelEqualityTests
{
    // Built fresh on every call: equal content, distinct list instances.
    static NetworkBody Body(
        Flags? pinFlags = null, ParallelMode mode = ParallelMode.BoxShortCircuit, int? mainOutput = 0,
        int? outSlot = 1, string? outType = "INT") =>
        new(BodyLanguage.Ld, new List<Network>
        {
            new(0, "t", null, "c", false, new List<Node>
            {
                new Assign(
                    new Box("MOVE", null, CallKind.Operator,
                        new List<Input> { new(null, new Leaf(new Operand("src"), Flags.None), pinFlags ?? Flags.None) },
                        new List<Output> { new(null, new Operand("dst"), outSlot) },
                        new Leaf(new Operand("c"), Flags.None), null, Flags.None,
                        MainOutputIndex: mainOutput, ConnectedSlot: 0,
                        OutputTypes: new List<string?> { "BOOL", outType }),
                    new List<Operand> { new("lamp", IsLValue: true) }, Flags.None),
                new Terminator(
                    new Parallel(new Demux(3, null, Flags.None),
                        new List<Node> { new Leaf(new Operand("a"), Flags.None), new Leaf(new Operand("b"), Flags.None) },
                        Flags.None, mode),
                    Flags.None),
            }),
        });

    [Fact]
    public void Record_equality_is_not_structural_which_is_why_the_comparer_exists()
    {
        Assert.NotEqual(Body(), Body());
        Assert.True(NetworkModelEquality.Equal(Body(), Body()));
        Assert.Null(NetworkModelEquality.FirstDifference(Body(), Body()));
    }

    [Fact]
    public void A_dropped_pin_flag_is_a_difference_and_names_the_pin()
    {
        var d = NetworkModelEquality.FirstDifference(Body(pinFlags: Flags.None with { Negated = true }), Body());
        Assert.NotNull(d);
        Assert.StartsWith("Networks[0].Trees[0].Value.Inputs[0].Flags: Flags { Negated = True,", d);
    }

    [Fact]
    public void Each_v2_fact_is_compared()
    {
        Assert.StartsWith("Networks[0].Trees[1].Input.Mode:",
            NetworkModelEquality.FirstDifference(Body(mode: ParallelMode.Sequential), Body()));
        Assert.StartsWith("Networks[0].Trees[0].Value.MainOutputIndex:",
            NetworkModelEquality.FirstDifference(Body(mainOutput: null), Body()));
        Assert.StartsWith("Networks[0].Trees[0].Value.Outputs[0]:",
            NetworkModelEquality.FirstDifference(Body(outSlot: null), Body()));
        Assert.StartsWith("Networks[0].Trees[0].Value.OutputTypes[1]:",
            NetworkModelEquality.FirstDifference(Body(outType: null), Body()));
    }
}
