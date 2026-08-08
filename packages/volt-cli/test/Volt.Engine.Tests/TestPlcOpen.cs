using System.Linq;
using System.Xml.Linq;
using Volt.Engine.Graphical;

namespace Volt.Cli.Tests;

/// <summary>
/// Test-only convenience for the fixture suites that read/round-trip "the graphical body in this export".
/// <para>
/// Production never needs this: every caller already knows WHICH item it asked for, because the wire is keyed by
/// item name, and passing that name is what stops a splice landing on a sibling method or action. These fixtures
/// are hand-picked documents with a single graphical body, and the tests care about the READER and WRITER, not
/// about scoping — so they resolve the owner's name here instead of restating it at each of ~20 call sites.
/// Scoping itself is pinned directly, on multi-body documents, in <c>GraphicalBodySpliceTests</c>.
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

    internal static XElement? FindOnlyGraphicalBody(string xml) =>
        GraphicalBodySplice.FindFbdLdBody(xml, GraphicalItemName(xml));

    internal static string SpliceOnlyGraphicalBody(string xml, XElement newBody) =>
        GraphicalBodySplice.SpliceFbdLdBody(xml, GraphicalItemName(xml), newBody);
}
