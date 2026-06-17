using System.Text;
using System.Text.RegularExpressions;
using Volt.Bridge.Core.Ide;

namespace Volt.Bridge.Beckhoff;

/// <summary>Beckhoff driver — the <see cref="ICodeStore"/> facet: the two code transports. The COM moves
/// (declaration/implementation text, PLCopen export/import, item-metadata XML) go through
/// <see cref="TcObjectModel"/>; what stays here is the transport orchestration (the restore-on-failed-import
/// guard) and the pure-string manifest formatting. The body language is sniffed cheaply from the
/// implementation serialization so textual POUs never trigger an export.</summary>
public sealed partial class BeckhoffDriver
{
    // ── textual transport ──
    public string ReadDeclaration(ItemRef item) => _om.ReadDeclaration(item.Native);
    public string ReadImplementation(ItemRef item) => _om.ReadImplementation(item.Native);
    public void WriteText(ItemRef item, string? declaration, string implementation) =>
        _om.WriteText(item.Native, declaration, implementation);

    // ── PLCopen XML transport ──
    public string? BodyLanguage(ItemRef item) => TcPouReader.LanguageOf(_om.ReadImplementation(item.Native));

    public string ReadXml(ItemRef item) => _om.ExportPouXml(item.Native);

    /// <summary>Import a full PLCopen POU (same-name replace). Capture the original first and restore it
    /// once on a failed import, then rethrow — a bad edit can't lose the POU.</summary>
    public void WriteXml(ItemRef item, string xml)
    {
        var original = _om.ExportPouXml(item.Native);   // restore copy
        try { _om.ImportPlcOpenXml(xml); }
        catch { _om.ImportPlcOpenXml(original); throw; } // single restore attempt, then rethrow
    }

    // ── non-source manifest ──
    public string ReadManifest(ItemRef item, string kind)
    {
        // No silent catch: ProduceXml failing is a real error. An item that genuinely produces no XML
        // yields a stable, kind-stamped manifest (deterministic version basis).
        string xml = _om.ProduceXml(item.Native);
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

    private static string? ExtractTag(string xml, string tag)
    {
        var m = Regex.Match(xml, $@"<{tag}[^>]*>([^<]*)</{tag}>");
        if (m.Success) { var val = m.Groups[1].Value.Trim(); if (val.Length > 0) return val; }
        return null;
    }
}
