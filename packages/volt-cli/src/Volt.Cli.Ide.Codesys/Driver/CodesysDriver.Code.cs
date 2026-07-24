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

    public string ReadXml(ItemRef item)
    {
        if (item.Native is LibRefNode) return _om.ExportXmlString(item.Native);
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
    public string ReadManifest(ItemRef item, string kind) =>
        item.Native is LibRefNode lib ? lib.Manifest
        : kind == ItemKind.Kinds.Device ? _om.DeviceDescriptor(item.Native)
        : kind == ItemKind.Kinds.ProjectInfo ? _om.ProjectInfoDescriptor(item.Native)
        : kind == ItemKind.Kinds.Trace ? _om.TraceDescriptor(item.Native)
        : kind == ItemKind.Kinds.Recipe ? _om.RecipeDescriptor(item.Native)
        : kind == ItemKind.Kinds.SymbolConfig ? _om.SymbolConfigDescriptor(item.Native)
        : kind == ItemKind.Kinds.Task ? _om.TaskDescriptor(item.Native)
        : $"{kind}\n";
}
