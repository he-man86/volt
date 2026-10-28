using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Xml.Linq;
using Volt.Contracts;
using Volt.Engine;
using Volt.Engine.Format.Body;
using Volt.Engine.Format.Task;
using Volt.Engine.Format.Network;
using Volt.Engine.Format.Settings;
using Volt.Engine.Format.St;
using Volt.Engine.Ide;
using Volt.Engine.Item;
using Volt.Engine.Library;

namespace Volt.Ide.Twincat;

/// <summary>
/// Beckhoff driver — the content facet (its IEC record: <c>ReadContent</c>/<c>WriteContent</c>). Declarations and bodies travel the COM object model
/// (<c>DeclarationText</c> / <c>ImplementationText</c>); a graphical body is the IDE's OWN
/// <c>&lt;NWL&gt;</c> archive — built natively where the item has none (<see cref="TcArchiveBuilder"/>), edited in place
/// where it has one. No PLCopen is written or read on this vendor (openspec twincat-inproc-host): TwinCAT's PLCopen
/// export carries no <c>InterfaceAsPlainText</c>, drops network metadata and disabled networks, cannot replace in
/// place and reformats declarations on a round trip with no edit.
/// </summary>
public sealed partial class BeckhoffDriver
{
    public ItemContent ReadContent(ItemRef item)
    {
        var declaration = _om.ReadDeclaration(Com(item));
        var (body, unsupported, stated) = ReadBody(item, declaration);

        // The saved file is read ONCE for the item: its properties and, for an interface, its accessors' stored text. Before
        // the members: a member's exclusion is read against its POU's (C39 — every member of an excluded POU reads inherited).
        var facts = _om.SavedFacts(Com(item), () => $"'{Name(item)}'");
        var ownerExcluded = facts.Build.Exclusion == TcExclusion.Own;

        var members = new List<Member>();
        var ownerIsInterface = KindCode(item) == ItemKind.PlcItf;
        foreach (var site in Volt.Engine.Ide.MemberSites.Of(this, item))
            members.Add(ReadMember(site, ownerIsInterface, declaration, ownerExcluded));

        if (ownerIsInterface) RequireMeasuredAccessorDeclarations(() => Name(item), facts, members);

        // Every text verbatim, trailing newlines included (openspec bridge-one-to-one §1.1, trailing-newline-cache).
        return new ItemContent(KindOf(item), declaration, body, members, ReadProperties(item, facts), unsupported, stated);
    }

    /// <summary>What TwinCAT stores as EVERY interface property accessor's declaration — <c>PUBLIC</c> / <c>VAR</c> /
    /// <c>END_VAR</c> (measured, <c>tc-itf-accessor-decl</c>): a MEASURED CONSTANT of the vendor, which no automation path
    /// writes or reads (D21), spelled as the empty declaration a CODESYS interface accessor holds (D41).</summary>
    internal const string MeasuredInterfaceAccessorDeclaration = "PUBLIC\nVAR\nEND_VAR";

    /// <summary>An interface accessor's STORED declaration is read from the saved <c>.TcIO</c> and held to the measured
    /// constant (design §1.1 interface accessor declaration, gate 1; gate review of step 3, finding 5): any other text is
    /// refused BY NAME — unread, a stored <c>VAR x : INT; END_VAR</c> would pull as the empty
    /// declaration. An accessor the saved file does not hold is an unsaved edit, and its stored text is unknown: refused by
    /// name too, with the remedy.</summary>
    private static void RequireMeasuredAccessorDeclarations(Func<string> itf, TcSavedFacts facts, IReadOnlyList<Member> members)
    {
        foreach (var m in members)
        {
            if (m.Kind != ItemKind.Kinds.InterfaceProperty) continue;
            facts.InterfaceAccessors.TryGetValue(m.Name, out var stored);
            Require(m.Name, "GET", m.Getter is not null, stored.Get);
            Require(m.Name, "SET", m.Setter is not null, stored.Set);
        }

        void Require(string property, string accessor, bool present, string? declaration)
        {
            if (!present) return;
            string What() => $"'{itf()}' ({System.IO.Path.GetFileName(facts.File)}): its property '{property}' {accessor}";
            if (declaration is null)
                throw new BridgeException(BridgeErrorCodes.Unreadable,
                    $"{What()} is not in the saved file — save the project in the IDE (File > Save All) and pull again: Volt " +
                    "reads the accessor's stored declaration from that file, since TwinCAT answers it on no other path (D21).");
            // Both stored forms the vendor was seen to save are the empty declaration the text spells: the measured
            // constant, and the EMPTY declaration of a vendor-saved file (`fixtures/tc-pou/ITF1.TcIO`, ProductVersion
            // 3.1.4024.16: `<![CDATA[]]>` under GET and SET) — second review of step 3, finding 3: only the constant was
            // admitted, so such an interface was refused on pull with no remedy.
            if (declaration.Length != 0 && declaration != MeasuredInterfaceAccessorDeclaration)
                throw new BridgeException(BridgeErrorCodes.Unsupported,
                    $"{What()} stores the declaration '{declaration.Replace("\n", " / ")}' — TwinCAT stores 'PUBLIC / VAR / " +
                    "END_VAR' on every interface accessor it makes (tc-itf-accessor-decl), a 3.1.4024.16 save stores none " +
                    "(ITF1.TcIO); Volt spells either as the empty declaration, and no automation path reads or writes " +
                    "another (D21), so the interface is not pulled rather than pulled without it.");
        }
    }

    /// <summary>The <c>.plcproj</c> build entries that are the save's copy of a live property the item publishes (C39,
    /// C40), whatever their value — and <c>SubType</c>.</summary>
    private static readonly HashSet<string> SavedCopies = new(StringComparer.Ordinal)
    {
        "SubType", "ExcludeFromBuild", TcObjectModel.LinkAlwaysProperty, TcObjectModel.ExternalProperty,
        TcObjectModel.CompilerDefinesProperty, TcObjectModel.AdditionalAllocationProperty,
    };

    /// <summary>The object's properties on TwinCAT (openspec bridge-one-to-one §1.1 "TwinCAT and the object-property
    /// lines"): its LIVE build properties (DIALECT C39, C40) — <c>%EXCLUDE_FROM_BUILD</c> for its own <c>Exclude</c> flag,
    /// <c>%LINK_ALWAYS</c>, <c>%EXTERNAL</c>, <c>%COMPILER_DEFINES</c> — and no measured member for any other key; an
    /// object whose SAVED files hold what the text cannot say is refused by name, never read as a plain one: a
    /// <c>SpecialFunc</c> other than <c>None</c> (the vocabulary is unmeasured, <c>tc-special-classes</c>, DIALECT C2s), an
    /// <c>&lt;ObjectProperties&gt;</c> archive other than the SFC body's (which travels with its unsupported body), or a
    /// <c>.plcproj</c> build entry that is no copy of a live property (<see cref="SavedCopies"/>).</summary>
    private ObjectProperties ReadProperties(ItemRef item, TcSavedFacts facts)
    {
        string What() => $"'{Name(item)}' ({System.IO.Path.GetFileName(facts.File)})";   // named only when refused
        if (facts.SpecialFunc is { } special && special != "None")
            throw new BridgeException(BridgeErrorCodes.Unsupported,
                $"{What()} is a TwinCAT special function (SpecialFunc=\"{special}\") — its class has no measured spelling " +
                "on TwinCAT (tc-special-classes, DIALECT C2s), so it is not pulled as a plain POU.");
        if (facts.ObjectPropertyClasses.FirstOrDefault(c => c != "SFCProperty") is { } property)
            throw new BridgeException(BridgeErrorCodes.Unsupported,
                $"{What()} holds the object property '{property}' — TwinCAT has no measured member Volt can spell for it, " +
                "so the object is not pulled without it.");
        if (_om.CompileEntry(facts.File).FirstOrDefault(e => !SavedCopies.Contains(e)) is { } entry)
            throw new BridgeException(BridgeErrorCodes.Unsupported,
                $"{What()}: its .plcproj entry holds <{entry}> — a build property TwinCAT has no measured member for in " +
                "Volt's text, so the object is not pulled.");
        // An item under an excluded folder is named by the walk and never read (WalkInner); one TwinCAT reads as excluded
        // from above (`readonly`) was refused by the read itself (TcObjectModel.ExclusionOf, C39).
        return Spelled(facts.Build);
    }

    /// <summary>The lines live build properties spell (C39, C40): an exclusion only when it is the node's own.</summary>
    private static ObjectProperties Spelled(TcBuild build) => ObjectProperties.None with
    {
        ExcludeFromBuild = build.Exclusion == TcExclusion.Own,
        LinkAlways = build.LinkAlways,
        External = build.External,
        CompilerDefines = build.CompilerDefines,
    };

    /// <summary>A member's own build properties (C39, C40). Inside an excluded POU (<paramref name="ownerExcluded"/>) its
    /// exclusion reads inherited — the POU's, whose own line says so; read anywhere else, it is refused by name. TwinCAT
    /// shows no member flag of its own under an excluded POU. The others are always its own.</summary>
    private ObjectProperties MemberProperties(ItemRef member, string name, bool ownerExcluded) =>
        Spelled(_om.Build(Com(member), () => $"'{name}'", ownerExcluded));

    /// <summary>Write each pushed build property that differs from the live one (C39, C40) — the item's and every pushed
    /// member's — AFTER the text, so nothing a text write rewrites can undo it. An item being included goes first and one
    /// being excluded last: TwinCAT shows a member of an excluded POU as excluded by its POU, with no flag of its own to
    /// set.</summary>
    private void WriteBuildProperties(ItemRef item, ItemContent content)
    {
        string Item() => $"'{Name(item)}'";
        var live = _om.Build(Com(item), Item, ownerExcluded: false);
        var held = live.Exclusion == TcExclusion.Own;
        var pushed = content.Properties.ExcludeFromBuild;
        if (held && !pushed) _om.WriteExclusion(Com(item), false, Item);
        WriteOwn(Com(item), live, content.Properties, Item);

        if (content.Members.Count > 0)
        {
            var sites = new Dictionary<string, ItemRef>(StringComparer.OrdinalIgnoreCase);
            foreach (var site in Volt.Engine.Ide.MemberSites.Of(this, item)) sites[site.Name] = site.Ref;
            foreach (var m in content.Members)
            {
                if (!sites.TryGetValue(m.Name, out var member)) continue;   // the member write refused it by name
                string What() => $"'{Name(item)}': its {m.Kind.Replace('_', ' ')} '{m.Name}'";
                // Excluded while its members are read only when it was and stays so (included first, excluded last).
                var memberLive = _om.Build(Com(member), What, ownerExcluded: held && pushed);
                if (memberLive.Exclusion == TcExclusion.Own != m.Properties.ExcludeFromBuild)
                    _om.WriteExclusion(Com(member), m.Properties.ExcludeFromBuild, What);
                WriteOwn(Com(member), memberLive, m.Properties, What);
            }
        }

        if (!held && pushed) _om.WriteExclusion(Com(item), true, Item);
    }

    /// <summary>Write <c>LinkAlways</c>, <c>External</c> and <c>CompilerDefines</c> where the pushed value differs from the
    /// live one, each by its own <c>ConsumeXml</c>, read back (C40).</summary>
    private void WriteOwn(object node, TcBuild live, ObjectProperties pushed, Func<string> what)
    {
        static string Flag(bool on) => on ? "True" : "False";
        if (live.LinkAlways != pushed.LinkAlways)
            _om.WriteBuildProperty(node, TcObjectModel.LinkAlwaysProperty, Flag(pushed.LinkAlways), what);
        if (live.External != pushed.External)
            _om.WriteBuildProperty(node, TcObjectModel.ExternalProperty, Flag(pushed.External), what);
        if (live.CompilerDefines != pushed.CompilerDefines)
            _om.WriteBuildProperty(node, TcObjectModel.CompilerDefinesProperty, pushed.CompilerDefines ?? "", what);
    }

    /// <summary>The push pre-flight's property refusal (<c>IVendorStore.ValidateProperties</c>): <c>%EXCLUDE_FROM_BUILD</c>,
    /// <c>%LINK_ALWAYS</c>, <c>%EXTERNAL</c> and <c>%COMPILER_DEFINES</c> are the item's or member's live build properties,
    /// written by <see cref="WriteBuildProperties"/> (DIALECT C39, C40); TwinCAT has no measured member for any other
    /// <c>%</c>-key (design §1.1), so a text carrying one is refused by name — never dropped.</summary>
    public void ValidateProperties(string what, ObjectProperties pushed, bool create)
    {
        var lines = Volt.Engine.Format.St.PropertyLines.Write(pushed with
        {
            Class = null, ExcludeFromBuild = false, LinkAlways = false, External = false, CompilerDefines = null,
        });
        if (lines.Count == 0) return;
        var key = lines[0].Split(' ')[0];
        throw new BridgeException(BridgeErrorCodes.Unsupported,
            $"{what}: TwinCAT: no measured member for {key} — Volt writes no object property on TwinCAT (openspec " +
            "bridge-one-to-one §1.1), so the push is refused rather than the line dropped. Remove the line, or set the " +
            "property in the IDE.");
    }

    /// <summary>The push pre-flight's interface-accessor refusal (<c>IVendorStore.ValidateAccessor</c>): ANY
    /// declaration or body, since <c>ReadMember</c> builds an interface accessor as <c>new Accessor(null, null)</c> and
    /// writing one can crash TcXaeShell (DIALECT D21). The write refuses by this same call.</summary>
    public void ValidateInterfaceAccessor(Accessor pushed) =>
        InterfaceAccessorGuard.RefuseIfChanged(null, null, pushed.Declaration, pushed.Body);

    /// <summary>The push PRE-FLIGHT: refuse a body this driver could not write, before anything is written.
    ///
    /// <para>The native builder (<see cref="TcArchiveBuilder"/>) is pure: it builds the archive a CREATE writes, and
    /// throws on every shape it refuses (a <c>PARALLEL</c>, a pin flag, ...) before the IDE is touched - so running it
    /// here moves the whole family in front of the first write, and a two-item push carrying one of them writes nothing.</para>
    ///
    /// <para><b>The models are the engine's</b> (openspec bridge-refusal-review 2.27, D8/D12): it validated each body
    /// against its own scope a moment ago.</para>
    ///
    /// <para><b>Per BODY</b> (openspec bridge-refusal-review 2.28, D21): the build runs for exactly the bodies the write
    /// would CREATE - every body of a new item (<paramref name="existing"/> null), and in an existing item each body whose
    /// live implementation <see cref="CreatesBody"/> sends to the builder, the one rule <see cref="ResolveBody"/> writes
    /// by. A body the write EDITS in place is judged network by network there.</para></summary>
    public void ValidateSource(ItemRef? existing, IReadOnlyList<PushedNetworkBody> bodies)
    {
        Dictionary<string, Volt.Engine.Ide.MemberSites.Site>? members = null;
        foreach (var body in bodies)
        {
            if (existing is { } item && !Creates(item, body.Site, ref members)) continue;
            // Only whether the build throws: a member's refusal names the member, as the op names only the item.
            try { Created(body.Model, body.Scope); }
            catch (NotSupportedException ex) when (ex.GetType() == typeof(UnsupportedException) && body.Site.Member is not null)
            {
                throw new UnsupportedException($"{body.Site}: {ex.Message}", ex);
            }
            catch (NetworkTextException ex) when (body.Site.Member is not null)
            {
                throw new NetworkTextException($"{body.Site}: {ex.Message}", ex.Code) { Line = ex.Line };
            }
        }
    }

    /// <summary>Would the write CREATE the body at <paramref name="site"/> of the existing <paramref name="item"/>?
    /// Asked of the live tree exactly as the write asks it (<see cref="Collect"/>, <see cref="WriteOne"/>).</summary>
    private bool Creates(ItemRef item, BodySite site, ref Dictionary<string, Volt.Engine.Ide.MemberSites.Site>? members)
    {
        if (site.Member is not { } name) return CreatesBody(_om.ReadImplementation(Com(item)));

        members ??= Volt.Engine.Ide.MemberSites.Of(this, item)
            .GroupBy(s => s.Name, StringComparer.OrdinalIgnoreCase)
            .ToDictionary(g => g.Key, g => g.First(), StringComparer.OrdinalIgnoreCase);
        // Not held under this name AND kind: the reconciler creates it (a retyped member is deleted and created again).
        if (!members.TryGetValue(name, out var member)
            || ItemKind.MemberKind(member.Code, KindCode(item) == ItemKind.PlcItf, member.Name) != site.MemberKind) return true;
        if (site.Accessor is not { } accessor) return CreatesBody(_om.ReadImplementation(Com(member.Ref)));

        var itf = site.MemberKind == ItemKind.Kinds.InterfaceProperty;
        var code = accessor == BodySite.Get ? (itf ? ItemKind.PlcItfPropGet : ItemKind.PlcPropGet)
                                            : (itf ? ItemKind.PlcItfPropSet : ItemKind.PlcPropSet);
        return AccessorSite(member.Ref, code) is not { } node || CreatesBody(_om.ReadImplementation(Com(node)));
    }

    /// <summary>Does the write take the CREATE door for a body whose live implementation is <paramref name="existing"/>?
    /// Blank, or an archive the engineer has drawn nothing into. Deliberately NOT "the archive root is null": that is
    /// also true of a TEXTUAL body, and routing those to the builder would silently turn live ST into a diagram instead
    /// of refusing — which is what <see cref="TcNetworkWriter"/> is for. The ONE rule: <see cref="ResolveBody"/> writes
    /// by it and the pre-flight builds by it.</summary>
    private static bool CreatesBody(string? existing) =>
        string.IsNullOrWhiteSpace(existing) || (TcArchive.Root(existing) is { } live && TcArchive.HasNoItems(live));

    public void WriteContent(ItemRef item, ItemContent content, IReadOnlyList<PushedNetworkBody> bodies)
    {
        // A member's own exclusion inside a POU the text excludes is refused before anything is written: TwinCAT shows such
        // a member as excluded by its POU, with no flag of its own to read or set (C39).
        if (content.Properties.ExcludeFromBuild && content.Members.FirstOrDefault(m => m.Properties.ExcludeFromBuild) is { } m0)
            throw new BridgeException(BridgeErrorCodes.Unsupported,
                $"'{Name(item)}': its {m0.Kind.Replace('_', ' ')} '{m0.Name}' carries %EXCLUDE_FROM_BUILD inside a POU that " +
                "carries it too — TwinCAT holds no flag of its own for a member of an excluded POU (DIALECT C39). Remove " +
                "the member's line: the POU's excludes it.");
        // Through the handle the text write hands back: a member archive round trip replaces the POU (D4d).
        WriteBuildProperties(WriteText(item, content, bodies), content);
    }

    /// <returns>The item's live handle after the write.</returns>
    private ItemRef WriteText(ItemRef item, ItemContent content, IReadOnlyList<PushedNetworkBody> bodies)
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
        if (content.Members.Count == 0)
        { WriteOne(item, content.Kind, content.Declaration, content.Body, bodies, BodySite.Item); return item; }

        // ONE walk (not a re-walk of the POU per member, each step a live COM round trip), and ORDINAL-IGNORE-CASE
        // like every layer above it (`ReconcileMembers`, `OnlyChanged`, `BodyFormatGuard`, `ItemLookup`,
        // `TreeNav.NameIs`): IEC identifiers are case-insensitive in both IDEs, so an Ordinal compare here would
        // refuse a case-only rename — `METHOD Calc` to `METHOD calc` — after the POU's own declaration and body were
        // already written on the line above.
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
                throw new BridgeException(BridgeErrorCodes.IdeLostItem,
                    $"'{m.Name}': the member is in the pushed source but not in the project — creating members " +
                    "is the push service's job, and writing through a missing one would land nothing");

        var graphical = new List<(string[] Path, string Nwl)>();
        foreach (var m in content.Members)
        {
            var site = byName[m.Name];
            var itf = m.Kind == ItemKind.Kinds.InterfaceProperty;
            // Each body's model, with the scope the push pre-flight read it against (an action has no declaration of
            // its own, an accessor sees its property's and then the POU's: SourceScopes.SitesOf) — D8: no second read.
            Collect(graphical, new[] { m.Name }, m.Kind, site,
                    PushedNetworkBody.At(bodies, new BodySite(m.Name, m.Kind, null), m.Body));
            Collect(graphical, new[] { m.Name, "Get" }, ItemKind.Kinds.PropertyGet,
                    AccessorSite(site, itf ? ItemKind.PlcItfPropGet : ItemKind.PlcPropGet),
                    PushedNetworkBody.At(bodies, new BodySite(m.Name, m.Kind, BodySite.Get), m.Getter?.Body));
            Collect(graphical, new[] { m.Name, "Set" }, ItemKind.Kinds.PropertySet,
                    AccessorSite(site, itf ? ItemKind.PlcItfPropSet : ItemKind.PlcPropSet),
                    PushedNetworkBody.At(bodies, new BodySite(m.Name, m.Kind, BodySite.Set), m.Setter?.Body));
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
                throw new BridgeException(BridgeErrorCodes.IdeLostItem,
                    $"'{m.Name}': the member is not under the POU after its archive was rewritten — refusing " +
                    "to write through a handle the re-import already killed");

            WriteOne(target, m.Kind, m.Kind == ItemKind.Kinds.Action ? null : m.Declaration, Textual(m.Body),
                     bodies, new BodySite(m.Name, m.Kind, null));
            // The accessor's own kind, decided by the OWNER - the same rule the member kind follows. Passing
            // the POU code for an interface property would make the crash guard in WriteAccessor unreachable.
            var itfProp = m.Kind == ItemKind.Kinds.InterfaceProperty;
            WriteAccessor(target, itfProp ? ItemKind.PlcItfPropGet : ItemKind.PlcPropGet, Textual(m.Getter),
                          bodies, new BodySite(m.Name, m.Kind, BodySite.Get));
            WriteAccessor(target, itfProp ? ItemKind.PlcItfPropSet : ItemKind.PlcPropSet, Textual(m.Setter),
                          bodies, new BodySite(m.Name, m.Kind, BodySite.Set));
        }

        WriteOne(item, content.Kind, content.Declaration, content.Body, bodies, BodySite.Item);
        return item;
    }

    /// <summary>Resolve one graphical member body and note it for the archive write — or note NOTHING, when
    /// the member's live archive already says exactly this.
    ///
    /// <para>THE DROP IS THE POINT. The CREATE route rebuilds the ids, <c>Fixed</c> flags, <c>ILLines</c> and every
    /// unmodelled member of networks nobody touched, and the archive round trip deletes the POU and imports it back, a
    /// window in which the item is not in the project at all — so an unchanged body never takes it.</para>
    ///
    /// <para>So the selection is <see cref="ResolveBody"/>, the SAME one <see cref="WriteOne"/> makes for a POU,
    /// against the member's own live implementation. A null verdict means no change, and a body with no change
    /// does not belong in a round trip.</para>
    ///
    /// <para>The body arrives as the model the push pre-flight validated (null for a body that is no network text), so
    /// a refusal was raised before anything was touched (openspec bridge-refusal-review D8).</para></summary>
    private void Collect(List<(string[] Path, string Nwl)> into,
                         string[] path, string kind, ItemRef? site, PushedNetworkBody? graph)
    {
        if (graph is null) return;
        var model = graph.Model;

        // A null site is an accessor the property does not carry. Collecting nothing leaves the report to
        // `WriteAccessor`, which is where that case is already decided.
        var existing = site is { } s ? _om.ReadImplementation(Com(s)) : null;
        RefuseLanguageChange(kind, existing, LanguageOf(model));
        if (ResolveBody(existing, model, graph.Scope) is { } nwl) into.Add((path, nwl));
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
    /// <para>The bodies arrive RESOLVED, from <see cref="Collect"/> — built or edited archives, before the parent below
    /// is read.</para></summary>
    internal ItemRef WriteMemberBodies(ItemRef item, List<(string[] Path, string Nwl)> resolved)
    {
        var parent = _om.Parent(Com(item))
            ?? throw new BridgeException(BridgeErrorCodes.IdeLostItem,
                $"'{_om.GetName(Com(item))}' has no parent, so its archive cannot be rewritten");
        var pouName = _om.GetName(Com(item));

        _om.SetMemberBodies(Com(item), resolved);

        // The POU was deleted and re-imported, so every handle into it is dead. The PARENT was not replaced,
        // so it is still good to walk.
        // The parent is a FOLDER, so it may hold a POU Volt must not open (DIALECT C2i): `ChildNamed` passes it over.
        if (ChildNamed(Wrap(parent), pouName) is { } live) return live;

        throw new BridgeException(BridgeErrorCodes.IdeLostItem,
            $"'{pouName}' is not under its parent after the archive re-import — refusing to write through a " +
            "handle the import already killed");
    }

    // ── body ──────────────────────────────────────────────────────────────────────────────────────

    /// <summary>An item's body as workspace text: ST verbatim, a graphical body as network text, a body Volt
    /// does not show as its UNSUPPORTED line (<c>%LANGUAGE CFC UNSUPPORTED</c>, <c>%LANGUAGE LD UNSUPPORTED</c>).</summary>
    /// <param name="declaration">The declarations the body resolves against, innermost first
    /// (<see cref="SourceScopes.Scope"/>) — a graphical body is written against its <see cref="NetworkScope"/>.</param>
    /// <returns>The body, and — for an LD or FBD body that reads as its UNSUPPORTED line (network text is off, or cannot
    /// represent it: <see cref="NetworkText.Pulled"/>) — why, for the pull to report; null for every other body.</returns>
    private (string? Body, string? Unsupported, StatedLanguage? Stated) ReadBody(ItemRef item, string? declaration)
    {
        var raw = _om.ReadImplementation(Com(item));
        // Only NO text is no body: a whitespace-only one is stored characters, spelled under `%LANGUAGE ST` (openspec
        // bridge-one-to-one finding 8, task 3.5) — it was read as "no body", and a push then wrote the body empty.
        if (raw.Length == 0) return (null, null, null);

        if (TcArchive.Root(raw) is { } impl)
        {
            // IL, a view Volt has never seen, or none at all is the body's UNSUPPORTED line under that name
            // (`%LANGUAGE IL|<VIEW>|NWL UNSUPPORTED`: NetworkText.ViewLanguage, the one answer CODESYS gives too).
            // An unknown or missing view threw here, outside `Pulled`, which took the whole POU out of refs and fetch
            // (D27, openspec bridge-refusal-review 2.29).
            var stated = NetworkText.ViewLanguage(TcArchive.ViewMode(impl));
            if (NetworkText.LanguageNamed(stated) is not { } view) return (PropertyLines.UnsupportedLine(stated), null, StatedLanguage.HiddenIn(stated));

            // EVERY LD AND FBD BODY GOES THROUGH `NetworkText.Pulled`, as on CODESYS: while network text is off in this
            // process it is the UNSUPPORTED line with the switch's reason, and nothing below is read; on, it is network
            // text, or the UNSUPPORTED line with whatever the reader or the writer refused.
            //
            // AN EXECUTE BOX WHOSE ST CANNOT BE READ MAKES THE BODY UNSUPPORTED — it does not make the POU
            // DISAPPEAR. The reader refuses rather than materializing a box without the code it runs, and that
            // refusal is a THROW deep in the node walk; `Versioning.SafeVersion` isolates a throw by giving the
            // item the Unreadable sentinel — so `fetch` skipped the POU entirely and the engineer got no file at
            // all, only a count in the "N unreadable" tally. A body Volt cannot represent is exactly what the
            // UNSUPPORTED line is for, and this file already answers CFC, SFC and IL that way: the POU appears, says
            // its body is hidden, and a push that writes code under that line is refused instead of vanishing
            // from git.
            //
            // THE TEST USED TO BE "IS THERE AN EXECUTE BOX AT ALL", and that was right only while reading one
            // was impossible. `ReadStCode` reads the snippet now (2026-09-06, from a hand-drawn XAE network),
            // and against the coarse test it could never run in production: the return above it fired first, so
            // TwinCAT kept serving an UNSUPPORTED body where CODESYS serves network text — the same POU, two different
            // `sourceText`s, which is exactly what the byte-identical-response rule forbids. Ask the precise
            // question instead. The native builder creates one (TcArchiveBuilder), from the drawn box's members.
            //
            // THE PRE-SCAN IS GONE (ld-fbd-coverage 1b.4). `TcArchive.HasUnreadableExecuteBox` hid the WHOLE body for an
            // Execute box whose document is missing, before the reader ran — while CODESYS refuses the same box inside
            // ONE network, which the pull now shows as that network's UNSUPPORTED line (`TcNetworkReader.ReadShown`, the
            // rule both readers share). Kept, the same POU would have been one hidden body here and an editable body
            // with one UNSUPPORTED network there. `ReadStCode` refuses such a box under the same name, and `Pulled`'s
            // catch still keeps any refusal no network can stand for from costing the whole POU (an escaping throw is
            // stamped Unreadable and the fetch drops the file).
            //
            // Byte-identical with CODESYS: a fact the text has no spelling for — a flag on a split, an edge on an empty
            // slot, a connection slot the archive does not record — is UNSUPPORTED on both vendors: the model is the same
            // model (DIALECT N1) and the text the same text, and where the two READERS still differ (this one refuses a
            // populated InputFlags CODESYS reads) it is a divergence to close, not a parity. The writer raises the one exception
            // for every such fact (network text v2: pull never throws anything else). `VendorCapabilityParityTests`
            // holds the two drivers there — CODESYS had no pre-scan at all and lost POUs outright, which is what the
            // vendor differential map found on 2026-09-22.
            return NetworkText.Pulled(view, () =>
                StNetworkWriter.WritePulled(TcNetworkReader.ReadShown(impl, view), Declarations.ScopeForPull(declaration))
                    .TrimEnd('\n'));
        }

        // CFC and SFC are graphical and unsupported: each is its UNSUPPORTED line (`%LANGUAGE CFC UNSUPPORTED`), so an engineer
        // gets a file that says so rather than an editable-looking approximation of a diagram they would then push back.
        var lang = TcArchive.UnreadLanguage(raw);
        if (lang != null) return (PropertyLines.UnsupportedLine(lang), null, StatedLanguage.HiddenIn(lang));

        // ST, in memory, carries no line — so a keyword-shaped line in its text is refused here, where the language is
        // known, rather than read back from the file as the language it states.
        return (PropertyLines.RequireStBody(raw), null, StatedLanguage.St);   // verbatim
    }

    private void WriteOne(ItemRef item, string kind, string? declaration, string? body,
                          IReadOnlyList<PushedNetworkBody> bodies, BodySite site)
    {
        // A network-text body is written from the model the push pre-flight validated, with its scope (D8).
        if (PushedNetworkBody.At(bodies, site, body) is { } graph)
        {
            var model = graph.Model;
            var existing = _om.ReadImplementation(Com(item));
            RefuseLanguageChange(kind, existing, LanguageOf(model));

            // CREATE builds the archive natively (TcArchiveBuilder); an EXISTING body is edited in place, where every id
            // and every unmodelled member survives (ResolveBody). A MEMBER comes through here too: by the time this
            // writes, its body is an archive like any other.
            _om.WriteText(Com(item), declaration, ResolveBody(existing, model, graph.Scope));
            return;
        }

        // An UNSUPPORTED body is never written back over the live one (`PropertyLines.Written`).
        // A kind with no implementation slot (a DUT, a GVL, an interface, a property, an interface member) arrives
        // with NO body — the reader sends null for it (StReader) — and a text sent at a slot the object does not
        // expose is refused by name in `WriteText`, which asks the OBJECT (openspec bridge-refusal-review D26). The kind
        // table that decided this here (`HasBodySlot`) dropped such a body in silence; it is deleted.
        var written = PropertyLines.Written(body);
        if (written is not null) RefuseLanguageChange(kind, _om.ReadImplementation(Com(item)), Languages.St);
        _om.WriteText(Com(item), declaration, written);
    }

    /// <summary>THE WRITE'S OWN LANGUAGE-CHANGE CHECK — the predicate the push's guard asks
    /// (<see cref="RefusedLanguageChange"/>, <c>IVendorStore.RefusedLanguageChange</c>), asked again where the body is
    /// written, so the guard and the write cannot disagree on this vendor either (review of <c>bridge-refusal-review</c>
    /// 4a: only CODESYS's write asked it). TwinCAT refuses every change (N24), and without this a write that skipped the
    /// guard met the IDE instead: ST over an archive is a raw vendor throw, an archive over ST is stored as ST text that
    /// does not compile. <paramref name="existing"/> is the live implementation: blank is no body yet (a create, in
    /// any language), and a hidden live body (CFC, SFC, IL) is the guard's refusal, not a language change.</summary>
    private void RefuseLanguageChange(string site, string? existing, string to)
    {
        if (string.IsNullOrWhiteSpace(existing)) return;
        var from = TcArchive.Root(existing) is { } impl
            ? NetworkText.ViewLanguage(TcArchive.ViewMode(impl))
            : TcArchive.UnreadLanguage(existing) ?? Languages.St;
        if (from != Languages.St && !Languages.IsNetwork(from)) return;
        if ((from == Languages.St) == (to == Languages.St)) return;
        if (RefusedLanguageChange(site, from, to) is { } why)
            throw new BridgeException(BridgeErrorCodes.Unsupported, $"TwinCAT: {why}");
    }

    private static string LanguageOf(NetworkBody model) =>
        model.Language == BodyLanguage.Ld ? Languages.Ld : Languages.Fbd;

    /// <summary>THE ONE PLACE that decides what a graphical body becomes: a freshly BUILT archive when the item
    /// has none yet, an in-place EDIT when it does, and NULL when the archive already says exactly this.
    ///
    /// <para>Shared by <see cref="WriteOne"/> and <see cref="Collect"/>, because a POU and a MEMBER face the
    /// identical question - and answering it in two places let them drift: the member path took the create arm
    /// every time, without reading the live body at all.</para></summary>
    /// <param name="scope">The scope the body was read against (it travels with the model): the in-place writer's
    /// change gate renders the live network with it.</param>
    private string? ResolveBody(string? existing, NetworkBody model, NetworkScope scope)
    {
        // Blank, or an archive the engineer has drawn nothing into: the whole body is BUILT, natively - TwinCAT's own
        // archive, written through ImplementationText, which TwinCAT stores as handed over (openspec twincat-inproc-host).
        if (CreatesBody(existing)) return Created(model, scope);

        // AN EXISTING BODY IS EDITED IN PLACE, and where a network's SHAPE changed the builder builds just that network,
        // spliced in with ids no other network holds - so every network the engineer did not touch stays byte for byte
        // as the IDE wrote it: ids, Fixed flags, ILLines and all. A null means the archive already says exactly this.
        return TcNetworkWriter.Apply(existing!, model, scope, TcArchiveBuilder.NetworkGraph);
    }

    /// <summary>A body the item does not have yet, built natively - the archive TwinCAT stores. The edge order is the one
    /// refusal that is no shape but a measurement this vendor lacks (DIALECT N17).</summary>
    private static string Created(NetworkBody model, NetworkScope scope)
    {
        TcUnmeasured.RefuseEdgeOrder(model);
        return TcArchiveBuilder.Body(model, scope);
    }

    // ── members ───────────────────────────────────────────────────────────────────────────────────


    internal Member ReadMember(Volt.Engine.Ide.MemberSites.Site site, bool ownerIsInterface, string? ownerDeclaration,
                               bool ownerExcluded)
    {
        // The member's kind is decided by its code AND its owner — the one map CODESYS asks too (ItemKind.MemberKind,
        // openspec bridge-refusal-review D20); a code with no kind is refused by name (push-without-header-check 5.Q.7).
        var kind = ItemKind.MemberKind(site.Code, ownerIsInterface, site.Name);
        var declaration = MemberDeclaration(site);
        // An ACTION has no declaration of its own and resolves against its owner's (SourceScopes.BodiesOf).
        var scope = SourceScopes.Scope(site.Code == ItemKind.PlcAction ? null : declaration, ownerDeclaration);

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
                if (code == ItemKind.PlcPropGet) getter = ReadAccessor(acc, scope);
                else if (code == ItemKind.PlcPropSet) setter = ReadAccessor(acc, scope);
            }
        }

        var (body, unsupported, stated) = ReadBody(site.Ref, scope);
        // A member's saved facts live in its owner's file, which the owner's read refuses on (ReadProperties); its
        // exclusion is its own live property (C39).
        return new Member(kind, site.Name, declaration, body, MemberProperties(site.Ref, site.Name, ownerExcluded), site.Folder, getter, setter,
                          Unsupported: unsupported, Stated: stated);
    }

    private Accessor ReadAccessor(ItemRef acc, string? propertyScope)
    {
        var declaration = _om.ReadDeclaration(Com(acc));   // verbatim
        var (body, unsupported, stated) = ReadBody(acc, SourceScopes.Scope(declaration, propertyScope));
        return new Accessor(declaration, body, unsupported, stated);
    }

    /// <summary>Another top-level item's declaration, by name — the vendor half of
    /// <c>StDeclaration.TypeOfCallTarget</c> — and every global list, through the one helper both drivers share
    /// (<see cref="ProjectDeclarations"/>: the push asked first, the IDE half cached for one operation — dropped at
    /// the start of every <see cref="WalkItems"/>).
    ///
    /// <para>A graphical box can call through a name the POU does not declare — a qualified path walks a GVL,
    /// then a struct, then reaches the timer; <c>SUPER^</c> reaches the EXTENDS clause. Each hop is one more
    /// item's declaration, and only the driver can ask its IDE for one.</para></summary>
    internal ProjectDeclarations Declarations =>
        _declarations ??= new ProjectDeclarations(this, item => _om.ReadDeclaration(Com(item)), RefusedPouName, ExtractLibrarySignatures,
                                                  WalkIndex);
    private ProjectDeclarations? _declarations;

    public NetworkScope NetworkScopeFor(string? declaration, PushedDeclarations pushedDeclarations) =>
        Declarations.ScopeFor(declaration, pushedDeclarations);

    /// <summary>Beckhoff's object model agrees an action has no declaration: <c>_ITcPlcImplementation</c> exposes
    /// <c>ImplementationText</c> and no <c>DeclarationText</c> (<see cref="Volt.Engine.Ide.MemberSites.Declaration"/>).</summary>
    private string MemberDeclaration(Volt.Engine.Ide.MemberSites.Site site) =>
        Volt.Engine.Ide.MemberSites.Declaration(site, item => _om.ReadDeclaration(Com(item)));


    /// <summary>Write a property's GET or SET. The accessor EXISTS by the time this runs - creating and deleting
    /// one is <c>PushService.ReconcileAccessor</c>'s job, with every other child - so a null here means only
    /// "nothing to write", never "remove it".
    ///
    /// <para><b>An INTERFACE property accessor is a bodiless stub and must never be written to.</b> It declares
    /// that a getter/setter exists and nothing more. TwinCAT COM rejects a declaration/implementation write on
    /// one and can HARD-CRASH the IDE (RPC 0x800706BE - DIALECT D21), on read as well as write - measured. So they are
    /// created as bodiless "ST" stubs and nothing is written to them.</para>
    /// </summary>
    private void WriteAccessor(ItemRef property, int code, Accessor? accessor,
                               IReadOnlyList<PushedNetworkBody> bodies, BodySite site)
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
            ValidateInterfaceAccessor(accessor);
            return;
        }

        int n = ChildCount(property);
        for (int i = 1; i <= n; i++)
        {
            var child = ChildAt(property, i);
            if (KindCode(child) != code) continue;
            // Reached only with PlcPropGet / PlcPropSet (the interface pair returned above), both of which map; a code
            // that does not is Volt's own broken invariant, never a kind-less write (openspec bridge-refusal-review D20).
            var kind = ItemKind.Map(code)
                ?? throw new BridgeException(BridgeErrorCodes.InternalError,
                       $"TwinCAT: accessor code {code} of property '{Name(property)}' maps to no Volt kind");
            WriteOne(child, kind, accessor.Declaration, accessor.Body, bodies, site);
            return;
        }
    }


    /// <summary>The item's KIND, from the TREE — never from its text.
    ///
    /// <para>No fallback to parsing the declaration's header when the tree code does not map: every route into
    /// <c>ReadContent</c> is already gated on <c>ItemKind.Map</c> answering (<c>ProjectSnapshot</c>,
    /// <c>FetchService</c>, <c>PushService</c>, <c>ItemLookup</c>), so a fallback could only fire if one of those
    /// gates broke — and would then answer with a GUESS, putting a kind on the wire the tree does not agree
    /// with.</para>
    ///
    /// <para>Failing loud costs nothing here: <c>Versioning.SafeVersion</c> turns the throw into one logged
    /// "unreadable" item rather than a dead walk.</para></summary>
    private string KindOf(ItemRef item) =>
        ItemKind.Map(KindCode(item))
        ?? throw new BridgeException(BridgeErrorCodes.InternalError,
            $"'{Name(item)}' has tree kind {KindCode(item)}, which maps to no Volt kind - it should never have " +
            "reached ReadContent, because every caller filters on that map first.");

    // ── non-source manifest ──
    public string ReadManifest(ItemRef item, string kind)
    {
        // `Project Settings` → the SHARED compiler-settings descriptor, the rows CODESYS writes that TwinCAT has a
        // source for (DIALECT D37-D39). Before ProduceXml: the item is synthesized (TcProjectSettingsNode), not a tree node
        // — one per PLC project, read from ITS project.
        if (kind == ItemKind.Kinds.ProjectSettings)
        {
            if (item.Native is not TcProjectSettingsNode settings)
                throw new BridgeException(BridgeErrorCodes.InternalError, $"'{Name(item)}' is no project-settings item of a PLC project");
            _om.Use(settings.Plc);
            return ProjectSettingsFormat.Write(_om.ReadProjectSettings());
        }

        // A system project's `.device` → the target, as CODESYS describes its device (design §2).
        if (item.Native is SystemDescriptorNode system) return SystemDescriptor(system.System);

        // ONE STUB FORM ON BOTH VENDORS (openspec bridge-one-to-one §1.1 "Non-source items and stubs", wire parity 2.3): a
        // kind with no descriptor reader is `ItemKind.EmptyManifest` — the kind and a newline — as on CODESYS, whatever its
        // XML says, so its XML is not produced. This wrote `Name=<name>`, so the same visualization hashed differently per
        // vendor; the name is the file's.
        if (kind != ItemKind.Kinds.Library && kind != ItemKind.Kinds.Device && kind != ItemKind.Kinds.Task)
            return ItemKind.EmptyManifest(kind);

        // No silent catch: ProduceXml failing is a real error. An item that genuinely produces no XML
        // yields the canonical, kind-stamped empty manifest (deterministic version basis) — the SAME Core
        // helper CODESYS falls through to, so the two vendors cannot drift on those bytes.
        string xml = _om.ProduceXml(Com(item));
        if (string.IsNullOrEmpty(xml)) return ItemKind.EmptyManifest(kind);

        // A `.library` ref → the SHARED canonical manifest (same shape as CODESYS), built from ProduceXml.
        if (kind == ItemKind.Kinds.Library) return LibraryManifestFromXml(xml);

        // A `.device` → the identity descriptor, NOT this document. `ProduceXml` on a device is its whole
        // settings dump (2.9KB for an EtherCAT master, 10.6KB for an EK1100 coupler) carrying the engineer's own
        // `AmsNetId`, fieldbus addresses and DC timing — machine-specific bytes that would land in a git
        // repository and, because this text is the version-hash input, would rewrite the file on every unrelated
        // fieldbus tweak. CODESYS answers with a short identity block; so does this. See TcDeviceDescriptor.
        if (kind == ItemKind.Kinds.Device) return TcDeviceDescriptor.From(xml) ?? ItemKind.EmptyManifest(kind);

        // A `.task` → the SHARED scheduling descriptor, the same six labels CODESYS writes: the cycle time and POU
        // calls an engineer wants, not a tree path. Assembling it means reading the linked system task too — see
        // TcTaskSchedule.
        return TaskDescriptorFormat.Write(_om.ReadTask(Com(item)));
    }

    /// <summary>A system project's read-only descriptor: the target, in the device descriptor's own format and width
    /// (<see cref="TcDeviceDescriptor"/>) — its name, the solution's target platform as its type, and the TwinCAT build
    /// as its version (openspec multi-application-tree, design §2). A field the IDE states none for has no line.</summary>
    private string SystemDescriptor(string system) =>
        new Volt.Engine.Format.St.Descriptor(14)
            .Add("Name", system)
            .Add("Type", _om.TargetPlatform())
            .Add("Version", _om.IdeVersion)
            .ToString();

    /// <summary>A reference's manifest, every member READ (openspec bridge-one-to-one finding 7/8, task 3.3): the namespace
    /// was defaulted to the name and the resolution to <c>""</c>, and <c>SYSTEM false</c> was hard-coded — TwinCAT has no
    /// system member on a reference (<c>tc-library-system</c>, DIALECT C37), so the line is absent, as on a CODESYS
    /// non-system reference. A member the document lacks refuses the reference by name.</summary>
    private static string LibraryManifestFromXml(string xml)
    {
        var root = XDocument.Parse(xml).Root!;
        string Required(XElement? e, string what) =>
            e?.Value ?? throw new BridgeException(BridgeErrorCodes.Unsupported,
                $"twincat: the library reference's XML has no <{what}> — Volt reads it rather than assume it, so the " +
                "reference is not materialized.");

        var name = Required(root.Element("ItemName"), "ItemName");
        var reference = root.Descendants("PlaceholderReference").FirstOrDefault();
        var ns = Required((reference ?? root).Descendants("Namespace").FirstOrDefault(), "Namespace");
        var placeholder = Required(root.Element("ItemSubTypeName"), "ItemSubTypeName").Contains("PLACEHOLDER");
        // The reference's OWN EffectiveResolution is the first (a dependency's is nested under Dependencies).
        var eff = root.Descendants("EffectiveResolution").FirstOrDefault();
        var resolution = eff != null
            ? LibraryManifest.Resolution(Required(eff.Element("LibraryName"), "EffectiveResolution/LibraryName"),
                                         Required(eff.Element("Version"), "EffectiveResolution/Version"),
                                         Required(eff.Element("Distributor"), "EffectiveResolution/Distributor"))
            : Required(root.Descendants("DefaultResolution").FirstOrDefault(), "EffectiveResolution or DefaultResolution");
        // Direct dependencies, by name — the tree captured as a reference (matches CODESYS's DEPENDENCIES).
        var deps = root.Descendants("Dependency")
            .Select(d => d.Element("PlaceholderName")?.Value ?? d.Element("EffectiveResolution")?.Element("LibraryName")?.Value)
            .Where(s => !string.IsNullOrEmpty(s)).Select(s => s!).ToList();

        // The reference's flag VSProperties are CODESYS's members under TwinCAT's names (DIALECT C37b, measured by setting
        // the CODESYS member in a `.plcproj` and reading what TcXaeShell answers): each spells the line CODESYS spells for
        // its member, so the same reference pulls the same bytes on both vendors. Every live reference answers all four;
        // one it does not answer, or a value that is neither True nor False, refuses the reference by name.
        var properties = (root.Element("VSProperties")?.Elements("VSProperty") ?? Enumerable.Empty<XElement>())
            .Where(p => p.Element("Name") != null)
            .GroupBy(p => (string)p.Element("Name")!)
            .ToDictionary(g => g.Key, g => (string?)g.First().Element("Value"));
        bool Flag(string property) => properties.TryGetValue(property, out var v) switch
        {
            true when v == "True" => true,
            true when v == "False" => false,
            true => throw new BridgeException(BridgeErrorCodes.Unsupported,
                $"twincat: the library reference '{name}' has {property} = {v} — Volt has measured only True and False, " +
                "so the reference is not materialized."),
            false => throw new BridgeException(BridgeErrorCodes.Unsupported,
                $"twincat: the library reference '{name}' answers no {property} property — Volt reads it rather than " +
                "assume it, so the reference is not materialized."),
        };
        var hidden = Flag("HideReference");
        var published = Flag("PublishAll");
        var qualifiedOnly = Flag("QualifiedlAccessOnly");   // [sic] — TcXaeShell's own spelling
        var optional = Flag("Optional");

        // Its own parameter list (Tc2_System's six `PARAM.*`), spelled one line each — a dependency's is not its own.
        var parameters = (root.Descendants("ParameterList").FirstOrDefault(l => !l.Ancestors("Dependency").Any())?.Elements("Parameter")
                       ?? Enumerable.Empty<XElement>())
            .Select(p => (Required(p.Element("Name"), "Parameter/Name"), Required(p.Element("Value"), "Parameter/Value")))
            .ToList();

        return LibraryManifest.Build(name, ns, resolution, placeholder, system: false, deps, qualifiedOnly: qualifiedOnly,
                                     parameters: parameters, optional: optional, hideWhenReferencedAsDependency: hidden,
                                     publishSymbolsInContainer: published);
    }
}
