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
    public static void Write(ICodeStore code, ItemRef item, string vgText, string declaration)
    {
        // Format guard (before any IDE import): only FBD/LD can be authored as VG. A read-only CFC/SFC or an
        // unknown language token is refused HERE with a clear message — not downstream with a misleading
        // "not writable". The bridge owns FORMAT; the LSP owns code correctness.
        var lang = VgBody.LanguageOf(vgText);
        if (!VgBody.IsEditable(lang))
            throw new InvalidOperationException(lang is "CFC" or "SFC"
                ? $"'{lang}' bodies are read-only — edit them in the IDE, not via push."
                : $"unknown graphical language '{lang ?? "?"}' (expected FBD or LD).");

        var graph = VgParser.Parse(vgText);                                  // throws on invalid VG
        var types = PlcOpenDocument.InstanceTypes(declaration);
        var newBody = PlcOpenWriter.WriteBody(graph, inst => types.TryGetValue(inst, out var t) ? t : null);

        var exported = code.ReadXml(item);                                   // current full POU PLCopen
        var spliced = PlcOpenDocument.SpliceFbdLdBody(exported, newBody);    // throws if no FBD/LD body
        code.WriteXml(item, spliced);                                        // import (vendor restores on failure)
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
