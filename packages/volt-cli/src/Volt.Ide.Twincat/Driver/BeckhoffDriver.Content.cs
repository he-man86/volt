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

namespace Volt.Ide.Twincat;

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
        foreach (var site in Volt.Engine.Ide.MemberSites.Of(this, item))
            members.Add(ReadMember(site));

        return new ItemContent(KindOf(item, declaration), declaration.TrimEnd(), body, members);
    }

    public void WriteContent(ItemRef item, ItemContent content)
    {
        WriteOne(item, content.Kind, content.Declaration, content.Body);
        if (content.Members.Count == 0) return;

        // ONE walk, and ORDINAL-IGNORE-CASE — the CODESYS fix from earlier today, reaching its TwinCAT twin.
        //
        // This resolved each member by re-walking the whole POU per member (every step a live COM round trip),
        // and compared names with `StringComparer.Ordinal` — the last Ordinal IDENTITY compare left on the wire.
        // Every layer above it is OrdinalIgnoreCase (`ReconcileMembers`, `OnlyChanged`, `BodyFormatGuard`,
        // `ItemLookup`, `TreeNav.NameIs`), and IEC identifiers are case-insensitive in both IDEs. So a case-only
        // rename — `METHOD Calc` to `METHOD calc` — passed every gate, the POU's own declaration and body were
        // already written on the line above, and THEN this threw NOT_FOUND claiming the member is not in the
        // project. False, and half-applied.
        var byName = new Dictionary<string, ItemRef>(StringComparer.OrdinalIgnoreCase);
        foreach (var site in Volt.Engine.Ide.MemberSites.Of(this, item)) byName[site.Name] = site.Ref;

        foreach (var m in content.Members)
        {
            if (!byName.TryGetValue(m.Name, out var target))
                throw new BridgeException(BridgeErrorCodes.NotFound,
                    $"'{m.Name}': the member is in the pushed source but not in the project — creating members " +
                    "is the push service's job, and writing through a missing one would land nothing");

            WriteOne(target, m.Kind, m.Kind == ItemKind.Kinds.Action ? null : m.Declaration, m.Body);
            // The accessor's own kind, decided by the OWNER - the same rule the member kind follows. Passing
            // the POU code for an interface property would make the crash guard in WriteAccessor unreachable.
            var itfProp = m.Kind == ItemKind.Kinds.InterfaceProperty;
            WriteAccessor(target, itfProp ? ItemKind.PlcItfPropGet : ItemKind.PlcPropGet, m.Getter);
            WriteAccessor(target, itfProp ? ItemKind.PlcItfPropSet : ItemKind.PlcPropSet, m.Setter);
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
            var language = ViewModeOf(impl);
            if (language is null) return BodyMarker.For("IL");

            var model = TcNetworkReader.Read(impl, language.Value);
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
    private static BodyLanguage? ViewModeOf(XElement impl)
    {
        var mode = TcArchive.ViewMode(impl) ?? "Fbd";
        if (mode.Equals("Ld", StringComparison.OrdinalIgnoreCase)) return BodyLanguage.Ld;
        if (mode.Equals("Fbd", StringComparison.OrdinalIgnoreCase)) return BodyLanguage.Fbd;

        // NULL means "a view Volt does not author" - IL, today - and the caller turns that into the MARKER,
        // exactly as CODESYS does. Throwing here instead took the WHOLE ENCLOSING POU out of git: SafeVersion
        // swallows the throw to UNREADABLE and FetchService then skips the item, so one IL-view METHOD inside an
        // ordinary ST function block removed the declaration, the body and every sibling method too - and
        // PushService's `live = ide.ReadContent(pou)` threw, so it could not be pushed back either.
        //
        // This is the CODESYS fix (audit defect #4, eaacd48cd3) reaching its TwinCAT twin. Both vendors must
        // answer identically for the same project, and this is the same fact on the same object model.
        if (mode.Equals("IL", StringComparison.OrdinalIgnoreCase)) return null;

        throw new NotSupportedException(
            $"TwinCAT: the graphical body's view mode is '{mode}', which Volt has never seen. FBD and LD are " +
            "authored, IL materializes as a marker - an unknown fourth view is refused rather than guessed at.");
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

            // CREATE takes the other door. The archive writer cannot build a body - a BoxTreeBox carries
            // members the IDE RESOLVES (InputParam, CallType, EN, ENO, Id) and guessing them wrote twenty
            // unopenable .TcPOU files - so a body the IDE does not have yet is stated as PLCopen TOPOLOGY and
            // the IDE resolves it. That is also Beckhoff's own documented route: PlcOpenImport is the one API
            // they document that carries a graphical body. An EXISTING body never comes this way; it is edited
            // in place, where every id and every unmodelled member survives untouched.
            // Blank, or an archive the engineer has drawn nothing into. NOT "TcArchive.Root(existing) is
            // null" - that is also true of a TEXTUAL body, and routing those here would silently convert live
            // ST into a diagram instead of refusing, which is what TcNetworkWriter is for.
            var live = TcArchive.Root(existing);
            if (string.IsNullOrWhiteSpace(existing) || (live != null && TcArchive.HasNoItems(live)))
            {
                var name = _om.GetName(item.Native);
                var created = _om.ImportPlcOpen(item.Native,
                    TcPlcOpenWriter.WriteProject(name, PlcOpenPouType(kind), model));

                // The declaration goes through DeclarationText - the documented path, and the one every other
                // write here already uses. (It COULD ride in the document: the vendor spells it
                // `plcopenxml/interfaceasplaintext`, not the `plcopenxml/declaration` a first attempt guessed,
                // which is why that attempt silently lost every VAR block. One source of truth is better.)
                //
                // The VIEW travels with neither. A ladder is imported as FBD, because that is the only shape the
                // importer accepts, and is made a ladder again by the archive's own `DefaultViewMode` - the same
                // place `CreateChild` leaves it (DIALECT C6). Without this an engineer who pushed a ladder opens
                // the IDE and finds a function-block diagram: the program is right, the drawing is not the one
                // they wrote.
                var view = model.Language == BodyLanguage.Ld ? "Ld" : "Fbd";
                var revised = TcArchive.WithViewMode(_om.ReadImplementation(created), view);
                _om.WriteText(created, declaration, revised);
                return;
            }

            var updated = TcNetworkWriter.Apply(existing, model);
            // A null means the archive already says exactly this: writing it back would rewrite ids and
            // vendor members for no change at all.
            _om.WriteText(item.Native, declaration, updated);
            return;
        }

        // A marker is informational and is never written back over a live CFC/SFC body.
        // And NULL for a kind with no implementation slot: a DUT, a GVL and an interface do not have one, and
        // TwinCAT's COM object does not expose the member at all — writing to it throws
        // "'System.__ComObject' does not contain a definition for 'ImplementationText'". PushService used to
        // make this decision from the item's kind code; it moved here with the rest of the write.
        _om.WriteText(item.Native, declaration,
                      HasBodySlot(kind) && !BodyMarker.Is(body) ? body : null);
    }

    /// <summary>The PLCopen <c>pouType</c> for a Volt kind. Only the three kinds that can HOLD a graphical body
    /// are here; anything else reaching this point is a bug upstream, not a case to default.</summary>
    private static string PlcOpenPouType(string kind) => kind switch
    {
        ItemKind.Kinds.Program => "program",
        ItemKind.Kinds.FunctionBlock => "functionBlock",
        ItemKind.Kinds.Function => "function",
        // NOT "a {kind} cannot hold a graphical body" - a METHOD or an ACTION certainly can, and saying
        // otherwise sends the reader looking for the wrong thing. What is true is narrower: a member has no
        // document of its own (DIALECT D4j - `ExportChild` refuses one, because TwinCAT keeps the whole POU in
        // ONE .TcPOU), so it cannot be the subject of a PLCopen import. Creating one needs the ENCLOSING POU
        // imported with the member inside it, which this path does not do.
        _ => throw new NotSupportedException(
            $"TwinCAT: cannot create a graphical body for a '{kind}' - only a whole POU can be imported, and a " +
            "member has no document of its own. Create it in the IDE and pull it."),
    };

    /// <summary>Does this kind have an implementation-body slot at all? A DUT, a GVL and an interface do not -
    /// their whole content is the declaration - and an interface METHOD has only a signature.
    /// <para>A PROPERTY does not either, on either vendor: its code lives in the GET and SET accessors, which
    /// travel as <c>Getter</c>/<c>Setter</c> and are written separately. Without it here, creating an FB with a
    /// property crashed the push with "'System.__ComObject' does not contain a definition for
    /// 'ImplementationText'" - the COM object does not expose the member at all, which is exactly what this
    /// predicate exists to know.</para></summary>
    private static bool HasBodySlot(string kind) =>
        kind is not (ItemKind.Kinds.Dut or ItemKind.Kinds.Gvl or ItemKind.Kinds.Interface
                     or ItemKind.Kinds.Property or ItemKind.Kinds.InterfaceProperty
                     or ItemKind.Kinds.InterfaceMethod);

    // ── members ───────────────────────────────────────────────────────────────────────────────────


    private Member ReadMember(Volt.Engine.Ide.MemberSites.Site site)
    {
        var kind = ItemKind.Map(site.Code) ?? ItemKind.Kinds.Method;

        Accessor? getter = null, setter = null;
        if (site.Code == ItemKind.PlcItfProp)
        {
            // An INTERFACE property's accessors are read WITHOUT touching them: enumerating their COM children
            // can hard-crash TcXaeShell, so presence comes from the enclosing interface's own XML. They are
            // bodiless by definition - an interface accessor declares that a getter/setter exists and nothing
            // more - so presence IS the whole object, and an empty Accessor is the right one to hand back.
            var (hasGet, hasSet) = InterfacePropertyAccessors(site.Ref);
            if (hasGet) getter = new Accessor(null, null);
            if (hasSet) setter = new Accessor(null, null);
        }
        else if (site.Code == ItemKind.PlcProp)
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
        new Accessor(AccessorDeclaration.Keep(_om.ReadDeclaration(acc.Native)), ReadBody(acc));

    /// <summary><b>An ACTION is the one member with no declaration to read</b>: IEC gives an action a name and
    /// a body and nothing else, and Beckhoff's own object model says so — <c>_ITcPlcImplementation</c> exposes
    /// <c>ImplementationText</c> and no <c>DeclarationText</c>. Its header is COMPOSED here rather than read;
    /// that is not a fallback for a missing value, it is the whole of what an action's header is.</summary>
    private string MemberDeclaration(Volt.Engine.Ide.MemberSites.Site site)
    {
        if (site.Code == ItemKind.PlcAction) return $"ACTION {site.Name}";

        var decl = _om.ReadDeclaration(site.Ref.Native);
        if (string.IsNullOrWhiteSpace(decl))
            throw new BridgeException(BridgeErrorCodes.InternalError,
                $"'{site.Name}': the IDE reports no declaration for this member — that is a broken item, not a " +
                "transport gap");
        return decl.Trim();
    }


    /// <summary>Write a property's GET or SET. The accessor EXISTS by the time this runs - creating and deleting
    /// one is <c>PushService.ReconcileAccessor</c>'s job, with every other child - so a null here means only
    /// "nothing to write", never "remove it".
    ///
    /// <para><b>An INTERFACE property accessor is a bodiless stub and must never be written to.</b> It declares
    /// that a getter/setter exists and nothing more. TwinCAT COM rejects a declaration/implementation write on
    /// one and can HARD-CRASH the IDE (RPC 0x800706BE - DIALECT D21), on read as well as write - measured, and the reason the
    /// original fix created these as bodiless "ST" stubs and wrote nothing. The rule was lost with the PLCopen
    /// transport, where the import wrote the whole object at once and never touched an accessor directly.</para>
    /// </summary>
    private void WriteAccessor(ItemRef property, int code, Accessor? accessor)
    {
        if (accessor is null) return;

        // Refusing the WRITE is right (D21). Returning SILENTLY was not: the pull materializes an editable
        // `GET ... END_GET` in the .itf file, StReader re-kinds it, `PushService.Same` marks it changed,
        // `BodyFormatGuard` passes it, and the receipt bakes the pushed text into the client's baseline - so the
        // engineer's edit is discarded and `volt status` then reports in sync. "Accepted but landed nothing" is
        // the worst class there is.
        //
        // No COM read is needed to tell a change from a restatement: `ReadMember` builds an interface accessor
        // as `new Accessor(null, null)` BY CONSTRUCTION, so anything non-blank pushed at one IS a change. This
        // is the CODESYS fix (audit defect #11, eaacd48cd3) reaching its TwinCAT twin.
        if (code is ItemKind.PlcItfPropGet or ItemKind.PlcItfPropSet)
        {
            if (!string.IsNullOrWhiteSpace(accessor.Declaration) || !string.IsNullOrWhiteSpace(accessor.Body))
                throw new BridgeException(BridgeErrorCodes.Unsupported,
                    "an interface property's GET/SET carries only the fact that it exists — its declaration and " +
                    "body are not writable, and writing them can crash the IDE. Remove the edit, or make the " +
                    "change in the IDE and pull.");
            return;
        }

        int n = ChildCount(property);
        for (int i = 1; i <= n; i++)
        {
            var child = ChildAt(property, i);
            if (KindCode(child) != code) continue;
            WriteOne(child, ItemKind.Map(code) ?? "", accessor.Declaration, accessor.Body);
            return;
        }
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
