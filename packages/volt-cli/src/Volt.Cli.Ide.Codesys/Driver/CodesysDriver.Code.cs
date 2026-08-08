using System;
using System.Collections.Generic;
using Volt.Cli.Transport;
using Volt.Engine.Graphical;
using Volt.Engine.Ide;
using Volt.Engine.Workspace;

namespace Volt.Cli.Ide.Codesys;

/// <summary>CODESYS driver — the <see cref="ICodeStore"/> facet: the two code transports. Textual goes
/// through the object-model Interface/Implementation aspects; PLCopen XML through the in-memory
/// export_xml/import_xml. The body language is read from the export (CODESYS exposes no cheap attribute).</summary>
public sealed partial class CodesysDriver
{
    // ── textual transport ──
    public string ReadDeclaration(ItemRef item) => item.Native is LibRefNode lib ? lib.Manifest : _om.ReadDeclaration(item.Native);
    public string ReadImplementation(ItemRef item) => item.Native is LibRefNode ? "" : _om.ReadImplementation(item.Native);
    public void WriteText(ItemRef item, string? declaration, string? implementation) => _om.WriteSourceText(item.Native, declaration, implementation);

    // ── PLCopen XML transport ──
    // Scoped to THIS item's name: the export carries the POU's methods and actions too, so a whole-document
    // scan reports a graphical CHILD's language for a textual POU — and that language is what routes the item
    // to the graphical transport.
    public string? BodyLanguage(ItemRef item) =>
        item.Native is LibRefNode ? null : PlcOpenDocument.GraphicalBodyLang(_om.ExportXmlString(item.Native), Name(item));

    // No LibRefNode arm here, unlike the textual readers above: `library` is not a source kind, so Materializer
    // routes a library reference to ReadManifest and never here. The arm that used to sit here GUARDED the synthetic
    // node by handing it to the object-model exporter — the very call it was guarding against, which wraps it into an
    // IExtendedObject<IScriptObject> and throws. If one ever does reach this, it fails loud there rather than
    // returning a manifest dressed up as PLCopen XML.
    public string ReadXml(ItemRef item)
    {
        if (KindCodeOf(item.Native) == ItemKind.PlcItf) return _om.ExportInterfaceXml(item.Native);
        return _om.ExportXmlWithChildren(item.Native);
    }

    /// <summary>Import a full PLCopen POU in place: MERGE into the original parent, so the name collision engages
    /// <c>ConflictResolve.Replace</c>. No delete.
    /// <para>The delete was never a requirement — it was this driver's choice, and it is what cost us folders and a
    /// failure window. Measured on 3.5.21.40: a merge lands the declaration and the body, ADDS a child present only
    /// in the document, REMOVES one absent from it, and leaves a sibling POU's CFC body untouched. Deleting first
    /// bought nothing and rendered the conflict mode moot (the old comment here said as much), while opening the
    /// window where a rejected import leaves the POU GONE — which is why
    /// <see cref="PlcOpenTransport.ReplaceByReimport"/>'s capture/restore dance existed. Nothing to restore now:
    /// a refused import leaves the original object exactly as it was.</para>
    /// <para>The import still targets the original PARENT — a project-level import relocates the POU to the root.
    /// It does NOT preserve the POU's INTERNAL child folders; <see cref="IProjectTree.Move"/> restores those, in
    /// <c>PushService</c>, where the pushed source says which folder each child belongs in.</para></summary>
    public void WriteXml(ItemRef item, string xml) => _om.ImportXmlString(xml, _om.ParentOf(item.Native));

    /// <summary>Measured, not assumed — see <c>pou-writes-via-plcopen</c> §3.1 for the run: on 3.5.21.40 a merge
    /// import lands the declaration and body, ADDS a document-only child, REMOVES a child absent from the
    /// document, and leaves a sibling POU's CFC body byte-identical.</summary>
    public override bool WritesPouAsOneDocument => true;

    // ── non-source manifest ──
    /// <summary>Kinds this SESSION has already reported as having no descriptor reader. Instance-scoped, not
    /// static: the DLL outlives a PipeHost.Stop()/Start() inside a running IDE, and a support session that
    /// restarts the bridge must get the warning again rather than inherit a silenced process.</summary>
    private readonly HashSet<string> _kindsWithoutReader = new HashSet<string>(StringComparer.Ordinal);

    public string ReadManifest(ItemRef item, string kind) =>
        item.Native is LibRefNode lib ? lib.Manifest
        : kind == ItemKind.Kinds.Device ? _om.DeviceDescriptor(item.Native)
        : kind == ItemKind.Kinds.ProjectInfo ? _om.ProjectInfoDescriptor(item.Native)
        : kind == ItemKind.Kinds.Trace ? _om.TraceDescriptor(item.Native)
        : kind == ItemKind.Kinds.Recipe ? _om.RecipeDescriptor(item.Native)
        : kind == ItemKind.Kinds.SymbolConfig ? _om.SymbolConfigDescriptor(item.Native)
        : kind == ItemKind.Kinds.Task ? _om.TaskDescriptor(item.Native)
        : NoDescriptorReader(kind);

    /// <summary>A kind CODESYS classifies as a TRACKED item but for which no descriptor reader was ever written
    /// (visualization, image pool, text list, class diagram …). The manifest is the canonical empty one — the same
    /// bytes TwinCAT emits for an item with no metadata — and the gap is now NAMED in the log instead of being
    /// invisible. It is still a gap: every item of the kind hashes identically, so an edit to one of them cannot
    /// show up in `volt status`. The fix is the missing reader, and this line is what points at it.</summary>
    private string NoDescriptorReader(string kind)
    {
        bool first;
        lock (_kindsWithoutReader) first = _kindsWithoutReader.Add(kind);
        if (first)
            VoltLog.Warn($"no descriptor reader for kind '{kind}' — its items materialize as the empty manifest and all hash identically");
        return ItemKind.EmptyManifest(kind);
    }
}
