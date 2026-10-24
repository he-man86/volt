using System;
using System.Collections.Generic;
using System.Linq;
using Volt.Contracts;
using Volt.Engine.Format.Network;
using Volt.Engine;

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
    /// CODESYS negates first (<c>R_EDGE NOT x</c>, DIALECT N17, run in simulation); TwinCAT's order is not measured —
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

    /// <summary>The push side of the same fact: a body spelling <c>R_EDGE NOT x</c> (or <c>F_EDGE</c>) is refused before
    /// anything is written, naming the node.</summary>
    public static void RefuseEdgeOrder(NetworkBody body)
    {
        foreach (var network in body.Networks)
            foreach (var tree in network.Trees)
                if (FirstNegatedEdge(tree) is { } node)
                    throw new UnsupportedException(
                        $"TwinCAT: network {network.Order + 1} holds {EdgeOrderMarker} on {node} (`R_EDGE NOT x` / " +
                        "`F_EDGE NOT x`). That is the order CODESYS evaluates them in (DIALECT N17); TwinCAT's is not " +
                        "measured, so Volt will not write one to it. Draw it in the IDE if it is meant.");
    }

    private static string? FirstNegatedEdge(Node n) => n switch
    {
        Leaf l => NegatedEdge(l.Flags) || NegatedEdge(l.Operand.Flags) ? $"'{l.Operand.Text}'" : null,
        Box b when NegatedEdge(b.Flags) => $"the '{b.Type}' box",
        _ => n.Children().Select(FirstNegatedEdge).FirstOrDefault(x => x != null),
    };

    /// <summary>
    /// THE SHAPES NO TWINCAT BUILD HAS MEASURED (ld-fbd-coverage 2R.5 spells them; CODESYS stores, builds and runs each,
    /// DIALECT N41). The native builder would write each from the model, but none has been stored, reloaded, built and
    /// pulled back on TwinCAT, so a network that would be BUILT holding one is refused with <c>NETWORK_UNSUPPORTED</c>,
    /// naming the network and the shape, before anything is written. A value edit that leaves the shape alone is written in
    /// place and never meets this; one that would write such a shape into the archive is <see cref="InPlace"/>. A shape
    /// leaves this list only when a live TwinCAT push measures it (<c>test/e2e/graphical/stored-shapes.test.ts</c>).
    /// </summary>
    public static void RefuseUnbuilt(Network network)
    {
        if (FirstUnmeasured(network.Trees) is { } shape)
            throw new NetworkTextException(
                $"TwinCAT: network {network.Order + 1} is built and holds {shape}, which no TwinCAT build has been " +
                "measured for (stored, reloaded, built and pulled back), so Volt does not write it by a guess. The IDE " +
                "can make this change.",
                ConflictCodes.NetworkUnsupported);
    }

    private static string? FirstUnmeasured(IReadOnlyList<Node> trees) =>
        trees.Select(t => Unmeasured(t, top: true)).FirstOrDefault(x => x != null) ?? SplitBeforeDefinition(trees);

    /// <summary>2R.5 (awkward-sweep #19): a split referenced above its definition.</summary>
    private static string? SplitBeforeDefinition(IReadOnlyList<Node> trees)
    {
        var defined = new HashSet<int>();
        string? Walk(Node n)
        {
            if (n is Demux { Input: null } r && !defined.Contains(r.VarId)) return $"the split split{r.VarId} referenced above its definition";
            foreach (var c in n.Children()) if (Walk(c) is { } hit) return hit;
            if (n is Demux { Input: not null } d) defined.Add(d.VarId);
            return null;
        }
        return trees.Select(Walk).FirstOrDefault(x => x != null);
    }

    /// <summary>The coil shapes 2R.5 spells that no TwinCAT build has measured: an edge or a negation on a coil (#13, #14),
    /// and a jump or a return beside another coil, set, or modified (#9–#12). The in-place writer refuses the same shapes
    /// where an edit would make one (<see cref="InPlace"/>).</summary>
    internal static string? UnmeasuredCoil(Assign a)
    {
        if (a.Targets.Count > 1 && (a.Flags.Jump || a.Flags.Return || a.Targets.Any(t => t.Flags is { Jump: true } or { Return: true })))
            return "a jump or a return beside another coil on one rung";
        foreach (var t in a.Targets)
        {
            var f = t.Flags ?? Flags.None;
            var on = f.Jump ? $"the jump to '{t.Text}'" : f.Return || a.Flags.Return && a.Targets.Count == 1 ? "RETURN" : $"'{t.Text}'";
            if (f.Rising || f.Falling) return $"an edge coil on {on}";
            if (f.Negated && !f.Reset) return $"a negated coil on {on}";
            if ((f.Jump || f.Return || a.Flags.Jump || a.Flags.Return) && (f.Set || f.Reset)) return "a jump or a return with S= or R=";
        }
        return null;
    }

    /// <summary>The in-place half of <see cref="RefuseUnbuilt"/>: an edit that would WRITE one of its shapes into the
    /// archive the IDE holds. An <see cref="UnsupportedException"/> (a <see cref="NotSupportedException"/>), so the push routes the network to the builder, which
    /// refuses the shape by name before anything is written; a shape the IDE already holds, unchanged, is never refused.</summary>
    internal static UnsupportedException InPlace(string shape) =>
        new($"TwinCAT: this push writes {shape} into the body the IDE holds, and no TwinCAT edit of that shape is measured " +
            "(stored, built, reopened), so Volt writes none by a guess. The IDE can make this change.");

    private static string? Unmeasured(Node n, bool top = false) => n switch
    {
        Assign a when UnmeasuredCoil(a) is { } coil => coil,
        Demux { Input: not null } d when !top => $"the split split{d.VarId} defined below the top level",
        Terminator { Flags.IsNone: false } => "a negated empty slot",
        Box b when !b.EnableFlags.IsNone => $"a modifier on the EN pin of the '{b.Type}' box",
        _ => n.Children().Select(c => Unmeasured(c)).FirstOrDefault(x => x != null),
    };
}

/// <summary>
/// The push half of "EN is a pin, ENO is spelled" on TwinCAT: the text reads a box through an output the box the IDE
/// holds does not give — <c>ENO</c> on a box with no ENO output, or its data on a box whose main output is ENO. The
/// box's output list is read as CODESYS reads it (<see cref="Box.HasEnoSlot"/>). An <see cref="UnsupportedException"/>
/// (a <see cref="NotSupportedException"/>) so the in-place pass routes the network to a rebuild, which builds the box the
/// text states; reaching the push, it answers UNSUPPORTED by its own code.
/// </summary>
internal sealed class TcEnoRefusal : UnsupportedException
{
    public TcEnoRefusal(string box, bool textReadsEno)
        : base(textReadsEno
            ? $"TwinCAT: the text reads the '{box}' box through ENO (`… ENO EN c`), and the IDE builds that box with " +
              "no ENO output — ENO names an output the box does not have. Without `ENO` shown, the text matches the box " +
              "the IDE builds."
            : $"TwinCAT: the text reads the '{box}' box as a value, and the IDE builds that box with ENO as its main " +
              "output — the text states a data output the box does not have. With `ENO` shown (`… ENO EN c`), the text " +
              "matches the box the IDE builds.")
    { }
}
