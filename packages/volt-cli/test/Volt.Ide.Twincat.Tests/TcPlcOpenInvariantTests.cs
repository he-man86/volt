using System;
using Volt.Engine.Format.Network;
using Xunit;

namespace Volt.Ide.Twincat.Tests;

/// <summary>
/// A MODEL THE READER NEVER BUILDS IS A VOLT BUG, NOT "CANNOT EXPRESS AS PLCOPEN" (openspec <c>bridge-refusal-review</c>
/// 2.33, V.1).
///
/// <para>The PLCopen lowering refused every shape it met through one helper, worded "this graphical body …, which Volt
/// cannot express as PLCopen. The IDE can create it." — a vendor limit, UNSUPPORTED. For the shapes the network-text
/// reader cannot produce at all (an assignment from a statement, a wire referenced before its definition, a statement where
/// a value is wired, a node type with no arm), that sent the engineer to the IDE for a body their text never held. They
/// are model invariants now: an <c>InvalidOperationException</c>, which the push reports as INTERNAL_ERROR, saying what
/// the model lacks. The real vendor limits beside them (an Execute box, a jump with several destinations, a single-
/// consumer branch) keep their UNSUPPORTED.</para>
/// </summary>
public class TcPlcOpenInvariantTests
{
    private static NetworkBody One(params Node[] trees) =>
        new(BodyLanguage.Fbd, new[] { new Network(0, null, null, null, false, trees) });

    private static Leaf Var(string name) => new(new Operand(name), Flags.None);

    private static Box And(params Node[] inputs) =>
        new("AND", null, CallKind.Operator, Array.ConvertAll(inputs, n => new Input(null, n, Flags.None)),
            Array.Empty<Output>(), null, null, Flags.None);

    private static Assign Coil(Node value, string target) => new(value, new[] { new Operand(target) }, Flags.None);

    [Fact]
    public void A_wire_referenced_before_its_definition_is_an_invariant()
    {
        var ex = Assert.Throws<InvalidOperationException>(() =>
            TcPlcOpenWriter.WriteProject("P", One(Coil(And(new Demux(7, null), Var("a")), "out"))));
        Assert.Contains("wire 7 before its definition", ex.Message);
        Assert.Contains("Volt bug", ex.Message);
    }

    /// <summary>AN ASSIGNMENT BELOW THE TOP LEVEL IS NO LONGER A MODEL THE READER NEVER BUILDS: network text spells it
    /// (S2, openspec ld-fbd-coverage 2.3, <c>(b := a)</c>), so a push of one meets TwinCAT's import, which is not measured
    /// for it — refused by name, UNSUPPORTED (<c>TcUnmeasured</c>), before the lowering. These were the lowering's
    /// "statement where a value goes" invariants while no text could say it.</summary>
    private static void UnmeasuredNested(params Node[] trees)
    {
        var ex = Assert.Throws<NetworkTextException>(() => TcPlcOpenWriter.WriteProject("P", One(trees)));
        Assert.Equal(Volt.Contracts.ConflictCodes.NetworkUnsupported, ex.Code);
        Assert.Contains("an assignment to 'b' below the top level", ex.Message);
    }

    [Fact]
    public void A_statement_wired_where_a_value_goes_is_refused_by_name() =>
        UnmeasuredNested(Coil(And(Coil(Var("a"), "b"), Var("c")), "out"));

    /// <summary>A node kind the model has and the lowering does not — the switch's default arm.</summary>
    private sealed record Alien() : Node(Flags.None)
    {
        public override System.Collections.Generic.IEnumerable<Node> Children() => Array.Empty<Node>();
    }

    private static InvalidOperationException InvariantOf(params Node[] trees)
    {
        var ex = Assert.Throws<InvalidOperationException>(() => TcPlcOpenWriter.WriteProject("P", One(trees)));
        Assert.Contains("network model invariant", ex.Message);
        Assert.Contains("Volt bug", ex.Message);
        return ex;
    }

    // Every other Invariant site (review 2e+2g, low: only two of ten had a test, so moving one back to Refuse —
    // UNSUPPORTED, "the IDE can create it" — stayed green). The Parallel arm is the one left out: TcUnmeasured.RefuseImport
    // refuses a Parallel by name before any lowering, so WriteProject cannot reach it (the arm says so). The "assignment with
    // no value" arm is deleted: `Assign.Value` is never null in the model, and the walks before the lowering fault on one first.

    [Fact]
    public void An_assignment_from_a_statement_is_refused_by_name() => UnmeasuredNested(Coil(Coil(Var("a"), "b"), "out"));

    [Fact]
    public void A_RETURN_conditioned_on_a_statement_is_refused_by_name() =>
        UnmeasuredNested(new Assign(Coil(Var("a"), "b"), Array.Empty<Operand>(), Flags.None with { Return = true }));

    [Fact]
    public void A_jump_conditioned_on_a_statement_is_refused_by_name() =>
        UnmeasuredNested(new Assign(Coil(Var("a"), "b"), new[] { new Operand("Done") }, Flags.None with { Jump = true }));

    [Fact]
    public void A_wire_defined_from_a_statement_is_refused_by_name() =>
        UnmeasuredNested(Coil(new Demux(1, Coil(Var("a"), "b")), "x"), Coil(And(new Demux(1, null), Var("c")), "y"),
                         Coil(And(new Demux(1, null), Var("d")), "z"));

    [Fact]
    public void A_call_kind_with_no_PLCopen_call_type_is_an_invariant()
    {
        var odd = new Box("AND", null, (CallKind)99, new[] { new Input(null, Var("a"), Flags.None), new Input(null, Var("b"), Flags.None) },
                          Array.Empty<Output>(), null, null, Flags.None);
        Assert.Contains("call kind 99", InvariantOf(Coil(odd, "out")).Message);
    }

    [Fact]
    public void A_node_type_the_lowering_has_no_arm_for_is_an_invariant() =>
        Assert.Contains("a Alien node", InvariantOf(Coil(new Alien(), "out")).Message);

    /// <summary>The vendor limit beside them keeps its word: an Execute box is UNSUPPORTED, sent to the IDE.</summary>
    [Fact]
    public void An_Execute_box_is_still_the_vendor_limit()
    {
        var execute = new Box("", null, CallKind.Operator, Array.Empty<Input>(), Array.Empty<Output>(), null,
                              "out := a;", Flags.None);
        var ex = Assert.Throws<NotSupportedException>(() => TcPlcOpenWriter.WriteProject("P", One(execute)));
        Assert.Contains("Execute box", ex.Message);
        // What Volt's lowering lacks, not a claim about PLCopen (V.1): "cannot express as PLCopen" read as a format limit.
        Assert.Contains("Volt's TwinCAT lowering has no spelling for it", ex.Message);
        Assert.DoesNotContain("as PLCopen", ex.Message);
    }
}
