using System;
using System.Collections.Generic;
using System.Linq;
using Volt.Contracts;
using Volt.Engine.Format.Network;
using Parallel = Volt.Engine.Format.Network.Parallel;

namespace Volt.Ide.Twincat;

/// <summary>
/// What network text can say and TwinCAT has not been MEASURED to do — refused by name, never written by a guess.
/// Each refusal names the measurement that would lift it.
/// </summary>
internal static class TcUnmeasured
{
    /// <summary>The marker for a negation and an edge on one node (spec, "edges are R_EDGE and F_EDGE flags").</summary>
    public const string EdgeOrderMarker = "a negation with an edge";

    /// <summary>A node's flags state a negation AND an edge: the one combination whose evaluation ORDER is a vendor fact.
    /// CODESYS negates first (<c>R_EDGE(NOT x)</c>, DIALECT N17, run in simulation); TwinCAT's order is not measured —
    /// running a TwinCAT PLC needs a runtime licence the measuring machine does not have (task 1.14) — so the one
    /// object model (N1) is the only evidence the order is the same, which is not enough to write logic by.</summary>
    public static bool NegatedEdge(Flags? f) => f is { Negated: true } and ({ Rising: true } or { Falling: true });

    public static Volt.Engine.Format.Body.UnrepresentableBodyException EdgeOrderOnPull(string node) =>
        new(EdgeOrderMarker,
            $"TwinCAT: {node} carries a negation and an edge together, and the order TwinCAT evaluates the two in is not " +
            "measured (CODESYS negates first, DIALECT N17; no TwinCAT runtime was available to run it). Volt refuses to " +
            "materialize the body rather than spell it in an order nobody measured on this vendor.");

    /// <summary>The push side of the same fact: a body spelling <c>R_EDGE(NOT x)</c> (or <c>F_EDGE</c>) is refused before
    /// anything is written, naming the node.</summary>
    public static void RefuseEdgeOrder(NetworkBody body)
    {
        foreach (var network in body.Networks)
            foreach (var tree in network.Trees)
                if (FirstNegatedEdge(tree) is { } node)
                    throw new NotSupportedException(
                        $"TwinCAT: network {network.Order + 1} holds {EdgeOrderMarker} on {node} (`R_EDGE(NOT x)` / " +
                        "`F_EDGE(NOT x)`). That is the order CODESYS evaluates them in (DIALECT N17); TwinCAT's is not " +
                        "measured, so Volt will not write one to it. Draw it in the IDE if it is meant.");
    }

    private static string? FirstNegatedEdge(Node? n)
    {
        switch (n)
        {
            case Leaf l:
                return NegatedEdge(l.Flags) || NegatedEdge(l.Operand.Flags) ? $"'{l.Operand.Text}'" : null;
            case Box b:
                if (NegatedEdge(b.Flags)) return $"the '{b.Type}' box";
                return new[] { b.Enable }.Concat(b.Inputs.Select(p => p.Value)).Select(FirstNegatedEdge).FirstOrDefault(x => x != null);
            case Assign a:
                return FirstNegatedEdge(a.Value);
            case Demux d:
                return FirstNegatedEdge(d.Input);
            case Parallel p:
                return new[] { p.Input }.Concat(p.Branches).Select(FirstNegatedEdge).FirstOrDefault(x => x != null);
            default:
                return null;
        }
    }

    /// <summary>
    /// THE SHAPES NOBODY HAS PUT THROUGH TWINCAT'S PLCOPEN IMPORT (spec, "TwinCAT structural edits are refused where the
    /// import is unmeasured"; review 7.16). A network whose shape changed is rebuilt by that import, and a CREATE is
    /// one; a value edit is written in place and never meets it. Refused with <c>NETWORK_UNSUPPORTED</c>, naming the
    /// network and the shape, before the import is called:
    /// <list type="bullet">
    /// <item><c>PARALLEL</c> — PLCopen FBD has no element for a parallel branch (D30);</item>
    /// <item>a wire whose producer is a leaf — the importer CRASHED on one (the v1 <c>LiteralFanoutBugTests</c>) and D30
    /// found it collapses a wire it cannot see a branch point for; 1.16 would say how many rung edits this blocks;</item>
    /// <item>a box's result pin <c>=&gt; v</c> — the importer lowers an output pin to a separate assignment (C20).</item>
    /// </list>
    /// Task 4.4 measures each live; a shape measured to import cleanly leaves this list.
    /// </summary>
    public static void RefuseImport(Network network)
    {
        if (FirstUnmeasured(network.Trees) is { } shape)
            throw new NetworkTextException(
                $"TwinCAT: network {network.Order + 1} changes shape and holds {shape}. Volt rebuilds a changed network " +
                "through TwinCAT's PLCopen import, which is not measured for that shape, so the push is refused before " +
                "the import rather than risk a network that comes back different. Make this change in the IDE and pull it.",
                ConflictCodes.NetworkUnsupported);
    }

    private static string? FirstUnmeasured(IEnumerable<Node> trees) =>
        trees.Select(Unmeasured).FirstOrDefault(x => x != null);

    private static string? Unmeasured(Node? n)
    {
        switch (n)
        {
            case Parallel p:
                return "a `PARALLEL` branch";
            case Demux { Input: Leaf leaf } d:
                return $"the wire g{d.VarId} fed by the leaf '{leaf.Operand.Text}'";
            case Demux d:
                return Unmeasured(d.Input);
            case Box b when b.Outputs.FirstOrDefault(o => o.Formal is null) is { } pin:
                return $"the result pin `=> {pin.Value.Text}` of the '{b.Type}' box";
            case Box b:
                return new[] { b.Enable }.Concat(b.Inputs.Select(i => i.Value)).Select(Unmeasured).FirstOrDefault(x => x != null);
            case Assign a:
                return Unmeasured(a.Value);
            default:
                return null;
        }
    }
}

/// <summary>
/// The push half of "EN is a pin, ENO is spelled" on TwinCAT: the text reads a box through an output the box the IDE
/// holds does not give — <c>.ENO</c> on a box with no ENO output, or no suffix on a box whose main output is ENO. The
/// box's output list is read as CODESYS reads it (<see cref="Box.HasEnoSlot"/>). A <see cref="NotSupportedException"/>
/// so the in-place pass routes the network to the IDE to rebuild; its own type so the create path does not mistake
/// it, after the import, for a regrouping it may shrug at.
/// </summary>
internal sealed class TcEnoRefusal : NotSupportedException
{
    public TcEnoRefusal(string box, bool textReadsEno)
        : base(textReadsEno
            ? $"TwinCAT: the text reads `.ENO` on the '{box}' box, and the IDE builds that box with no ENO output — the " +
              "suffix names an output the box does not have. Remove `.ENO`, or make the change in the IDE and pull it."
            : $"TwinCAT: the text reads the '{box}' box without `.ENO`, and the IDE builds that box with ENO as its main " +
              "output — the text states a data output the box does not have. Write `.ENO`, or make the change in the " +
              "IDE and pull it.")
    { }
}
