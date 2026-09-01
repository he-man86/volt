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
        // MEMBERS FIRST, THE POU ITSELF LAST — and the order is load-bearing on this vendor.
        //
        // A member is not a separate file on TwinCAT: the whole POU, members and all, lives in ONE .TcPOU
        // (DIALECT D4j). Writing a member therefore rewrites the enclosing POU's file, and measured, that
        // rewrite does not carry the parent's own just-written implementation: with the POU written first, an FB
        // with a graphical ACTION came back with its `out := a;` body GONE, while the identical fixture with a
        // METHOD kept it. The action's own body arrived correctly both times, so nothing about the member write
        // was wrong - it simply landed on top of a parent state that predated the parent's write.
        //
        // Writing the POU last makes that unorderable: every child mutation is already done, so there is nothing
        // left to rewrite the file underneath it. It also matches what the push already assumes one level up,
        // where `PushService` re-resolves the POU after reconciling members because a member create invalidates
        // its handle.
        if (content.Members.Count == 0) { WriteOne(item, content.Kind, content.Declaration, content.Body); return; }

        // ONE walk, and ORDINAL-IGNORE-CASE — the CODESYS fix from earlier today, reaching its TwinCAT twin.
        //
        // This resolved each member by re-walking the whole POU per member (every step a live COM round trip),
        // and compared names with `StringComparer.Ordinal` — the last Ordinal IDENTITY compare left on the wire.
        // Every layer above it is OrdinalIgnoreCase (`ReconcileMembers`, `OnlyChanged`, `BodyFormatGuard`,
        // `ItemLookup`, `TreeNav.NameIs`), and IEC identifiers are case-insensitive in both IDEs. So a case-only
        // rename — `METHOD Calc` to `METHOD calc` — passed every gate, the POU's own declaration and body were
        // already written on the line above, and THEN this threw NOT_FOUND claiming the member is not in the
        // project. False, and half-applied.
        // A MEMBER'S GRAPHICAL BODY GOES IN FIRST, THROUGH THE POU'S OWN ARCHIVE — and the ORDER is the whole
        // difference between this working and not.
        //
        // `ImplementationText` cannot carry one: on a POU already holding an NWL archive TwinCAT replaces the
        // archive, but on a METHOD, an ACTION or a property ACCESSOR the same assignment stores it as ST TEXT,
        // and the project stops compiling (`Unexpected Token '<' found`). The archive route can — it is what
        // `MoveMember` already uses, because a member is not a file.
        //
        // But `ExportChild` DOES NOT SEE TREE-NODE WRITES (D32, measured directly: the live node read back
        // `out := a;` while the archive exported in the same instant carried an empty `<ST/>`). So doing the
        // tree writes first and the archive second silently reverts them. Archive FIRST, tree writes SECOND:
        // the re-import brings back the create-time declarations, and the writes below then land on top of
        // them — while the member bodies survive, because a graphical body is passed as null there and
        // `WriteText` skips a null implementation.
        // The handles are walked BEFORE the archive write, because a member's body is resolved AGAINST the one
        // it already has — a create and an in-place edit are different operations, and only the live archive says
        // which this is (`ResolveBody`). Reading them here also moves the missing-member refusal ahead of every
        // write, so a push that cannot land in full lands nothing.
        var byName = new Dictionary<string, ItemRef>(StringComparer.OrdinalIgnoreCase);
        foreach (var site in Volt.Engine.Ide.MemberSites.Of(this, item)) byName[site.Name] = site.Ref;

        foreach (var m in content.Members)
            if (!byName.ContainsKey(m.Name))
                throw new BridgeException(BridgeErrorCodes.NotFound,
                    $"'{m.Name}': the member is in the pushed source but not in the project — creating members " +
                    "is the push service's job, and writing through a missing one would land nothing");

        var graphical = new List<(string[] Path, string Nwl)>();
        foreach (var m in content.Members)
        {
            var site = byName[m.Name];
            var itf = m.Kind == ItemKind.Kinds.InterfaceProperty;
            Collect(graphical, new[] { m.Name }, site, m.Body, Scope(m.Declaration, content.Declaration));
            Collect(graphical, new[] { m.Name, "Get" },
                    AccessorSite(site, itf ? ItemKind.PlcItfPropGet : ItemKind.PlcPropGet),
                    m.Getter?.Body, Scope(m.Getter?.Declaration, content.Declaration));
            Collect(graphical, new[] { m.Name, "Set" },
                    AccessorSite(site, itf ? ItemKind.PlcItfPropSet : ItemKind.PlcPropSet),
                    m.Setter?.Body, Scope(m.Setter?.Declaration, content.Declaration));
        }

        if (graphical.Count > 0)
        {
            // The round trip DELETES the POU and imports it back, so every handle read above is now dead.
            item = WriteMemberBodies(item, graphical);
            byName.Clear();
            foreach (var site in Volt.Engine.Ide.MemberSites.Of(this, item)) byName[site.Name] = site.Ref;
        }

        foreach (var m in content.Members)
        {
            if (!byName.TryGetValue(m.Name, out var target))
                throw new BridgeException(BridgeErrorCodes.NotFound,
                    $"'{m.Name}': the member is not under the POU after its archive was rewritten — refusing " +
                    "to write through a handle the re-import already killed");

            WriteOne(target, m.Kind, m.Kind == ItemKind.Kinds.Action ? null : m.Declaration, Textual(m.Body));
            // The accessor's own kind, decided by the OWNER - the same rule the member kind follows. Passing
            // the POU code for an interface property would make the crash guard in WriteAccessor unreachable.
            var itfProp = m.Kind == ItemKind.Kinds.InterfaceProperty;
            WriteAccessor(target, itfProp ? ItemKind.PlcItfPropGet : ItemKind.PlcPropGet, Textual(m.Getter));
            WriteAccessor(target, itfProp ? ItemKind.PlcItfPropSet : ItemKind.PlcPropSet, Textual(m.Setter));
        }

        WriteOne(item, content.Kind, content.Declaration, content.Body);
    }

    /// <summary>The declarations a graphical body must be resolved against: the member's own FIRST, then
    /// the POU's.
    ///
    /// <para><b>A stateful FB instance lives in the enclosing POU's VAR block, not in the member's.</b> A
    /// graphical body naming `t1(IN := a)` needs `t1 : TON;` to resolve the call's TYPE, and that
    /// declaration is one level up — so resolving against the member alone reported `'t1' names a
    /// function-block instance that is not declared in this POU`, advice pointing at work the engineer had
    /// already done. An ACTION makes it starker still: it has no declaration at all.</para>
    ///
    /// <para>Member first, because the lookup takes the FIRST match and an inner scope must win: a member's
    /// own `VAR_INPUT p : TON;` shadows a POU-level `p` exactly as IEC says it does.</para></summary>
    private static string? Scope(string? member, string? owner) =>
        string.IsNullOrWhiteSpace(member) ? owner
        : string.IsNullOrWhiteSpace(owner) ? member
        : member + "\n" + owner;

    /// <summary>Resolve one graphical member body and note it for the archive write — or note NOTHING, when
    /// the member's live archive already says exactly this.
    ///
    /// <para>THE DROP IS THE POINT. Every graphical member body used to take the CREATE route unconditionally:
    /// `ResolveGraphicalBody` builds a body from PLCopen topology, and a create is allowed to RESHAPE — TwinCAT's
    /// importer splits a network per connected component (D25), so a rung the engineer drew as ONE network came
    /// back as several, and `Stamp` then wrote the pushed titles and flags onto the new shape without ever
    /// reporting it. It also cost the in-place editor its whole reason for existing: ids, `Fixed` flags,
    /// `ILLines` and every unmodelled member of the networks nobody touched were rebuilt from scratch on each
    /// push. And a push that changed only a DECLARATION still paid for the round trip — which deletes the POU
    /// and imports it back, a window in which the item is not in the project at all.</para>
    ///
    /// <para>So the selection is <see cref="ResolveBody"/>, the SAME one <see cref="WriteOne"/> makes for a POU,
    /// against the member's own live implementation. A null verdict means no change, and a body with no change
    /// does not belong in a round trip.</para>
    ///
    /// <para>Validation still runs before anything is touched, so a refusal costs nothing.</para></summary>
    private void Collect(List<(string[] Path, string Nwl)> into,
                         string[] path, ItemRef? site, string? body, string? declaration)
    {
        if (body is not { } b || !NetworkText.Is(b)) return;
        var model = NetworkTextGate.Validate(b);           // refuse BEFORE touching the IDE

        // A null site is an accessor the property does not carry. Collecting nothing leaves the report to
        // `WriteAccessor`, which is where that case is already decided.
        var existing = site is { } s ? _om.ReadImplementation(s.Native) : null;
        if (ResolveBody(existing, model, declaration) is { } nwl) into.Add((path, nwl));
    }

    /// <summary>A property ACCESSOR's node, or null when the property does not carry one.</summary>
    private ItemRef? AccessorSite(ItemRef property, int code)
    {
        int n = ChildCount(property);
        for (int i = 1; i <= n; i++)
        {
            var child = ChildAt(property, i);
            if (KindCode(child) == code) return child;
        }
        return null;
    }

    /// <summary>The body as the TREE write should see it: unchanged when textual, NULL when it is graphical
    /// and has already gone in through the archive. `WriteText` skips a null implementation, so the archive's
    /// work survives the declaration write that follows it.</summary>
    private static string? Textual(string? body) =>
        body is { } b && NetworkText.Is(b) ? null : body;

    private static Accessor? Textual(Accessor? accessor) =>
        accessor is null || accessor.Body is not { } b || !NetworkText.Is(b)
            ? accessor
            : accessor with { Body = null };

    /// <summary>Write every already-resolved graphical member body into the POU's archive, in ONE round trip —
    /// then hand back a LIVE handle to the POU, because the re-import killed the old one (D4d).
    ///
    /// <para>One trip for all of them: each DELETES the POU before importing it back, so a property with two
    /// graphical accessors would otherwise open that window three times.</para>
    ///
    /// <para>The bodies arrive RESOLVED, from <see cref="Collect"/>. Resolving imports a scratch POU each time,
    /// and every import between reading a handle and using it is a chance to invalidate it — so all of that is
    /// behind us before the parent below is read.</para></summary>
    private ItemRef WriteMemberBodies(ItemRef item, List<(string[] Path, string Nwl)> resolved)
    {
        var parent = _om.Parent(item.Native)
            ?? throw new BridgeException(BridgeErrorCodes.NotFound,
                $"'{_om.GetName(item.Native)}' has no parent, so its archive cannot be rewritten");
        var pouName = _om.GetName(item.Native);

        _om.SetMemberBodies(parent, pouName, resolved);

        // The POU was deleted and re-imported, so every handle into it is dead. The PARENT was not replaced,
        // so it is still good to walk.
        var parentRef = new ItemRef(parent);
        for (int i = 1; i <= ChildCount(parentRef); i++)
        {
            var child = ChildAt(parentRef, i);
            if (string.Equals(_om.GetName(child.Native), pouName, StringComparison.OrdinalIgnoreCase))
                return child;
        }

        throw new BridgeException(BridgeErrorCodes.NotFound,
            $"'{pouName}' is not under its parent after the archive re-import — refusing to write through a " +
            "handle the import already killed");
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

            // AN EXECUTE BOX MAKES THE BODY UNSUPPORTED — it does not make the POU DISAPPEAR.
            //
            // Reading its ST is still unmeasured on this vendor, and the reader still refuses rather than
            // materializing a box without the code it runs. But that refusal is a THROW deep in the node walk,
            // and `Versioning.SafeVersion` isolates a throw by giving the item the Unreadable sentinel — so
            // `fetch` skipped the POU entirely and the engineer got no file at all, only a count in the
            // "N unreadable" tally. A body Volt cannot represent is exactly what the marker is for, and this
            // file already answers CFC, SFC and IL that way: the POU appears, says what it holds, and is refused
            // on push instead of vanishing from git.
            if (TcArchive.HasExecuteBox(impl)) return BodyMarker.For("EXECUTE");

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
    internal static BodyLanguage? ViewModeOf(XElement impl)
    {
        // NO `?? "Fbd"`. An archive with no DefaultViewMode is a body whose view Volt cannot determine,
        // and guessing FBD renders a ladder as a function-block diagram — the engineer's own drawing,
        // reshaped in git by a default. CODESYS demands the member (`NwlInterop.Require`) and this now
        // agrees: an absent view falls through to the null below, which the caller turns into the MARKER,
        // so the POU still appears and still says what it is.
        var mode = TcArchive.ViewMode(impl);
        if (mode == null) return null;
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

            // CREATE takes the other door. The archive writer cannot BUILD a body - a BoxTreeBox carries
            // members the IDE RESOLVES (InputParam, CallType, EN, ENO, Id) and guessing them wrote twenty
            // unopenable .TcPOU files - so a body the IDE does not have yet is stated as PLCopen TOPOLOGY, and
            // TwinCAT resolves it into an archive Volt then simply stores. That is Beckhoff's documented route:
            // PlcOpenImport is the one API they document that carries a graphical body.
            //
            // A MEMBER comes through here too, and needs nothing special: the resolution happens in a scratch
            // POU, so by the time this writes, the body is a resolved archive like any other. An EXISTING body
            // never comes this way - it is edited in place, where every id and every unmodelled member survives.
            // Blank, or an archive the engineer has drawn nothing into. Deliberately NOT "the archive root is
            // null": that is also true of a TEXTUAL body, and routing those here would silently turn live ST
            // into a diagram instead of refusing — which is what TcNetworkWriter below is for.
            _om.WriteText(item.Native, declaration, ResolveBody(existing, model, declaration));
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

    /// <summary>THE ONE PLACE that decides what a graphical body becomes: a freshly BUILT archive when the item
    /// has none yet, an in-place EDIT when it does, and NULL when the archive already says exactly this.
    ///
    /// <para>Shared by <see cref="WriteOne"/> and <see cref="Collect"/>, because a POU and a MEMBER face the
    /// identical question — and answering it in two places let them drift: the member path took the create arm
    /// every time, without reading the live body at all.</para></summary>
    private string? ResolveBody(string? existing, NetworkBody model, string? declaration)
    {
        // Blank, or an archive the engineer has drawn nothing into. Deliberately NOT "the archive root is
        // null": that is also true of a TEXTUAL body, and routing those here would silently turn live ST
        // into a diagram instead of refusing — which is what TcNetworkWriter below is for.
        var live = string.IsNullOrWhiteSpace(existing) ? null : TcArchive.Root(existing);
        if (string.IsNullOrWhiteSpace(existing) || (live != null && TcArchive.HasNoItems(live)))
        {
                // TWO STEPS, and each does only what it can do honestly.
                //
                // The import settles STRUCTURE — which boxes, wired how — because that needs the IDE's own
                // resolution. It cannot carry MODIFIERS: a negated contact or a SET coil has no PLCopen form
                // this lowering knows, and inventing one would be the guess that keeps costing.
                //
                // But by the time the import returns, the body is an ordinary archive whose shape matches the
                // pushed model exactly — which is precisely the situation the in-place writer exists for. So it
                // stamps the values on: flags, comments, titles, everything network text does carry. Neither
                // half has to learn the other's job, and a modifier no longer has to be expressible in PLCopen
                // to survive a create.
            var built = _om.ResolveGraphicalBody(model, model.Language == BodyLanguage.Ld ? "Ld" : "Fbd", declaration);
            return Stamp(built, model);
        }

            // AN EXISTING BODY IS EDITED IN PLACE, and where its SHAPE changed - a box retyped, a rung
            // rewired - the IDE rebuilds just that network. Same two mechanisms as a create, scoped to the one
            // network that changed instead of the whole body, so every network the engineer did not touch stays
            // byte for byte as the IDE wrote it: ids, Fixed flags, ILLines and all.
        // A null means the archive already says exactly this: writing it back would rewrite ids and
        // vendor members for no change at all.
        return TcNetworkWriter.Apply(existing!, model,
                                     network => RebuildNetwork(network, model.Language, declaration));
    }

    /// <summary>Have the IDE rebuild ONE network, and hand back its archive element ready to be spliced in.
    ///
    /// <para>The same scratch-POU resolution a create uses — the IDE resolves the call, Volt copies the result —
    /// only narrowed to a single network. The guard that this network is ONE connected component lives in
    /// <see cref="TcNetworkWriter"/>, which checks it from the model before this is ever called.</para></summary>
    private XElement RebuildNetwork(Network network, BodyLanguage language, string? declaration)
    {
        // RENUMBERED TO 0 for the rebuild. `localId` encodes the network index (10^10 * (order + 1)), so a
        // network carrying its real Order of 1 told the importer to build networks 0 AND 1 - it answered with
        // an empty one in front of ours, and the splice refused it as "produced 2 networks, not one". The
        // scratch POU has its own id space, and the network's real position is the slot it is spliced back
        // into, not anything the rebuild needs to know.
        var one = new NetworkBody(language, new[] { network with { Order = 0 } });
        var body = _om.ResolveGraphicalBody(one, language == BodyLanguage.Ld ? "Ld" : "Fbd", declaration);

        var impl = TcArchive.Root(body)
            ?? throw new InvalidOperationException(
                   $"TwinCAT: rebuilding network {network.Order + 1} produced no archive.");

        // Same importer, same artifact: strip the empty output operand it hangs off every box, or the
        // spliced network stops compiling exactly as a whole created body did.
        TcNetworkWriter.DropImporterBoxOutputs(impl);

        var rebuilt = TcArchive.List(impl, "NetworkList");
        if (rebuilt.Count != 1)
            throw new InvalidOperationException(
                $"TwinCAT: rebuilding network {network.Order + 1} produced {rebuilt.Count} networks, not one. " +
                "The importer groups by connected rung (DIALECT D25); splicing this back would renumber the " +
                "networks after it, so the push is failed rather than applied.");

        return new XElement(rebuilt[0]);
    }

    /// <summary>Stamp onto a freshly imported body everything the import could not carry — flags, titles,
    /// comments, a disabled network — and say so plainly when that is impossible.
    ///
    /// <para><b>The import decides its own network boundaries.</b> Measured: a network holding two disconnected
    /// statements (<c>t1(IN := a, PT := pt); done := t1.Q;</c>) comes back as TWO networks, because PLCopen FBD
    /// has no network element and the importer groups by what is actually wired together. So the archive's shape
    /// is the IDE's answer, not a copy of the pushed model, and the in-place writer — which requires the two to
    /// agree — legitimately refuses on it.</para>
    ///
    /// <para>That refusal must not become a blanket failure, and must not become a silent shrug either. When the
    /// model carries nothing beyond structure, the IDE's own grouping IS the right answer and is kept. When it
    /// carries DETAIL the import cannot express — a negated contact, a SET coil, a network title, a disabled
    /// network — that detail would be lost, so the push fails instead of reporting success over a body missing
    /// the very thing the engineer wrote.</para></summary>
    private static string Stamp(string built, NetworkBody model)
    {
        // The importer hangs an EMPTY output operand off every box, which the compiler reads as the box's
        // result going nowhere — see TcNetworkWriter.DropImporterBoxOutputs. Repaired before the values are
        // stamped, so the change gate below compares against an archive that is already right.
        built = TcNetworkWriter.DropImporterBoxOutputs(built);

        try
        {
            return TcNetworkWriter.Apply(built, model) ?? built;
        }
        catch (NotSupportedException) when (!CarriesDetail(model) && !LostNetworks(built, model))
        {
            // Nothing to lose: the body is exactly what was pushed, grouped the way the IDE groups it.
            return built;
        }
    }

    /// <summary>Did the import come back with FEWER networks than were pushed?
    ///
    /// <para><b>The direction is the whole point.</b> D25's regrouping — the importer emitting one network per
    /// connected component — can only ever produce the SAME number or MORE, because it splits and never merges.
    /// So "more" is the measured, licensed outcome and the swallow above is right to accept it. FEWER is not
    /// regrouping at all; it is LOSS, and the known case is an EMPTY network, which PLCopen cannot state because
    /// it has no network element (D25) and the archive cannot be constructed to reinsert one (N11/N12).</para>
    ///
    /// <para>That loss is forced. Reporting the push as APPLIED over it was not: the engineer's empty network
    /// vanished and the wire said success. Now the refusal propagates, so a body that cannot be created says so
    /// instead of arriving incomplete.</para></summary>
    private static bool LostNetworks(string built, NetworkBody model) =>
        TcArchive.Root(built) is { } impl && TcArchive.List(impl, "NetworkList").Count < model.Networks.Count;

    /// <summary>Anything network text carries that a PLCopen import does not: item modifiers and the
    /// per-network metadata (<c>Title</c>, <c>Label</c>, <c>Comment</c>, <c>OutCommented</c>).</summary>
    private static bool CarriesDetail(NetworkBody model) =>
        model.Networks.Any(n =>
            !string.IsNullOrEmpty(n.Title) || !string.IsNullOrEmpty(n.Label) ||
            !string.IsNullOrEmpty(n.Comment) || n.Disabled ||
            n.Trees.Any(HasFlags));

    private static bool HasFlags(Node node)
    {
        if (!node.Flags.IsNone) return true;
        return node switch
        {
            Leaf l => l.Operand.Flags is { IsNone: false },
            Assign a => a.Targets.Any(t => t.Flags is { IsNone: false }) || (a.Value is { } v && HasFlags(v)),
            Box b => b.Instance?.Flags is { IsNone: false }
                     || b.Outputs.Any(o => o.Flags is { IsNone: false })
                     || b.Inputs.Any(i => !i.Flags.IsNone || HasFlags(i.Value))
                     || (b.Enable is { } e && HasFlags(e)),
            Volt.Engine.Format.Network.Parallel p =>
                (p.Input is { } pi && HasFlags(pi)) || p.Branches.Any(HasFlags),
            Terminator t => t.Input is { } ti && HasFlags(ti),
            Demux d => d.Input is { } di && HasFlags(di),
            _ => false,
        };
    }

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
            // Live state is BLANK by construction here — `ReadMember` builds an interface accessor as
            // `new Accessor(null, null)` — so anything non-blank pushed at one IS a change, and no COM read is
            // needed to tell. Passing the blanks explicitly is what lets the refusal itself be shared.
            InterfaceAccessorGuard.RefuseIfChanged(null, null, accessor.Declaration, accessor.Body);
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

        // A `.device` → the identity descriptor, NOT this document. `ProduceXml` on a device is its whole
        // settings dump (2.9KB for an EtherCAT master, 10.6KB for an EK1100 coupler) carrying the engineer's own
        // `AmsNetId`, fieldbus addresses and DC timing — machine-specific bytes that would land in a git
        // repository and, because this text is the version-hash input, would rewrite the file on every unrelated
        // fieldbus tweak. CODESYS answers with a short identity block; so does this. See TcDeviceDescriptor.
        if (kind == ItemKind.Kinds.Device) return TcDeviceDescriptor.From(xml) ?? ItemKind.EmptyManifest(kind);

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
