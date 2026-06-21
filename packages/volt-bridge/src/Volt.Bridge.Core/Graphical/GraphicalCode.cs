using System;
using Volt.Bridge.Core.Graphical.Vg;
using Volt.Bridge.Core.Ide;

namespace Volt.Bridge.Core.Graphical;

/// <summary>A graphical (FBD/LD/CFC/SFC) body rendered to text. <paramref name="Language"/> is
/// FBD/LD/CFC/SFC; <paramref name="Body"/> is editable VG for FBD/LD, empty for read-only CFC/SFC;
/// <paramref name="Declaration"/> is the POU's real declaration (from the same export when the vendor
/// carries the plaintext interface, else the textual aspect — never empty/guessed).</summary>
public sealed record GraphicalBody(string Language, string Body, string Declaration);

/// <summary>
/// The graphical code path, in pure Core: the language gate + every transform between a vendor's
/// PLCopen XML and editable VG. The vendor supplies only transport (<see cref="ICodeStore"/>); this
/// class owns the decisions. Read and write are symmetric — declaration AND body travel through the
/// same in-memory PLCopen, so the import never touches the object-model aspect (which a just-reimported
/// graphical POU poisons). Failures throw; nothing is ever silently downgraded.
/// </summary>
public static class GraphicalCode
{
    /// <summary>Read a POU's graphical body, or null if it is textual (ST/IL). FBD/LD → editable VG;
    /// CFC/SFC → a read-only marker (empty body). A body the gate calls graphical but the export can't
    /// yield as FBD/LD is a loud failure, never a silent marker.</summary>
    public static GraphicalBody? Read(ICodeStore code, ItemRef item)
    {
        var lang = code.BodyLanguage(item);
        if (lang is null) return null;                       // textual → use the textual transport

        var xml = code.ReadXml(item);                        // graphical → the PLCopen transport (throws on failure)
        var decl = DeclarationFrom(code, item, xml);

        if (lang is "CFC" or "SFC")                          // not transpiled yet → read-only marker, real decl
            return new GraphicalBody(lang, "", decl);

        var fbd = PlcOpenDocument.FindFbdLdBody(xml)
            ?? throw new InvalidOperationException(
                $"graphical body language is {lang} but the PLCopen export has no FBD/LD body element");
        var body = PlcOpenReader.ReadBody(fbd) with { Language = lang };
        return new GraphicalBody(lang, VgWriter.Write(body), decl);
    }

    /// <summary>Write an editable VG body back through the PLCopen transport: splice the new FBD/LD body
    /// into the item's current export and re-import. FB instance types (absent from VG) come from
    /// <paramref name="declaration"/>. The POU's declaration is NOT written — it is preserved from the
    /// export's typed <c>&lt;interface&gt;</c>: CODESYS regenerates the interface from that typed block on
    /// import (ignoring the plaintext copy), and TwinCAT's export carries no plaintext interface at all,
    /// so a graphical POU's VAR-section is edited in the IDE, not via push. Throws on invalid VG.</summary>
    /// <summary>Validate a VG body WITHOUT touching the IDE — the language gate, the parser, and the strict
    /// round-trip gate, all pure/format-only. Returns the parsed graph (reused by <see cref="Write"/>). Call
    /// this BEFORE creating a new item so a REFUSED push never leaves an orphaned stub in the project (the
    /// create-then-write order otherwise materialises a POU before the body is checked). Throws on invalid VG.</summary>
    public static GraphBody Validate(string vgText)
    {
        // Format guard: only FBD/LD can be authored as VG. An unknown language token on the NETWORK marker is
        // refused with a clear message — not downstream with a misleading "not writable". Bridge owns FORMAT.
        var lang = VgBody.LanguageOf(vgText);
        if (!VgBody.IsEditable(lang))
            throw new InvalidOperationException($"unknown graphical language '{lang ?? "?"}' (expected FBD or LD).");

        var graph = VgParser.Parse(vgText);                                  // throws on structurally-invalid VG

        // Leaf-fan-out guard. TwinCAT represents a variable READ as one inVariable box per consumer; a single
        // leaf wired to two blocks has NO valid FBD shape and CRASHES TC's importer ("Index was outside the
        // bounds of the array"). A BLOCK output CAN fan out — that's a legitimate branch (g1 feeding g2 and g3).
        // So refuse a LEAF referenced more than once and tell the author to give each read its own leaf. This
        // is caught here, BEFORE the writer, because the VG-text round-trip gate alone misses it (a literal leaf
        // re-emits identically, so it would otherwise slip through and crash the IDE).
        var refCount = new System.Collections.Generic.Dictionary<long, int>();
        foreach (var n in graph.Networks.SelectMany(x => x.Nodes))
            foreach (var c in Sources(n))
                if (c is not null) refCount[c.RefLocalId] = refCount.TryGetValue(c.RefLocalId, out var k) ? k + 1 : 1;
        foreach (var iv in graph.Networks.SelectMany(x => x.Nodes).OfType<InVar>())
            if (refCount.TryGetValue(iv.LocalId, out var uses) && uses > 1)
                throw new VgParseException(
                    $"the leaf '{iv.Expression}' is read by {uses} blocks in one network — a variable feeding "
                    + "several blocks needs its OWN leaf for each read (TwinCAT draws one inVariable box per read; "
                    + "a shared one crashes its importer). Give each read a separate leaf statement.",
                    "VG_LEAF_FANOUT");

        // Invariant 4 — VG-text round-trip (the VG ⇄ graph leg): the parser is the exact inverse of the writer,
        // so a body that doesn't RE-EMIT identically isn't canonical — it would drift on the next pull, or
        // silently rename/alias temps. Refuse it HERE and show the canonical form so the author can paste it.
        var canonical = VgWriter.Write(graph);
        if (Canon(canonical) != Canon(vgText))
            throw new VgParseException(
                "graphical body is not in canonical form — it would not round-trip identically (you'd see drift on "
                + "the next pull). Use this exact body:\n\n" + canonical.TrimEnd('\n'),
                "VG_NOT_CANONICAL") { Line = FirstDiffLine(Canon(vgText), Canon(canonical)) };

        // Invariant 5 — PLCopen convergence (the graph ⇄ PLCopen ⇄ IDE leg, the one that actually touches the
        // IDE). The body must reach a FIXED POINT through our OWN PlcOpenWriter→PlcOpenReader, so the closed loop
        // push → pull → push STABILISES rather than oscillating into a malformed shape. We do NOT demand the
        // input already BE the fixed point — LD legitimately canonicalises in one step (e.g. a negated contact
        // `i1 := NOT a` ⇄ the operand form `(NOT i1 …)`); we require only that it converges. A body that keeps
        // changing every pull is an unstable shape the IDE can't store cleanly → refuse. (resolveType is null:
        // VgWriter ignores FB instance types — see the FBD/LD fixed-point tests.)
        var once = GraphicalRoundTrip.ToVg(graph);
        var twice = GraphicalRoundTrip.ToVg(GraphicalRoundTrip.Once(graph));
        if (Canon(once) != Canon(twice))
            throw new VgParseException(
                "graphical body does not converge through the PLCopen round-trip — it keeps changing on every "
                + "pull, which means an unstable shape the IDE would not store cleanly.",
                "VG_PLCOPEN_DRIFT") { Line = FirstDiffLine(Canon(once), Canon(twice)) };
        return graph;
    }

    /// <summary>Every wire SOURCE a node consumes (its input connections), for the leaf-fan-out guard.</summary>
    private static System.Collections.Generic.IEnumerable<Conn?> Sources(GraphNode n) => n switch
    {
        Block b => b.Inputs.Select(p => p.Source),
        OutVar o => new[] { o.Source },
        Jump j => new[] { j.Condition },
        Return r => new[] { r.Condition },
        _ => System.Linq.Enumerable.Empty<Conn?>(),
    };

    public static void Write(ICodeStore code, ItemRef item, string vgText, string declaration)
    {
        var graph = Validate(vgText);                                        // pure checks first (no IDE write yet)
        var types = PlcOpenDocument.InstanceTypes(declaration);
        var newBody = PlcOpenWriter.WriteBody(graph, inst => types.TryGetValue(inst, out var t) ? t : null);

        var exported = code.ReadXml(item);                                   // current full POU PLCopen
        var spliced = PlcOpenDocument.SpliceFbdLdBody(exported, newBody);    // throws if no FBD/LD body
        code.WriteXml(item, spliced);                                        // import (vendor restores on failure)
    }

    // Normalize for the round-trip comparison: LF endings, no trailing whitespace, no trailing blank lines.
    private static string Canon(string s)
    {
        var lines = s.Replace("\r", "").Split('\n');
        for (int i = 0; i < lines.Length; i++) lines[i] = lines[i].TrimEnd();
        return string.Join("\n", lines).TrimEnd('\n');
    }

    // 1-based index of the first line that differs (for the VG_NOT_CANONICAL diagnostic), or null.
    private static int? FirstDiffLine(string a, string b)
    {
        var la = a.Split('\n'); var lb = b.Split('\n');
        for (int i = 0; i < System.Math.Max(la.Length, lb.Length); i++)
            if (i >= la.Length || i >= lb.Length || la[i] != lb[i]) return i + 1;
        return null;
    }

    /// <summary>A graphical POU's declaration: from the export's plaintext interface when the vendor
    /// includes it (CODESYS — avoids the poisoning aspect), else from the textual aspect (TwinCAT —
    /// its export omits it, and it has no reimport poison). A structural property of the export, not an
    /// error path; either way the result is the POU's real declaration.</summary>
    private static string DeclarationFrom(ICodeStore code, ItemRef item, string xml)
    {
        var fromXml = PlcOpenDocument.DeclFromExport(xml);
        return fromXml is not null ? fromXml : code.ReadDeclaration(item);
    }
}
