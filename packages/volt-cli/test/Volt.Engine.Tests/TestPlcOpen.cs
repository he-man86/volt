using System.Linq;
using System.Xml.Linq;
using Volt.Engine.Document;

namespace Volt.Cli.Tests;

/// <summary>
/// Test-only convenience for the fixture suites that read/round-trip "the graphical body in this export".
/// <para>
/// Production never needs this: every caller already knows WHICH item it asked for, because the wire is keyed by
/// item name, and passing that name is what stops a splice landing on a sibling method or action. These fixtures
/// are hand-picked documents with a single graphical body, and the tests care about the READER and WRITER, not
/// about scoping — so they resolve the owner's name here instead of restating it at each of ~20 call sites.
/// Scoping itself is pinned directly, on multi-body documents, in <c>BodySpliceGuardTests</c>.
/// </para>
/// </summary>
internal static class TestPlcOpen
{
    /// <summary>The name of the item owning the first graphical body, or "" when the export has none (which
    /// makes the lookups below return null — what the no-graphical-body assertions expect).</summary>
    internal static string GraphicalItemName(string xml)
    {
        var body = XDocument.Parse(xml).Descendants()
            .FirstOrDefault(e => e.Name.LocalName is "FBD" or "LD" or "CFC" or "SFC")
            ?.Parent;                                        // <body>
        return (string?)body?.Parent?.Attribute("name") ?? "";
    }

    /// <summary>The one <c>&lt;FBD&gt;</c>/<c>&lt;LD&gt;</c> element in a single-body fixture, or null.</summary>
    internal static XElement? FindOnlyGraphicalBody(string xml) =>
        XDocument.Parse(xml).Descendants().FirstOrDefault(e => e.Name.LocalName is "FBD" or "LD");

    /// <summary>Replace that element with <paramref name="newBody"/>, running the production capability gate
    /// first — several suites rely on this refusing exactly what a real push would refuse.
    ///
    /// <para>This used to call <c>GraphSplice.SpliceFbdLdBody</c>, a ~97-line SECOND graphical write path in
    /// <c>src/</c> that no production code called. The suites here needed "replace this element", which is four
    /// lines; they did not need a parallel implementation shipped in the engine. The gate
    /// (<see cref="BodySpliceGuard.RequireReplaceable"/>) is the part that was always real, and it stays in
    /// production because <c>BodyCodec</c> calls it.</para></summary>
    internal static string SpliceOnlyGraphicalBody(string xml, XElement newBody)
    {
        var doc = XDocument.Parse(xml);
        var existing = doc.Descendants().FirstOrDefault(e => e.Name.LocalName is "FBD" or "LD")
            ?? throw new System.InvalidOperationException("fixture has no FBD/LD body to splice");
        BodySpliceGuard.RequireReplaceable(existing);
        existing.ReplaceWith(newBody);
        return PlcOpenDocument.Serialize(doc);
    }
}
