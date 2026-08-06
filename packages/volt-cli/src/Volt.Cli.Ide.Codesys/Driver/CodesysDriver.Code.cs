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
    public string? BodyLanguage(ItemRef item) =>
        item.Native is LibRefNode ? null : PlcOpenDocument.GraphicalBodyLang(_om.ExportXmlString(item.Native));

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

    /// <summary>Import a full PLCopen POU in place: delete the existing object and re-import INTO the original parent
    /// (PLCopenXML carries no folder membership, so a project-level import would relocate the POU to the root). The
    /// capture/restore/rethrow data-safety policy lives once in <see cref="PlcOpenTransport.ReplaceByReimport"/>.</summary>
    public void WriteXml(ItemRef item, string xml)
    {
        var node = item.Native;
        var nm = _om.GetName(node);
        var par = _om.ParentOf(node);
        PlcOpenTransport.ReplaceByReimport(
            exportOriginal: () => _om.ExportXmlString(node),
            delete: () => { if (par != null) _om.DeleteChild(par, nm); },
            import: x => _om.ImportXmlString(x, par),
            xml);
    }

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
