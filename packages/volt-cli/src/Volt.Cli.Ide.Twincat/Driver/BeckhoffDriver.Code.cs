using System.Linq;
using System.Text;
using System.Text.RegularExpressions;
using System.Xml.Linq;
using Volt.Contracts;
using Volt.Engine.Ide;
using Volt.Engine.Library;
using Volt.Engine.Vocabulary;

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

    /// <summary>Import a full PLCopen POU in place: a REPLACE merge into the PLC project, with NO delete —
    /// the same shape CODESYS uses (<c>ConflictResolve.Replace</c>), and landing in the same place.
    /// <para><b>The delete is gone, and with it the foldered-item refusal.</b> This used to delete the POU and
    /// then re-import it, because the import was believed unable to replace in place. It can: the options
    /// argument had never been varied off <c>NONE</c>, and under <c>REPLACE</c> the item is replaced with no
    /// delete, no duplicate, and the content lands (DIALECT D4c, measured live).</para>
    /// <para>What that refusal cost: a graphical push to a POU living in ANY folder was rejected outright
    /// ("move it to the PLC-project root or edit it in the IDE"), because the alternative was silently moving
    /// the engineer's code. Neither is needed any more.</para>
    /// <para><b>The import still relocates to the PLC-project root</b> — that part of D4b was real, and no import
    /// option or document shape changes it (D4g). <c>TcObjectModel.ImportPlcOpenXml</c> moves the item back, so
    /// this method is in-place on both vendors; the asymmetry stops below the <see cref="ICodeStore"/> seam
    /// instead of leaking into Core.</para></summary>
    public void WriteXml(ItemRef item, string xml) => _om.ImportPlcOpenXml(item.Native, xml);

    /// <summary>ON. TwinCAT takes the single-document POU write, and the live suite reads the same 94 pass / 2
    /// fail as the per-child arm it replaces (both remaining failures are CLI/git, not the bridge).
    /// <para>It was 36 failures when the change first measured this vendor, and the four things in the way were
    /// each a different layer's: the document never declared its members in <c>&lt;ProjectStructure&gt;</c>, which
    /// is the ONLY thing this importer creates children from (D4h); the DUT subtype codes were unmapped, so those
    /// items were dropped by Core; the write asked for a document <c>PlcOpenExport</c> refuses to make for a
    /// DUT/GVL (C2); and Volt's own body-language guard refused the LD body it was itself creating over the FBD
    /// seed <c>CreateChild</c> had just laid down (C6).</para>
    /// <para>The last was a real vendor limit — a POU-INTERNAL member folder does not survive the import and
    /// cannot be restored by the archive move, because <c>ExportChild</c> refuses a member. It IS restorable:
    /// TwinCAT keeps the whole POU in one <c>.TcPOU</c> and a member's placement is a <c>FolderPath</c> attribute
    /// in it, so the round trip happens on the POU and rewrites that attribute (D4j, <c>TcItemArchive</c>).</para></summary>
    public override bool WritesPouAsOneDocument => true;

    /// <summary>POUs and interfaces only. <c>PlcOpenExport</c> answers <c>E_FAIL</c> for a DUT or a GVL — the
    /// export is POU-shaped and a declaration-only item has no POU to name (DIALECT C2, measured live against
    /// `GVL_PackML` and all five e2e DUT kinds). So those keep the declaration-text write on this vendor, which
    /// is also how the READ has always fetched them.</summary>
    public override bool CanExportDocument(string kind) => ItemKind.TravelsAsDocument(kind);

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

        // NOT `?? "?"`. This manifest IS the item's version-hash input, so a fabricated name makes every
        // unnameable item of the kind hash IDENTICALLY — an edit to one could then never show up in `volt status`.
        //
        // It is also NOT `?? _om.GetName(item.Native)`, which was tried and is worse: that adds a COM call to a
        // method that is otherwise pure string work over XML the caller already fetched, and it runs during the
        // walk — where TwinCAT legitimately invalidates a handle after a preceding mutation ("Item 'x' is deleted
        // or invalidated by an ealier operation!"). It turned a naming question into a liveness one and failed
        // eleven graphical pushes.
        //
        // The XML came from ProduceXml for THIS item. If it carries neither tag it is not the document this
        // method is written for, and saying so is the whole answer.
        var name = ExtractTag(xml, "ItemName") ?? ExtractTag(xml, "LibItemName")
            ?? throw new InvalidOperationException(
                $"twincat: item metadata for kind '{kind}' carries neither <ItemName> nor <LibItemName> — " +
                "cannot build a manifest whose name is the version-hash input");
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
