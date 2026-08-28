using System.Linq;
using System.Xml.Linq;
using Volt.Engine.Item;
using Volt.Engine.Format.Body;

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

    /// <summary>The declaration the NAMED item owns, read through the production rule.
    ///
    /// <para>Replaces <c>PlcOpenDocument.DeclFromExport</c>, which took the first
    /// <c>&lt;InterfaceAsPlainText&gt;</c> in the whole subtree with NO child filter — a third answer to
    /// "is this declaration the item's own?", and the trap <c>MaterializerChildDeclTests</c> is named after: on a
    /// POU whose METHOD's declaration appears first in the document, it returned the method's.</para>
    ///
    /// <para>It was production-dead by the time it was removed, and this is what its test callers wanted all
    /// along — the same rule the reader and writer now share (<c>Declaration.OwnDeclContainers</c>).</para></summary>
    internal static string? OwnDeclaration(string xml, string itemName)
    {
        // Scoped to an ITEM element — a POU, a DUT (<dataType>), a GVL (<globalVars>) — never a member. That
        // half of DeclFromExport was right and is kept: one export describes several things, and a CHILD's name
        // is not an item, so asking for one answers null rather than handing back the child's declaration.
        // What is NOT kept is how it then picked the block: the first InterfaceAsPlainText in the whole subtree,
        // with no child filter. `Declaration.Read` applies the shared ownership rule instead.
        var owner = XDocument.Parse(xml).Descendants()
            .FirstOrDefault(e => PlcOpenDocument.IsItemElement(e) && (string?)e.Attribute("name") == itemName);
        return owner is null ? null : Declaration.Read(owner);
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
