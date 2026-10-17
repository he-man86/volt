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
    /// <summary>An archive about to be written back whose values carry a raw CR is refused (<see cref="TcRawLineEndRefusal"/>).</summary>
    public static void RefuseRawLineEnd(string handed)
    {
        if (TcArchive.HoldsRawLineEnd(handed)) throw new TcRawLineEndRefusal();
    }

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
    /// <item>a box's result pin <c>=&gt; v</c> — the importer lowers an output pin to a separate assignment (C20);</item>
    /// <item>a negated box input pin (S6), an assignment below the top level (S2) and a <c>SUPER^</c> call (S5) —
    /// ld-fbd-coverage 2.3 spells all three, and no import of any is measured (the vendor-facts rows
    /// <c>nwl-input-pin-flag</c>, <c>nwl-nested-assign</c>, <c>nwl-super-call</c>).</item>
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

    private static string? FirstUnmeasured(IReadOnlyList<Node> trees) =>
        trees.Select(t => Unmeasured(t, top: true)).FirstOrDefault(x => x != null) ?? SplitBeforeDefinition(trees);

    /// <summary>2R.5 (awkward-sweep #19): a split referenced above its definition — the stored order a pull keeps, which the
    /// PLCopen lowering cannot state (it emits a wire's definition before its references).</summary>
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

    /// <summary>The coil shapes 2R.5 spells that nobody has put through TwinCAT's PLCopen import: an edge or a negation on a
    /// coil (#13, #14), and a jump or a return beside another coil, set, or modified (#9–#12) — the lowering emits one
    /// `jump`/`return` per item and an `outVariable` per coil, with no modifier. The in-place writer refuses the same
    /// shapes where an edit would make one (<see cref="InPlace"/>): no TwinCAT edit of any is measured either.</summary>
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

    /// <summary>The in-place half of <see cref="RefuseImport"/>: an edit that would WRITE one of its shapes into the archive
    /// the IDE holds. A <see cref="NotSupportedException"/>, so the push routes the network to the import, which refuses
    /// the shape by name before the IDE is asked; a shape the IDE already holds, unchanged, is never refused.</summary>
    internal static NotSupportedException InPlace(string shape) =>
        new($"TwinCAT: this push writes {shape} into the body the IDE holds, and no TwinCAT edit of that shape is measured " +
            "(stored, built, reopened), so Volt writes none by a guess. The IDE can make this change.");

    private static string? Unmeasured(Node n, bool top = false) => n switch
    {
        Assign a when !top => $"an assignment to '{a.Targets.FirstOrDefault()?.Text}' below the top level",
        Assign a when UnmeasuredCoil(a) is { } coil => coil,
        Demux { Input: not null } d when !top => $"the split split{d.VarId} defined below the top level",
        Terminator { Flags.IsNone: false } => "a negated empty slot",
        Box b when !b.EnableFlags.IsNone => $"a modifier on the EN pin of the '{b.Type}' box",
        Parallel => "a parallel branch (`feed BRANCH (a, b)`)",
        Demux { Input: Leaf leaf } d => $"the split split{d.VarId} fed by the leaf '{leaf.Operand.Text}'",
        Box b when b.Outputs.FirstOrDefault(o => o.Formal is null) is { } pin =>
            $"the result pin `=> {pin.Value.Text}` of the '{b.Type}' box",
        Box b when string.Equals(b.Instance?.Text, Volt.Engine.Format.St.StDeclaration.SuperCall, StringComparison.OrdinalIgnoreCase) =>
            $"a call of the base FB through SUPER^ (the '{b.Type}' box)",
        Box b when b.Inputs.Select((p, i) => (p, i)).FirstOrDefault(x => !x.p.Flags.IsNone) is { p: not null } flagged =>
            $"{(flagged.p.Flags.Rising || flagged.p.Flags.Falling ? "an edge on an input pin" : "a negated input pin")} ({flagged.p.Formal ?? $"input {flagged.i}"}) of the '{b.Type}' box",

        _ => n.Children().Select(c => Unmeasured(c)).FirstOrDefault(x => x != null),
    };
}

/// <summary>
/// The push half of "EN is a pin, ENO is spelled" on TwinCAT: the text reads a box through an output the box the IDE
/// holds does not give — <c>ENO</c> on a box with no ENO output, or its data on a box whose main output is ENO. The
/// box's output list is read as CODESYS reads it (<see cref="Box.HasEnoSlot"/>). A <see cref="NotSupportedException"/>
/// so the in-place pass routes the network to the IDE to rebuild; its own type so the create path does not mistake
/// it, after the import, for a regrouping it may shrug at.
/// </summary>
internal sealed class TcEnoRefusal : NotSupportedException
{
    public TcEnoRefusal(string box, bool textReadsEno)
        : base(textReadsEno
            ? $"TwinCAT: the text reads the '{box}' box through ENO (an open line a later ENO takes, B4), and the IDE " +
              "builds that box with no ENO output — ENO names an output the box does not have. Read as a value, the text " +
              "matches the box the IDE builds."
            : $"TwinCAT: the text reads the '{box}' box as a value, and the IDE builds that box with ENO as its main " +
              "output — the text states a data output the box does not have. Written as an open line and read through " +
              "ENO (B4), the text matches the box the IDE builds.")
    { }
}

/// <summary>
/// AN ARCHIVE WHOSE VALUES CARRY A RAW CARRIAGE RETURN IS NOT WRITTEN (gate 2R.3, review finding 2). Whether the XAE hands
/// a CR in a value (a network comment's CR LF) as <c>&amp;#xD;</c> or raw is not measured. Entitized, the parse keeps it and
/// <see cref="TcArchive.Text"/> writes it back as it came. Raw, the parse folds the CR LF into LF and the write would hand
/// every untouched value back as a bare LF — a change in the IDE the next pull hides (it reads LF as the IDE's CR LF,
/// <see cref="TcNetworkReader.Comment"/>). So it is refused by name, never written by a guess; the measurement that
/// lifts it is the archive string the bridge receives for a two-line comment (<c>comments.test.ts</c> on TwinCAT pushes
/// over one). Its own type so the create's stamp does not take it for a regrouping it may shrug at.
/// </summary>
internal sealed class TcRawLineEndRefusal : NotSupportedException
{
    public TcRawLineEndRefusal()
        : base("TwinCAT: the IDE handed this body's archive with a raw carriage return in a value (a multi-line comment " +
               "or title), and whether that line end is the IDE's CR LF or its LF is not measured — rewriting the body " +
               "would change every untouched one of them. Volt refuses the write rather than guess; edit the body in " +
               "the IDE.")
    { }
}
