using System.Linq;
using System.Text;
using System.Text.RegularExpressions;
using System.Xml.Linq;
using Volt.Cli.Transport;
using Volt.Engine;
using Volt.Engine.Ide;
using Volt.Engine.Library;
using Volt.Engine.Workspace;

namespace Volt.Cli.Ide.Twincat;

/// <summary>Beckhoff driver — the <see cref="ICodeStore"/> facet: the two code transports. The COM moves
/// (declaration/implementation text, PLCopen export/import, item-metadata XML) go through
/// <see cref="TcObjectModel"/>; what stays here is the transport orchestration (the restore-on-failed-import
/// guard) and the pure-string manifest formatting. The body language is sniffed cheaply from the
/// implementation serialization so textual POUs never trigger an export.</summary>
public sealed partial class BeckhoffDriver
{
    // ── textual transport ──
    public string ReadDeclaration(ItemRef item) => _om.ReadDeclaration(item.Native);
    public void WriteText(ItemRef item, string? declaration, string? implementation) =>
        _om.WriteText(item.Native, declaration, implementation);

    // ── PLCopen XML transport ──
    public string? BodyLanguage(ItemRef item) => TcPouReader.LanguageOf(_om.ReadImplementation(item.Native));

    public string ReadXml(ItemRef item) => _om.ExportPouXml(item.Native);

    /// <summary>Import a full PLCopen POU (same-name replace). Delete the existing POU first (TC's PlcOpenImport does
    /// not replace in-place — it adds, and a name collision fails). The capture/restore/rethrow data-safety policy
    /// lives once in <see cref="Volt.Engine.Ide.PlcOpenTransport.ReplaceByReimport"/>.
    /// <para><b>REFUSED for an item that lives in a folder</b>, because on TwinCAT the placement cannot be
    /// preserved and cannot be repaired. Measured live on TcXaeShell 15.0 (DIALECT D4b): <c>PlcOpenImport</c> is
    /// a member of the PLC PROJECT only — it does not exist on a folder tree item — and its signature is
    /// <c>(path, options)</c> with no target argument (a third one is <c>DISP_E_TYPEMISMATCH</c>). So the
    /// re-imported item always lands at the PLC-project root. CODESYS survives the same flattening because it has
    /// <c>move()</c>; TwinCAT has no move primitive at all (D4).</para>
    /// <para>It used to just do it, and the POU silently MOVED out of the engineer's folder on every graphical
    /// push. A loud refusal is the smaller harm: relocating someone's code without telling them is the failure
    /// mode this bridge exists to prevent, and "your body is unchanged, move the POU to the project root or edit
    /// it in the IDE" is a thing they can act on.</para></summary>
    public void WriteXml(ItemRef item, string xml)
    {
        var parent = _om.Parent(item.Native);
        var name = _om.GetName(item.Native);
        if (!_om.IsPlcProjectRoot(parent))
            throw new BridgeException(BridgeErrorCodes.Unsupported,
                $"'{name}' is inside a folder, and TwinCAT's PLCopen import can only place an item at the " +
                "PLC-project root — it would silently move the POU out of its folder. Edit it in the IDE, or " +
                "move it to the PLC-project root first.");

        Volt.Engine.Ide.PlcOpenTransport.ReplaceByReimport(
            exportOriginal: () => _om.ExportPouXml(item.Native),
            delete: () => _om.DeleteChild(parent, name),
            import: _om.ImportPlcOpenXml,
            xml);
    }

    // ── non-source manifest ──
    public string ReadManifest(ItemRef item, string kind)
    {
        // No silent catch: ProduceXml failing is a real error. An item that genuinely produces no XML
        // yields the canonical, kind-stamped empty manifest (deterministic version basis) — the SAME Core
        // helper CODESYS falls through to, so the two vendors cannot drift on those bytes.
        string xml = _om.ProduceXml(item.Native);
        if (string.IsNullOrEmpty(xml)) return ItemKind.EmptyManifest(kind);

        // A `.library` ref → the SHARED canonical manifest (same shape as CODESYS), built from ProduceXml.
        if (kind == ItemKind.Kinds.Library) return LibraryManifestFromXml(xml);

        var name = ExtractTag(xml, "ItemName") ?? ExtractTag(xml, "LibItemName") ?? "?";
        var sb = new StringBuilder();
        sb.Append("Name=").Append(name).Append('\n');
        if (kind == ItemKind.Kinds.Task)
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
