using System;
using Volt.Engine.Model;

namespace Volt.Engine.Source.Body.Network;

/// <summary>
/// The graphical code path, in pure Core: the language gate + every transform between a vendor's
/// PLCopen XML and editable network text. The vendor supplies only transport (<see cref="ICodeStore"/>); this
/// class owns the decisions. The READ gate lives in <c>Materializer.BodyTextOf</c> (it calls
/// <see cref="RenderBody"/> for FBD/LD and builds the `@volt-graphical` marker for CFC/SFC itself);
/// this class owns <see cref="RenderBody"/> and <see cref="Validate"/>. On the
/// write leg declaration AND body travel through the same in-memory PLCopen, so the import never
/// touches the object-model aspect (which a just-reimported graphical POU poisons). Failures throw;
/// nothing is ever silently downgraded.
/// </summary>
public static class NetworkCode
{
    /// <summary>Render an FBD/LD body element to canonical network text. The shared single-source-of-truth used by
    /// both <see cref="Read"/> (old COM path) and <see cref="Materializer.BuildPouFromXml"/> (new XML path),
    /// guaranteeing identical output for the same body element regardless of which path produced it.</summary>
    public static string RenderBody(System.Xml.Linq.XElement bodyElement)
    {
        var graph = GraphReader.ReadBody(bodyElement);
        return NetworkTextWriter.Write(graph);
    }

    /// <summary>Validate a network-text body WITHOUT touching the IDE — the language gate, the parser, and the strict
    /// round-trip gate, all pure/format-only. Returns the parsed graph. Call
    /// this BEFORE creating a new item so a REFUSED push never leaves an orphaned stub in the project (the
    /// create-then-write order otherwise materialises a POU before the body is checked). Throws on invalid network text.</summary>
    public static GraphBody Validate(string networkText)
    {
        // Format guard: only FBD/LD can be authored as network text. An unknown language token on the NETWORK marker is
        // refused with a clear message — not downstream with a misleading "not writable". Bridge owns FORMAT.
        var lang = NetworkText.LanguageOf(networkText);
        if (!NetworkText.IsEditable(lang))
            throw new InvalidOperationException($"unknown graphical language '{lang ?? "?"}' (expected FBD or LD).");

        var graph = NetworkTextReader.Parse(networkText);                                  // throws on structurally-invalid network text

        // Leaf-fan-out guard. TwinCAT represents a variable READ as one inVariable box per consumer; a single
        // leaf wired to two blocks has NO valid FBD shape and CRASHES TC's importer ("Index was outside the
        // bounds of the array"). A BLOCK output CAN fan out — that's a legitimate branch (g1 feeding g2 and g3).
        // So refuse a LEAF referenced more than once and tell the author to give each read its own leaf. This
        // is caught here, BEFORE the writer, because the network text-text round-trip gate alone misses it (a literal leaf
        // re-emits identically, so it would otherwise slip through and crash the IDE).
        var refCount = new Dictionary<long, int>();
        foreach (var n in graph.Networks.SelectMany(x => x.Nodes))
            foreach (var c in Sources(n))
                if (c is not null) refCount[c.RefLocalId] = refCount.TryGetValue(c.RefLocalId, out var k) ? k + 1 : 1;
        foreach (var iv in graph.Networks.SelectMany(x => x.Nodes).OfType<InVar>())
            if (refCount.TryGetValue(iv.LocalId, out var uses) && uses > 1)
                throw new NetworkTextException(
                    $"the leaf '{iv.Expression}' is read {uses} times in one network — a variable feeding "
                    + "several consumers needs its OWN leaf for each read (TwinCAT draws one inVariable box per read; "
                    + "a shared one crashes its importer). Give each read a separate leaf statement.",
                    "NETWORK_LEAF_FANOUT");

        // The network text-text round-trip gate (the network text ⇄ graph leg): the parser is the exact inverse of the writer,
        // so a body that doesn't RE-EMIT identically isn't canonical — it would drift on the next pull, or
        // silently rename/alias temps. Refuse it HERE and show the canonical form so the author can paste it.
        var canonical = NetworkTextWriter.Write(graph);
        if (Canon(canonical) != Canon(networkText))
            throw new NetworkTextException(
                "graphical body is not in canonical form — it would not round-trip identically (you'd see drift on "
                + "the next pull). Use this exact body:\n\n" + canonical.TrimEnd('\n'),
                "NETWORK_NOT_CANONICAL") { Line = FirstDiffLine(Canon(networkText), Canon(canonical)) };

        // The PLCopen convergence gate (the graph ⇄ PLCopen ⇄ IDE leg, the one that actually touches the
        // IDE). The body must reach a FIXED POINT through our OWN GraphWriter→GraphReader, so the closed loop
        // push → pull → push STABILISES rather than oscillating into a malformed shape. We do NOT demand the
        // input already BE the fixed point — LD legitimately canonicalises in one step (e.g. a negated contact
        // `i1 := NOT a` ⇄ the operand form `(NOT i1 …)`); we require only that it converges. A body that keeps
        // changing every pull is an unstable shape the IDE can't store cleanly → refuse. (resolveType is null:
        // NetworkTextWriter ignores FB instance types — see the FBD/LD fixed-point tests.)
        var afterOnePass = GraphRoundTrip.Once(graph);                   // ONE PLCopen pass, shared by both sides
        var once = NetworkTextWriter.Write(afterOnePass);
        var twice = GraphRoundTrip.ToNetworkText(afterOnePass);
        if (Canon(once) != Canon(twice))
            throw new NetworkTextException(
                "graphical body does not converge through the PLCopen round-trip — it keeps changing on every "
                + "pull, which means an unstable shape the IDE would not store cleanly.",
                "NETWORK_PLCOPEN_DRIFT") { Line = FirstDiffLine(Canon(once), Canon(twice)) };
        return graph;
    }

    /// <summary>Every wire SOURCE a node consumes (its input connections), for the leaf-fan-out guard.</summary>
    private static IEnumerable<Conn?> Sources(GraphNode n) => n switch
    {
        Block b => b.Inputs.Select(p => p.Source),
        OutVar o => new[] { o.Source },
        Jump j => new[] { j.Condition },
        Return r => new[] { r.Condition },
        _ => Enumerable.Empty<Conn?>(),
    };

    // Normalize for the round-trip comparison: LF endings, no trailing whitespace, no trailing blank lines.
    private static string Canon(string s)
    {
        var lines = s.Replace("\r", "").Split('\n');
        for (int i = 0; i < lines.Length; i++) lines[i] = lines[i].TrimEnd();
        return string.Join("\n", lines).TrimEnd('\n');
    }

    // 1-based index of the first line that differs (for the NETWORK_NOT_CANONICAL diagnostic), or null.
    private static int? FirstDiffLine(string a, string b)
    {
        var la = a.Split('\n'); var lb = b.Split('\n');
        for (int i = 0; i < Math.Max(la.Length, lb.Length); i++)
            if (i >= la.Length || i >= lb.Length || la[i] != lb[i]) return i + 1;
        return null;
    }

}
