using System;
using System.Linq;

namespace Volt.Engine.Format.Network;

/// <summary>
/// The pre-write gate for a graphical body: the language check and the canonical-form check, both PURE —
/// no IDE, no vendor, no document. Replaces <c>NetworkCode.Validate</c>, and is deliberately smaller than it.
///
/// <para><b>Two of that gate's three checks are gone because the transport no longer needs them:</b></para>
/// <list type="bullet">
/// <item><b>The PLCopen convergence gate</b> required a body to reach a FIXED POINT through
/// <c>GraphWriter → GraphReader</c>, so that push → pull → push stabilised instead of oscillating. It existed
/// because the body was REGENERATED from a projection on every write. Nothing is regenerated now — CODESYS
/// mutates the live objects and TwinCAT rewrites only the networks that changed — so there is no loop to
/// converge.</item>
/// <item><b>The leaf fan-out refusal</b> rejected a leaf read more than once in a network, because TwinCAT's
/// importer crashed on a shared leaf ("Index was outside the bounds of the array"). It was expressible only in
/// a graph: a tree cannot share a node, so the shape is now UNREPRESENTABLE rather than refused. This is the
/// clearest single case of the model change removing a class of bug instead of guarding it.</item>
/// </list>
///
/// <para>What remains is genuinely about the FORMAT, and is the reason a push can still be refused before the
/// IDE is touched at all.</para>
/// </summary>
public static class NetworkTextGate
{
    /// <summary>Validate a network-text body and return the parsed model. Throws
    /// <see cref="NetworkTextException"/> on anything outside the strict form.</summary>
    public static NetworkBody Validate(string networkText)
    {
        // Only FBD/LD can be authored as network text. An unknown language token on the NETWORK marker is
        // refused HERE with a clear message, rather than downstream as a misleading "not writable".
        var lang = NetworkText.LanguageOf(networkText);
        if (!NetworkText.IsEditable(lang))
            throw new NetworkTextException($"unknown graphical language '{lang ?? "?"}' (expected FBD or LD).");

        var body = NetworkTextReader.Parse(networkText);   // throws on structurally-invalid network text

        // The canonical-form gate: the parser is the exact inverse of the writer, so a body that does not
        // RE-EMIT identically is not canonical — it would drift on the next pull, or silently rename a wire.
        // Refuse it here and show the canonical form so the author can paste it.
        var canonical = NetworkTextWriter.Write(body);
        if (Canon(canonical) != Canon(networkText))
            throw new NetworkTextException(
                "graphical body is not in canonical form — it would not round-trip identically (you'd see drift "
                + "on the next pull). Use this exact body:\n\n" + canonical.TrimEnd('\n'),
                "NETWORK_NOT_CANONICAL")
            { Line = FirstDiffLine(Canon(networkText), Canon(canonical)) };

        return body;
    }

    /// <summary>LF endings, no trailing whitespace, no trailing blank lines.</summary>
    private static string Canon(string s)
    {
        var lines = s.Replace("\r", "").Split('\n');
        for (int i = 0; i < lines.Length; i++) lines[i] = lines[i].TrimEnd();
        return string.Join("\n", lines).TrimEnd('\n');
    }

    /// <summary>1-based index of the first differing line, for the NETWORK_NOT_CANONICAL diagnostic.</summary>
    private static int? FirstDiffLine(string a, string b)
    {
        var la = a.Split('\n');
        var lb = b.Split('\n');
        for (int i = 0; i < Math.Max(la.Length, lb.Length); i++)
            if (i >= la.Length || i >= lb.Length || la[i] != lb[i]) return i + 1;
        return null;
    }
}
