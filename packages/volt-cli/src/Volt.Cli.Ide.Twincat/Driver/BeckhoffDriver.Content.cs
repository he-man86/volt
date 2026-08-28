using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Xml.Linq;
using Volt.Contracts;
using Volt.Engine;
using Volt.Engine.Format.Body;
using Volt.Engine.Format.Network;
using Volt.Engine.Format.St;
using Volt.Engine.Ide;
using Volt.Engine.Item;
using Volt.Engine.Library;

namespace Volt.Cli.Ide.Twincat;

/// <summary>
/// Beckhoff driver — the <see cref="ICodeStore"/> facet. Declarations and bodies travel the COM object model
/// (<c>DeclarationText</c> / <c>ImplementationText</c>); a graphical body is the IDE's OWN
/// <c>&lt;NWL&gt;</c> archive, edited in place.
///
/// <para>This replaces <c>BeckhoffDriver.Code.cs</c> and the PLCopen round trip it drove — an export to a temp
/// file, an import back, and the item MOVE that only existed because the import relocated everything to the
/// project root. All seven checklist rows PLCopen failed on this vendor go with it: the declaration and member
/// declarations it did not carry (the export emits no <c>InterfaceAsPlainText</c> at all on this install),
/// the network metadata it dropped, the disabled network it OMITTED outright, the in-place replace it could
/// not do, and the normalization that turned <c>x : INT;</c> into <c>x: INT;</c> on a round trip with no edit.</para>
/// </summary>
public sealed partial class BeckhoffDriver
{
    public ItemContent ReadContent(ItemRef item)
    {
        var declaration = _om.ReadDeclaration(item.Native);
        var body = ReadBody(item);

        var members = new List<Member>();
        foreach (var site in MemberSites(item))
            members.Add(ReadMember(site));

        return new ItemContent(KindOf(item, declaration), declaration.TrimEnd(), body, members);
    }

    public void WriteContent(ItemRef item, ItemContent content)
    {
        WriteOne(item, content.Kind, content.Declaration, content.Body);
        foreach (var m in content.Members)
        {
            var target = FindChildByName(item, m.Name)
                ?? throw new BridgeException(BridgeErrorCodes.NotFound,
                    $"'{m.Name}': the member is in the pushed source but not in the project — creating members " +
                    "is the push service's job, and writing through a missing one would land nothing");

            WriteOne(target, m.Kind, m.Kind == ItemKind.Kinds.Action ? null : m.Declaration, m.Body);
            WriteAccessor(target, ItemKind.PlcPropGet, m.Getter);
            WriteAccessor(target, ItemKind.PlcPropSet, m.Setter);
        }
    }

    // ── body ──────────────────────────────────────────────────────────────────────────────────────

    /// <summary>An item's body as workspace text: ST verbatim, a graphical body as network text, an
    /// unsupported language as its marker.</summary>
    private string? ReadBody(ItemRef item)
    {
        var raw = _om.ReadImplementation(item.Native);
        if (string.IsNullOrWhiteSpace(raw)) return null;

        if (TcArchive.Root(raw) is { } impl)
        {
            var model = TcNetworkReader.Read(impl, ViewModeOf(impl));
            var text = NetworkTextWriter.Write(model).Trim();
            return text.Length == 0 ? null : text;
        }

        // CFC and SFC are graphical and unsupported: they materialize as the marker, so an engineer gets a file
        // that says so rather than an editable-looking approximation of a diagram they would then push back.
        var lang = GraphicalLanguageOf(raw);
        if (lang != null) return BodyMarker.For(lang);

        var body = raw.Trim();
        return body.Length == 0 ? null : body;
    }

    /// <summary>FBD or LD, from the archive's <c>DefaultViewMode</c>. IL is the same network model in a third
    /// view; Volt does not author it, so it is refused rather than re-rendered as a diagram the engineer did
    /// not write.</summary>
    private static BodyLanguage ViewModeOf(XElement impl)
    {
        var mode = TcArchive.ViewMode(impl) ?? "Fbd";
        if (mode.Equals("Ld", StringComparison.OrdinalIgnoreCase)) return BodyLanguage.Ld;
        if (mode.Equals("Fbd", StringComparison.OrdinalIgnoreCase)) return BodyLanguage.Fbd;
        throw new NotSupportedException(
            $"TwinCAT: the graphical body's view mode is '{mode}'. Volt authors FBD and LD only.");
    }

    /// <summary>The wrapper element of a non-NWL graphical body — <c>&lt;CFC&gt;</c>, <c>&lt;SFC&gt;</c> — or
    /// null when the body is textual (ST is not XML at all).</summary>
    private static string? GraphicalLanguageOf(string raw)
    {
        XElement el;
        try { el = XElement.Parse(raw); } catch { return null; }
        return el.Name.LocalName switch
        {
            "CFC" => "CFC",
            "SFC" => "SFC",
            _ => null,
        };
    }

    private void WriteOne(ItemRef item, string kind, string? declaration, string? body)
    {
        if (body is { } b && NetworkText.Is(b))
        {
            var model = NetworkTextGate.Validate(b);      // refuse BEFORE touching the IDE
            var existing = _om.ReadImplementation(item.Native);
            var updated = TcNetworkWriter.Apply(existing, model);
            // A null means the archive already says exactly this: writing it back would rewrite ids and
            // vendor members for no change at all.
            _om.WriteText(item.Native, declaration, updated);
            return;
        }

        // A marker is informational and is never written back over a live CFC/SFC body.
        _om.WriteText(item.Native, declaration, BodyMarker.Is(body) ? null : body);
    }

    // ── members ───────────────────────────────────────────────────────────────────────────────────

    private readonly struct MemberSite
    {
        public MemberSite(string? folder, ItemRef itemRef, string name, int code)
        { Folder = folder; Ref = itemRef; Name = name; Code = code; }
        public string? Folder { get; }
        public ItemRef Ref { get; }
        public string Name { get; }
        public int Code { get; }
    }

    /// <summary>Every member of a POU and the folder it sits in.
    /// <para><b>No catch, deliberately.</b> A member the walk fails to reach materializes with a null folder,
    /// the writer emits no <c>%FOLDER</c> directive, and the next push resolves that null to the POU ROOT and
    /// creates a DUPLICATE beside the real member — with <c>volt status</c> reporting clean throughout, because
    /// the version hash is taken over the folder-less text. A partial map is not a degraded answer, it is a
    /// wrong one.</para></summary>
    private IEnumerable<MemberSite> MemberSites(ItemRef parent, string basePath = "")
    {
        int count = ChildCount(parent);
        for (int i = 1; i <= count; i++)
        {
            var child = ChildAt(parent, i);
            var name = Name(child);
            var code = KindCode(child);

            if (code == ItemKind.PlcFolder)
            {
                foreach (var nested in MemberSites(child, FolderPath.Append(basePath, name))) yield return nested;
                continue;
            }
            // ONLY kinds the file layout can carry. A transition is inlined in the POU and is NOT a member:
            // no reader models one, so it never reaches the file and can never be in a pushed member set —
            // yielding it here would put it in the reconciliation and a push would delete it. Accessors are
            // excluded too: a property's GET/SET are read WITH the property.
            if (!ItemKind.IsMember(code)) continue;

            yield return new MemberSite(string.IsNullOrEmpty(basePath) ? null : basePath, child, name, code);
        }
    }

    private Member ReadMember(MemberSite site)
    {
        var kind = ItemKind.Map(site.Code) ?? ItemKind.Kinds.Method;

        Accessor? getter = null, setter = null;
        if (site.Code is ItemKind.PlcProp or ItemKind.PlcItfProp)
        {
            int n = ChildCount(site.Ref);
            for (int i = 1; i <= n; i++)
            {
                var acc = ChildAt(site.Ref, i);
                var code = KindCode(acc);
                if (code == ItemKind.PlcPropGet) getter = ReadAccessor(acc);
                else if (code == ItemKind.PlcPropSet) setter = ReadAccessor(acc);
            }
        }

        return new Member(kind, site.Name, MemberDeclaration(site), ReadBody(site.Ref), site.Folder, getter, setter);
    }

    private Accessor ReadAccessor(ItemRef acc) =>
        new Accessor(KeepDecl(_om.ReadDeclaration(acc.Native)), ReadBody(acc));

    /// <summary><b>An ACTION is the one member with no declaration to read</b>: IEC gives an action a name and
    /// a body and nothing else, and Beckhoff's own object model says so — <c>_ITcPlcImplementation</c> exposes
    /// <c>ImplementationText</c> and no <c>DeclarationText</c>. Its header is COMPOSED here rather than read;
    /// that is not a fallback for a missing value, it is the whole of what an action's header is.</summary>
    private string MemberDeclaration(MemberSite site)
    {
        if (site.Code == ItemKind.PlcAction) return $"ACTION {site.Name}";

        var decl = _om.ReadDeclaration(site.Ref.Native);
        if (string.IsNullOrWhiteSpace(decl))
            throw new BridgeException(BridgeErrorCodes.InternalError,
                $"'{site.Name}': the IDE reports no declaration for this member — that is a broken item, not a " +
                "transport gap");
        return decl.Trim();
    }

    private ItemRef? FindChildByName(ItemRef parent, string name)
    {
        foreach (var site in MemberSites(parent))
            if (string.Equals(site.Name, name, StringComparison.Ordinal)) return site.Ref;
        return null;
    }

    private void WriteAccessor(ItemRef property, int code, Accessor? accessor)
    {
        if (accessor is null) return;
        int n = ChildCount(property);
        for (int i = 1; i <= n; i++)
        {
            var child = ChildAt(property, i);
            if (KindCode(child) != code) continue;
            WriteOne(child, ItemKind.Map(code) ?? "", accessor.Declaration, accessor.Body);
            return;
        }
    }

    /// <summary>An accessor declaration worth keeping: null/blank, or a bare empty VAR block, carries nothing.</summary>
    private static string? KeepDecl(string? decl)
    {
        var d = decl?.Trim();
        if (string.IsNullOrEmpty(d)) return null;
        var lines = d!.Split('\n');
        var empty = lines.Length <= 2 && d.StartsWith("VAR", StringComparison.Ordinal)
                                      && d.EndsWith("END_VAR", StringComparison.Ordinal);
        return empty ? null : d;
    }

    private string KindOf(ItemRef item, string declaration)
    {
        var mapped = ItemKind.Map(KindCode(item));
        if (!string.IsNullOrEmpty(mapped)) return mapped!;
        return CodeHelper.ParseCodeHeader(declaration).Type;
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

    /// <summary>The first <c>&lt;tag&gt;</c>'s text in an item's metadata XML, or null when absent or blank.
    ///
    /// <para>Parsed as XML, not matched with a regex. This used to be
    /// <c>Regex.Match(xml, $@"&lt;{tag}[^&gt;]*&gt;([^&lt;]*)&lt;/{tag}&gt;")</c> — sitting in the same file as
    /// <see cref="LibraryManifestFromXml"/>, which parses the SAME document with <c>XDocument</c>. Two mechanisms
    /// for one job, and the weaker one silently: the pattern misses a value carrying an entity or a nested
    /// element, and matches a tag inside a comment or a CDATA section. <c>TcItemArchive</c> already states the
    /// rule for this repo — "a regex over that works until a body happens to contain the pattern".</para>
    ///
    /// <para>A malformed document now throws where the regex quietly answered null, which is the right direction:
    /// this feeds the item's NAME, and a null there is not a missing name, it is an unreadable one.</para></summary>
    private static string? ExtractTag(string xml, string tag)
    {
        var val = XDocument.Parse(xml).Descendants(tag).FirstOrDefault()?.Value.Trim();
        return string.IsNullOrEmpty(val) ? null : val;
    }
}
