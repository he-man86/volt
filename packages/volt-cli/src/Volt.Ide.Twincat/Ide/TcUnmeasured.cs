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
    /// running a TwinCAT PLC needs a runtime licence the measuring machine does not have (task 1.14; re-checked for
    /// bridge-refusal-review 3.8: the user-mode runtime is installed, unlicensed, and the trial licence takes a CAPTCHA a probe
    /// may not type — DIALECT N17) — so the one
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

    private static string? FirstNegatedEdge(Node n) => n switch
    {
        Leaf l => NegatedEdge(l.Flags) || NegatedEdge(l.Operand.Flags) ? $"'{l.Operand.Text}'" : null,
        Box b when NegatedEdge(b.Flags) => $"the '{b.Type}' box",
        _ => n.Children().Select(FirstNegatedEdge).FirstOrDefault(x => x != null),
    };

    /// <summary>
    /// THE SHAPES NOBODY HAS PUT THROUGH TWINCAT'S PLCOPEN IMPORT (spec, "TwinCAT structural edits are refused where the
    /// import is unmeasured"; review 7.16). A network whose shape changed is rebuilt by that import, and a CREATE is
    /// one; a value edit is written in place and never meets it. Refused with <c>NETWORK_UNSUPPORTED</c>, naming the
    /// network and the shape, before the import is called:
    /// <list type="bullet">
    /// <item><c>PARALLEL</c> — PLCopen FBD has no element for a parallel branch (D30);</item>
    /// <item>a wire whose producer is a leaf — the v1 lowering CRASHED the importer on one (<c>LiteralFanoutBugTests</c>).
    /// Measured through the v2 lowering (2026-09-27, the refusal lifted for one live push, DIALECT N22): no crash, but
    /// no round trip either — a leaf wire read by two coils comes back as ONE chained assign (C25's fold), and one read
    /// inside a box comes back a wire under an importer-minted VarId (<c>g1883419948</c>). A refusal costs a detour; a
    /// reshape costs a drawing, so it stays refused. 1.16 would say how many rung edits this blocks;</item>
    /// <item>a box's result pin <c>=&gt; v</c> — the importer lowers an output pin to a separate assignment (C20).</item>
    /// </list>
    /// A shape leaves this list only when a live import measures it round-tripping; task 4.4 measured the leaf wire
    /// (N22) and it stays, the other two are not yet measured.
    /// </summary>
    public static void RefuseImport(Network network)
    {
        if (FirstUnmeasured(network.Trees) is { } shape)
            throw new NetworkTextException(
                $"TwinCAT: network {network.Order + 1} changes shape and holds {shape}. Volt rebuilds a changed network " +
                "through TwinCAT's PLCopen import, which is not measured for that shape, so the push is refused before " +
                "the import rather than risk a network that comes back different. The IDE can make this change.",
                ConflictCodes.NetworkUnsupported);
    }

    private static string? FirstUnmeasured(IEnumerable<Node> trees) =>
        trees.Select(Unmeasured).FirstOrDefault(x => x != null);

    private static string? Unmeasured(Node n) => n switch
    {
        Parallel => "a `PARALLEL` branch",
        Demux { Input: Leaf leaf } d => $"the wire g{d.VarId} fed by the leaf '{leaf.Operand.Text}'",
        Box b when b.Outputs.FirstOrDefault(o => o.Formal is null) is { } pin =>
            $"the result pin `=> {pin.Value.Text}` of the '{b.Type}' box",
        _ => n.Children().Select(Unmeasured).FirstOrDefault(x => x != null),
    };
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
              "suffix names an output the box does not have. Without `.ENO` the text matches the box the IDE builds."
            : $"TwinCAT: the text reads the '{box}' box without `.ENO`, and the IDE builds that box with ENO as its main " +
              "output — the text states a data output the box does not have. With `.ENO` the text matches the box the " +
              "IDE builds.")
    { }
}
