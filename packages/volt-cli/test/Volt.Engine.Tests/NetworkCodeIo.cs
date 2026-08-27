using System;
using Volt.Engine.Document;
using Volt.Engine.Graph;
using System.Linq;
using System.Xml.Linq;
using Volt.Engine.Ide;
using Volt.Engine.Model;
using Volt.Engine.Vocabulary;

namespace Volt.Cli.Tests;

/// <summary>A graphical (FBD/LD/CFC/SFC) body rendered to text. <paramref name="Language"/> is
/// FBD/LD/CFC/SFC; <paramref name="Body"/> is editable network text for FBD/LD, empty for read-only CFC/SFC;
/// <paramref name="Declaration"/> is the POU's real declaration (from the same export when the vendor
/// carries the plaintext interface, else the textual aspect — never empty/guessed).</summary>
public sealed record GraphicalBody(string Language, string Body, string Declaration);

/// <summary>The WHOLE read pipeline — <c>BodyLanguage</c> → <c>ReadXml</c> → declaration → network text —
/// driven against a fake code store, with no live IDE.
///
/// <para><b>This lives in the TEST project because it is a test seam, and it always was.</b> Its own doc-comment
/// said so ("A TEST SEAM, kept deliberately") while the file sat in <c>src/Volt.Engine/Sync/</c>: measured, it had
/// ZERO production callers — the only reference from <c>src</c> was a <c>&lt;see cref&gt;</c>. Production reads
/// through <c>Materializer.BodyTextOf</c>, which calls <c>NetworkCode.RenderBody</c> and builds the
/// <c>@volt-graphical</c> marker itself.</para>
///
/// <para>Its own note said that if it ever moved, the 13 cases hanging off it must keep their coverage. They do:
/// this is the same code, byte for byte apart from the two lookups it used to borrow from a production shim that
/// no longer exists. Nothing it asserts has changed; only where it ships has.</para>
///
/// <para>It was also the sole caller of <c>PlcOpenDocument.DeclFromExport</c>, which is therefore now reached only
/// from tests too. That one is NOT resolved here — it is a third answer to "is this declaration the item's own?",
/// and it dies when that rule is unified (openspec `splice-graphical-body` §7.5/7.6), not before.</para></summary>
public static class NetworkCodeIo
{
    /// <summary>Read a POU's graphical body, or null if it is textual (ST/IL). FBD/LD → editable network text;
    /// CFC/SFC → an empty body. A body the gate calls graphical but the export can't yield as FBD/LD is a
    /// loud failure, never silent.
    /// <para><b>A TEST SEAM, kept deliberately.</b> Production does not run it — the Materializer reads through
    /// <see cref="RenderBody"/> and builds the `@volt-graphical` marker itself (<c>Materializer.BodyTextOf</c>).
    /// It survives because it is the only entry point that exercises the WHOLE read pipeline
    /// (<c>BodyLanguage</c> → <c>ReadXml</c> → declaration → network text) against a fake code store, with no live IDE:
    /// 13 cases in <c>NetworkCodeTests</c> hang off it, including the cross-package
    /// <c>Graphical_body_marker_matches_the_lsp_hover_shape</c> contract and the zero-fallback assertions that a
    /// failure propagates rather than degrading to an empty body. Deleting it would delete that coverage, not
    /// dead weight — so if it ever goes, those tests move onto the production path FIRST.</para></summary>
    public static GraphicalBody? Read(ICodeStore code, ItemRef item, string itemName)
    {
        var lang = code.BodyLanguage(item);
        if (lang is null) return null;                       // textual → use the textual transport

        var xml = code.ReadXml(item);                        // graphical → the PLCopen transport (throws on failure)
        var decl = DeclarationFrom(code, item, itemName, xml);

        if (Languages.IsDiagram(lang))                          // CFC/SFC: no network-text round-trip → empty body, real decl
            return new GraphicalBody(lang, "", decl);

        var fbd = NamedGraphicalBody(xml, itemName)
            ?? throw new InvalidOperationException(
                $"graphical body language is {lang} but the PLCopen export has no FBD/LD body for '{itemName}'");
        return new GraphicalBody(lang, NetworkCode.RenderBody(fbd), decl);
    }

    /// <summary>A graphical POU's declaration, from the export's plaintext interface — which BOTH vendors
    /// carry (the recorded TwinCAT export in <c>fixtures/tc-fbd</c> has it; the older "TwinCAT omits it"
    /// reading of this was wrong). Reading it from the export also avoids touching the object-model aspect,
    /// which a just-reimported graphical POU poisons.
    /// <para>The COM read that used to sit here as a fall-back is GONE, and it had to go from HERE as well as
    /// from the Materializer: this method is the test SEAM for the production read pipeline, so a seam that still
    /// fell back would exercise a rule production no longer has. An export with no plaintext block was called "a
    /// structural property, not an error path" — measured, it does not occur on either vendor (the evidence is
    /// on <c>Materializer.BuildPouFromXml</c>), so it is an error path after all.</para></summary>
    private static string DeclarationFrom(ICodeStore code, ItemRef item, string itemName, string xml) =>
        PlcOpenDocument.DeclFromExport(xml, itemName)
        ?? throw new InvalidOperationException(
            $"'{itemName}': its PLCopen export carries no <InterfaceAsPlainText> — a POU document without a " +
            "declaration is a broken export");

    /// <summary>The NAMED item's FBD/LD element, via the production scoping rule
    /// (<c>PlcOpenDocument.ItemBody</c>). Replaces the borrowed <c>GraphSplice.FindFbdLdBody</c>, which was part
    /// of the ~97-line second write path deleted with it. Scoping by NAME is the point: an export holds the POU
    /// and its members, and answering with whichever body comes first is how a write once landed on a sibling
    /// method.</summary>
    private static XElement? NamedGraphicalBody(string xml, string itemName) =>
        PlcOpenDocument.ItemBody(XDocument.Parse(xml), itemName)?
            .Elements().FirstOrDefault(e => e.Name.LocalName is "FBD" or "LD");
}
