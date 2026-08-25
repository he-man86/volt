using System;
using Volt.Engine.Document;
using Volt.Engine.Graph;
using Volt.Engine.Ide;
using Volt.Engine.Model;
using Volt.Engine.Vocabulary;

namespace Volt.Engine.Sync;

/// <summary>A graphical (FBD/LD/CFC/SFC) body rendered to text. <paramref name="Language"/> is
/// FBD/LD/CFC/SFC; <paramref name="Body"/> is editable network text for FBD/LD, empty for read-only CFC/SFC;
/// <paramref name="Declaration"/> is the POU's real declaration (from the same export when the vendor
/// carries the plaintext interface, else the textual aspect — never empty/guessed).</summary>
public sealed record GraphicalBody(string Language, string Body, string Declaration);

/// <summary>The graphical body's IO half: reading one out of a live IDE and writing one back.
/// <para>Split from <see cref="Volt.Engine.Graph.NetworkCode"/>, which keeps the PURE half (the language gate,
/// the parser, the strict round-trip check). The split is what breaks a namespace cycle: the pure half is
/// reached from <c>Document.BodyCodec</c>, while this half needs <c>ICodeStore</c> and the PLCopen document —
/// so together they made <c>Graph</c> and <c>Document</c> depend on each other, invisibly, inside one assembly.
/// Format has no business knowing about a driver; that is the line the split follows.</para></summary>
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

        var fbd = GraphSplice.FindFbdLdBody(xml, itemName)
            ?? throw new InvalidOperationException(
                $"graphical body language is {lang} but the PLCopen export has no FBD/LD body for '{itemName}'");
        return new GraphicalBody(lang, NetworkCode.RenderBody(fbd), decl);
    }

    public static void Write(ICodeStore code, ItemRef item, string itemName, string vgText, string declaration)
    {
        var graph = NetworkCode.Validate(vgText);                                        // pure checks first (no IDE write yet)
        var types = InstanceTypes.Of(declaration);
        var newBody = GraphWriter.WriteBody(graph, inst => types.TryGetValue(inst, out var t) ? t : null);

        // The export is the item's WHOLE POU — the enclosing POU's own body and every sibling method/action come
        // with it — so the splice is scoped by name. Without that it lands on whichever body is first in document
        // order and silently destroys it.
        var exported = code.ReadXml(item);                                   // current full POU PLCopen
        var spliced = GraphSplice.SpliceFbdLdBody(exported, itemName, newBody);   // throws if no FBD/LD body
        code.WriteXml(item, spliced);                                        // import (vendor restores on failure)
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
}
