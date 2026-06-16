using System.Text;
using System.Text.RegularExpressions;
using Volt.Bridge.Core.Ide;
using Volt.Bridge.Core.Workspace;

namespace Volt.Bridge.Beckhoff;

/// <summary>Beckhoff driver — the <see cref="ICodeStore"/> facet: the two code transports. Textual goes
/// through the COM Declaration/Implementation text properties; PLCopen XML through the PLC project's
/// PlcOpenExport/Import (via a temp file). The body language is sniffed cheaply from the implementation
/// serialization so textual POUs never trigger an export.</summary>
public sealed partial class BeckhoffDriver
{
    // ── textual transport ──
    public string ReadDeclaration(ItemRef item) => (string)((dynamic)item.Native).DeclarationText ?? "";
    public string ReadImplementation(ItemRef item) => (string)((dynamic)item.Native).ImplementationText ?? "";

    public void WriteText(ItemRef item, string declaration, string implementation)
    {
        // No silent catch: a failed COM assignment must surface. A null/empty implementation is simply
        // not written (a decl-only item has no implementation slot) — a contract, not an error mask.
        dynamic node = item.Native;
        node.DeclarationText = declaration ?? "";
        if (!string.IsNullOrEmpty(implementation)) node.ImplementationText = implementation;
    }

    // ── PLCopen XML transport ──
    public string? BodyLanguage(ItemRef item) => TcPouReader.LanguageOf(ReadImplementation(item));

    public string ReadXml(ItemRef item)
    {
        var pou = EnclosingPou(item.Native) ?? throw new InvalidOperationException("TwinCAT: no enclosing POU to export");
        return TcPlcOpen.ExportXmlString(PlcRoot(), PouSelectionPath(pou));
    }

    /// <summary>Import a full PLCopen POU (same-name replace). Capture the original first and restore it
    /// once on a failed import, then rethrow — a bad edit can't lose the POU.</summary>
    public void WriteXml(ItemRef item, string xml)
    {
        var pou = EnclosingPou(item.Native) ?? throw new InvalidOperationException("TwinCAT: no enclosing POU to write");
        var plc = PlcRoot();
        var original = TcPlcOpen.ExportXmlString(plc, PouSelectionPath(pou));   // restore copy
        try { TcPlcOpen.ImportXmlString(plc, xml); }
        catch { TcPlcOpen.ImportXmlString(plc, original); throw; }              // single restore attempt, then rethrow
    }

    // ── non-source manifest ──
    public string ReadManifest(ItemRef item, string kind)
    {
        // No silent catch: ProduceXml failing is a real error. An item that genuinely produces no XML
        // yields a stable, kind-stamped manifest (deterministic version basis).
        string xml = (string)((dynamic)item.Native).ProduceXml();
        if (string.IsNullOrEmpty(xml)) return $"{kind}\n";

        var name = ExtractTag(xml, "ItemName") ?? ExtractTag(xml, "LibItemName") ?? "?";
        var sb = new StringBuilder();
        sb.Append("Name=").Append(name).Append('\n');
        if (kind == "task")
        {
            var linked = ExtractTag(xml, "LinkedTask");
            if (linked != null) sb.Append("linked-task=").Append(linked).Append('\n');
        }
        if (kind == "library")
        {
            var ns = ExtractTag(xml, "Namespace"); if (ns != null) sb.Append("namespace=").Append(ns).Append('\n');
            var def = ExtractTag(xml, "DefaultResolution"); if (def != null) sb.Append("default-resolution=").Append(def).Append('\n');
            var ver = ExtractTag(xml, "Version"); if (ver != null) sb.Append("version=").Append(ver).Append('\n');
            var dist = ExtractTag(xml, "Distributor"); if (dist != null) sb.Append("distributor=").Append(dist).Append('\n');
        }
        return sb.ToString();
    }

    /// <summary>Walk up to the enclosing POU (FB / function / program / interface). Only called for items
    /// the language gate already classified as graphical POUs, so the POU is found at/near hop 0.</summary>
    private dynamic? EnclosingPou(dynamic item)
    {
        dynamic node = item;
        for (var hops = 0; hops < 32; hops++)
        {
            int t;
            try { t = (int)node.ItemType; } catch { t = 0; }
            if (t is ItemKind.Program or ItemKind.Function or ItemKind.FunctionBlock or ItemKind.Interface) return node;
            node = node.Parent;
            if (node == null) return null;
        }
        return null;
    }

    /// <summary>PLC-project-relative selection path for PlcOpenExport ('.'-separated, folder-qualified).
    /// NEEDS LIVE VERIFICATION: if a bare/qualified name is rejected this must change.</summary>
    private string PouSelectionPath(dynamic pou)
    {
        try
        {
            string pouPath = (string)pou.PathName;
            string plcPath = (string)PlcRoot().PathName;
            if (pouPath.StartsWith(plcPath + "^", StringComparison.Ordinal))
                return pouPath.Substring(plcPath.Length + 1).Replace('^', '.');
            return pouPath.Replace('^', '.');
        }
        catch { try { return (string)pou.Name; } catch { return ""; } }
    }

    private static string? ExtractTag(string xml, string tag)
    {
        var m = Regex.Match(xml, $@"<{tag}[^>]*>([^<]*)</{tag}>");
        if (m.Success) { var val = m.Groups[1].Value.Trim(); if (val.Length > 0) return val; }
        return null;
    }
}
