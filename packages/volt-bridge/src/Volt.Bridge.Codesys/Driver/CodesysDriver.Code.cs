using Volt.Bridge.Core.Graphical;
using Volt.Bridge.Core.Ide;

namespace Volt.Bridge.Codesys;

/// <summary>CODESYS driver — the <see cref="ICodeStore"/> facet: the two code transports. Textual goes
/// through the object-model Interface/Implementation aspects; PLCopen XML through the in-memory
/// export_xml/import_xml. The body language is read from the export (CODESYS exposes no cheap attribute).</summary>
public sealed partial class CodesysDriver
{
    // ── textual transport ──
    public string ReadDeclaration(ItemRef item) => item.Native is LibRefNode lib ? lib.Manifest : _om.ReadDeclaration(item.Native);
    public string ReadImplementation(ItemRef item) => item.Native is LibRefNode ? "" : _om.ReadImplementation(item.Native);
    public void WriteText(ItemRef item, string? declaration, string implementation) => _om.WriteSourceText(item.Native, declaration, implementation);

    // ── PLCopen XML transport ──
    public string? BodyLanguage(ItemRef item) =>
        item.Native is LibRefNode ? null : PlcOpenDocument.GraphicalBodyLang(_om.ExportXmlString(item.Native));

    public string ReadXml(ItemRef item) => _om.ExportXmlString(item.Native);

    /// <summary>Import a full PLCopen POU in place: delete the existing object and re-import INTO the
    /// original parent (PLCopenXML carries no folder membership, so a project-level import would relocate
    /// the POU to the root). Capture the original first and restore it once on a failed import, then
    /// rethrow — a bad edit can never lose or move the POU.</summary>
    public void WriteXml(ItemRef item, string xml)
    {
        var node = item.Native;
        var nm = _om.GetName(node);
        var par = _om.ParentOf(node);
        var original = _om.ExportXmlString(node);            // restore copy
        if (par != null) _om.DeleteChild(par, nm);
        try { _om.ImportXmlString(xml, par); }
        catch { _om.ImportXmlString(original, par); throw; } // single restore attempt, then rethrow loudly
    }

    // ── non-source manifest ──
    public string ReadManifest(ItemRef item, string kind) => item.Native is LibRefNode lib ? lib.Manifest : $"{kind}\n";
}
