using System.Linq;
using System.Text;
using System.Text.RegularExpressions;
using System.Xml.Linq;
using Volt.Bridge.Core.Ide;
using Volt.Bridge.Core.Library;

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
    public void WriteText(ItemRef item, string? declaration, string? implementation) =>
        _om.WriteText(item.Native, declaration, implementation);

    // ── PLCopen XML transport ──
    public string? BodyLanguage(ItemRef item) => TcPouReader.LanguageOf(_om.ReadImplementation(item.Native));

    public string ReadXml(ItemRef item) => _om.ExportPouXml(item.Native);

    /// <summary>Import a full PLCopen POU (same-name replace). Delete the existing POU first
    /// (TC's PlcOpenImport does not replace in-place — it adds, and a name collision fails).
    /// Capture the original XML before deletion so a failed import can restore it.</summary>
    public void WriteXml(ItemRef item, string xml)
    {
        var original = _om.ExportPouXml(item.Native);
        var parent = _om.Parent(item.Native);
        var name = _om.GetName(item.Native);
        _om.DeleteChild(parent, name);
        try { _om.ImportPlcOpenXml(xml); }
        catch
        {
            // Restore: re-import the original POU. If this also fails, the POU is lost —
            // a loud failure is correct.
            _om.ImportPlcOpenXml(original);
            throw;
        }
    }

    // ── non-source manifest ──
    public string ReadManifest(ItemRef item, string kind)
    {
        // No silent catch: ProduceXml failing is a real error. An item that genuinely produces no XML
        // yields a stable, kind-stamped manifest (deterministic version basis).
        string xml = _om.ProduceXml(item.Native);
        if (string.IsNullOrEmpty(xml)) return $"{kind}\n";

        // A `.library` ref → the SHARED canonical manifest (same shape as CODESYS), built from ProduceXml.
        if (kind == "library") return LibraryManifestFromXml(xml);

        var name = ExtractTag(xml, "ItemName") ?? ExtractTag(xml, "LibItemName") ?? "?";
        var sb = new StringBuilder();
        sb.Append("Name=").Append(name).Append('\n');
        if (kind == "task")
        {
            var linked = ExtractTag(xml, "LinkedTask");
            if (linked != null) sb.Append("linked-task=").Append(linked).Append('\n');
        }
        return sb.ToString();
    }

    /// <summary>Map a library ref's item-metadata XML to the canonical <see cref="LibraryManifest"/> — namespace,
    /// concrete resolution (from EffectiveResolution), placeholder flag, and direct dependencies (a ref's
    /// &lt;Dependencies&gt;). TwinCAT exposes no system-library flag on a reference, so SYSTEM is false.</summary>
    private static string LibraryManifestFromXml(string xml)
    {
        var root = XDocument.Parse(xml).Root!;
        string Name(string tag) => root.Descendants(tag).FirstOrDefault()?.Value ?? "";

        var name = Name("ItemName");
        var ns = root.Descendants("Namespace").FirstOrDefault()?.Value ?? name; // the reference's own namespace
        var placeholder = Name("ItemSubTypeName").Contains("PLACEHOLDER");
        // The reference's OWN EffectiveResolution is the first (a dependency's is nested under Dependencies).
        var eff = root.Descendants("EffectiveResolution").FirstOrDefault();
        var resolution = eff != null
            ? LibraryManifest.Resolution(eff.Element("LibraryName")?.Value ?? "", eff.Element("Version")?.Value ?? "", eff.Element("Distributor")?.Value ?? "")
            : root.Descendants("DefaultResolution").FirstOrDefault()?.Value ?? name;
        // Direct dependencies, by name — the tree captured as a reference (matches CODESYS's DEPENDENCIES).
        var deps = root.Descendants("Dependency")
            .Select(d => d.Element("PlaceholderName")?.Value ?? d.Element("EffectiveResolution")?.Element("LibraryName")?.Value)
            .Where(s => !string.IsNullOrEmpty(s)).Select(s => s!).ToList();

        return LibraryManifest.Build(name, ns, resolution, placeholder, system: false, deps);
    }

    private static string? ExtractTag(string xml, string tag)
    {
        var m = Regex.Match(xml, $@"<{tag}[^>]*>([^<]*)</{tag}>");
        if (m.Success) { var val = m.Groups[1].Value.Trim(); if (val.Length > 0) return val; }
        return null;
    }
}
