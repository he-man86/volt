using System;
using System.Collections.Generic;
using System.Linq;
using Volt.Contracts;
using Volt.Engine.Format.Body;
using Volt.Engine.Format.Network;
using Volt.Engine.Format.St;
using Volt.Engine;
using Volt.Engine.Ide;
using Volt.Engine.Item;

namespace Volt.Ide.Codesys;

/// <summary>
/// CODESYS driver — the <see cref="ICodeStore"/> facet. Everything travels the OBJECT MODEL: declarations and
/// textual bodies through their aspects, graphical bodies as typed <c>NWLObject</c> trees. <b>Nothing is
/// serialized in either direction</b>, so there is no document to splice, no import to re-place items after,
/// and no regeneration to carry unmodelled elements through.
///
/// <para>This replaces <c>CodesysDriver.Code.cs</c> and the PLCopen export/import it drove. What went with it:
/// the <c>export_xml</c>/<c>import_xml</c> pair, the <c>ConflictResolve.Replace</c> merge semantics, the
/// re-import into the original parent (a project-level import relocated the POU to the root), and
/// <c>BodyLanguage</c>'s whole-document export just to read one attribute — on this driver that was a full
/// PLCopen export per call, which a POU with 20 methods paid 22 times to write one body.</para>
/// </summary>
public sealed partial class CodesysDriver
{
    public ItemContent ReadContent(ItemRef item)
    {
        var declaration = ReadDeclarationText(item);
        var iobj = _om.ReadObject(item.Native);
        var (language, body) = ReadBody(iobj);

        var members = new List<Member>();
        var ownerIsInterface = KindCode(item) == ItemKind.PlcItf;
        foreach (var site in Volt.Engine.Ide.MemberSites.Of(this, item))
            members.Add(ReadMember(site, ownerIsInterface));

        // No separate language field: a graphical body's text LEADS with `NETWORK n FBD|LD`, so the
        // language is already in the content and a second copy could only disagree with it.
        _ = language;
        return new ItemContent(
            KindOf(item, declaration),
            declaration.TrimEnd(),
            body,
            members);
    }

    public void WriteContent(ItemRef item, ItemContent content)
    {
        // A graphical body is validated BEFORE anything is written, so a refusal leaves the item untouched.
        NetworkBody? graph = content.Body is { } b && NetworkText.Is(b) ? NetworkTextGate.Validate(b) : null;

        if (graph is null)
        {
            // Textual: declaration and body ride one GetObjectToModify/SetObject transaction.
            //
            // A MARKER is informational and is never written back. Restating it is the ordinary no-op that keeps
            // a POU with a CFC/SFC body pushable at all - `volt pull` writes the marker to disk and the next push
            // restates every file it has - so the body is dropped and the declaration still lands. WriteMembers
            // has said this since it was written; only the top-level path had not, and a CFC POU has no
            // TextDocument on its Implementation aspect, so the write failed loudly with
            // "the write would be accepted and land nothing" and a whole project holding one diagram could
            // never be pushed again.
            _om.WriteSourceText(item.Native, content.Declaration,
                                BodyMarker.Is(content.Body) ? null : content.Body);
        }
        else
        {
            // Declaration first and body second is safe here in a way it never was on the document transport:
            // nothing re-imports the item, so nothing can regenerate the declaration behind the write. (The
            // ordering rule that used to live in PushService was about TwinCAT's IMPORTER, and there is no
            // import on this path at all.)
            _om.WriteSourceText(item.Native, content.Declaration, null);
            CodesysNetworkWriter.Write(_om, item.Native, graph, content.Declaration);
        }

        WriteMembers(item, content.Members, content.Declaration);
    }

    // ── body ──────────────────────────────────────────────────────────────────────────────────────

    /// <summary>The body's language and text. <b>Dispatch is a CAST</b>: the aspect's TYPE is the language, so
    /// nothing sniffs content and no separate language query is needed. An ST POU yields
    /// <c>STImplementationObject</c>, an FBD or LD POU yields <c>NWLImplementationObject</c>, a CFC POU yields
    /// <c>CFCImplementationObject</c> — measured, and the same project proves the discrimination
    /// (271 ST, 1 CFC in one project; 38 ST, 36 NWL in another).</summary>
    private static (BodyLanguage? Language, string? Body) ReadBody(object? iobj)
    {
        var impl = iobj is null ? null : NwlInterop.Get(iobj, "Implementation");
        if (impl is null) return (null, null);

        switch (impl.GetType().Name)
        {
            case "STImplementationObject":
            {
                var text = CodesysObjectModel.ReadAspectText(iobj, "Implementation").Trim();
                return (null, text.Length == 0 ? null : text);
            }

            case "NWLImplementationObject":
            {
                // IL is a VIEW of this same aspect, not a separate one, so an IL body arrives HERE and not in
                // the marker arm below. ReadViewMode used to THROW for it, and the cost of that throw was total:
                // Versioning.SafeVersion swallows it to UNREADABLE, and FetchService then drops the item from
                // `changed`, `items` AND `folders` — so one IL-view method inside an ordinary ST function block
                // removed the ENTIRE POU, declaration and every sibling method with it, from refs and fetch, on
                // every pull, with only a log warning. IL is unsupported, which is exactly what the marker is
                // for; ARCHITECTURE.md and network-text.md both already said it materializes as one.
                var language = ReadViewMode(impl);
                if (language is null) return (null, BodyMarker.For("IL"));

                var model = CodesysNetworkReader.Read(impl, language.Value);
                var text = NetworkTextWriter.Write(model).Trim();
                return (language, text.Length == 0 ? null : text);
            }

            default:
                // CFC, SFC and anything else graphical: UNSUPPORTED, and it materializes as the marker so an
                // engineer gets a file that says so rather than an editable-looking approximation of a diagram.
                return (null, BodyMarker.For(MarkerLanguage(impl.GetType().Name)));
        }
    }

    /// <summary>FBD or LD, from the aspect's <c>DefaultViewMode</c> — the vendor's own
    /// <c>NWLDisplayMode { LD, FBD, IL }</c>. Measured on a real ladder project: <c>'Ld'</c>.
    /// <para>IL is a VIEW of the same network model, not a separate body format, and Volt does not author it.
    /// A body in IL view is refused rather than rendered as FBD, because rendering it would hand the engineer a
    /// diagram they did not write.</para></summary>
    internal static BodyLanguage? ReadViewMode(object impl)
    {
        var mode = NwlInterop.Require(impl, "DefaultViewMode").ToString() ?? "";
        if (mode.Equals("Ld", StringComparison.OrdinalIgnoreCase)) return BodyLanguage.Ld;
        if (mode.Equals("Fbd", StringComparison.OrdinalIgnoreCase)) return BodyLanguage.Fbd;

        // NULL means "a view Volt does not author" — IL, today. The caller turns that into the MARKER, which is
        // how every other unsupported language is handled. Throwing here instead took the whole enclosing POU
        // out of refs and fetch, which is a far larger loss than the body Volt cannot render.
        if (mode.Equals("IL", StringComparison.OrdinalIgnoreCase)) return null;

        throw new NotSupportedException(
            $"CODESYS: the graphical body's view mode is '{mode}', which Volt has never seen. FBD and LD are " +
            "authored, IL materializes as a marker — an unknown fourth view is refused rather than guessed at.");
    }

    /// <summary>The marker language for an unsupported graphical aspect — <c>CFCImplementationObject</c> to
    /// <c>CFC</c>.</summary>
    private static string MarkerLanguage(string aspectTypeName) =>
        aspectTypeName.EndsWith("ImplementationObject", StringComparison.Ordinal)
            ? aspectTypeName.Substring(0, aspectTypeName.Length - "ImplementationObject".Length).ToUpperInvariant()
            : aspectTypeName.ToUpperInvariant();

    // ── members ───────────────────────────────────────────────────────────────────────────────────


    private Member ReadMember(Volt.Engine.Ide.MemberSites.Site site, bool ownerIsInterface)
    {
        var kind = MemberKind(site.Code, ownerIsInterface);
        var iobj = _om.ReadObject(site.Ref.Native);
        var (_, body) = ReadBody(iobj);

        Accessor? getter = null, setter = null;
        if (kind is ItemKind.Kinds.Property or ItemKind.Kinds.InterfaceProperty)
        {
            int n = ChildCount(site.Ref);
            for (int i = 1; i <= n; i++)
            {
                var acc = ChildAt(site.Ref, i);
                var accessor = ReadAccessor(acc);
                if (KindCode(acc) == ItemKind.PlcPropGet) getter = accessor;
                else if (KindCode(acc) == ItemKind.PlcPropSet) setter = accessor;
            }
        }

        return new Member(kind, site.Name, MemberDeclaration(site), body, site.Folder, getter, setter);
    }

    /// <summary>A member's kind, decided by its OWNER rather than by the object's interfaces alone.
    /// <para>CODESYS's classification cannot separate the two on its own here: <c>CodesysTypeMap</c> tests
    /// <c>IInterfacePropertyObject</c> before <c>IPropertyObject</c>, and on this build a property inside a
    /// FUNCTION BLOCK answers to both — so every property came back as <c>interface_property</c> and the ST
    /// writer refused it with "No END keyword for POU child kind 'interface_property'". It never showed before
    /// because the member kind used to come from the PLCopen document, which nests a POU's properties under the
    /// POU. The owner is the fact that settles it, and the tree walk already knows it.</para></summary>
    private static string MemberKind(int code, bool ownerIsInterface) => code switch
    {
        ItemKind.PlcMethod or ItemKind.PlcItfMeth =>
            ownerIsInterface ? ItemKind.Kinds.InterfaceMethod : ItemKind.Kinds.Method,
        ItemKind.PlcProp or ItemKind.PlcItfProp =>
            ownerIsInterface ? ItemKind.Kinds.InterfaceProperty : ItemKind.Kinds.Property,
        // No fallback. `?? Kinds.Method` turned any live CODESYS code this map does not know into a "method",
        // which then travels the whole write path as one - the same silent default `ItemKind.MemberCode` used to
        // carry on the other side of the round trip.
        _ => ItemKind.Map(code)
             ?? throw new BridgeException(BridgeErrorCodes.Unsupported,
                    $"CODESYS: item type {code} is a member Volt has no kind for — refusing to treat it as a method"),
    };

    private ItemRef? FindAccessor(ItemRef property, int code)
    {
        int n = ChildCount(property);
        for (int i = 1; i <= n; i++)
        {
            var child = ChildAt(property, i);
            if (KindCode(child) == code) return child;
        }
        return null;
    }

    /// <summary>Compare on the text as it LANDS — the drivers trim, so a trailing newline is not a change.</summary>
    private static string Text(string? s) => (s ?? "").Trim();

    private Accessor ReadAccessor(ItemRef acc)
    {
        var iobj = _om.ReadObject(acc.Native);
        var (_, body) = ReadBody(iobj);
        return new Accessor(AccessorDeclaration.Keep(CodesysObjectModel.ReadAspectText(iobj, "Interface")), body);
    }

    /// <summary>A member's declaration, from the member's OWN declaration aspect.
    /// <para><b>An ACTION is the one member with no declaration to read</b>, in any IDE: IEC gives an action a
    /// name and a body and nothing else. Its header is COMPOSED here rather than read — that is not a fallback
    /// for a missing value, it is the whole of what an action's header is.</para></summary>
    private string MemberDeclaration(Volt.Engine.Ide.MemberSites.Site site)
    {
        if (site.Code == ItemKind.PlcAction) return $"ACTION {site.Name}";

        var decl = ReadDeclarationText(site.Ref);
        if (string.IsNullOrWhiteSpace(decl))
            throw new BridgeException(BridgeErrorCodes.InternalError,
                $"'{site.Name}': the IDE reports no declaration for this member — that is a broken item, not a " +
                "transport gap");
        return decl.Trim();
    }

    private string ReadDeclarationText(ItemRef item) =>
        item.Native is LibRefNode lib ? lib.Manifest : _om.ReadDeclaration(item.Native);


    private string KindOf(ItemRef item, string declaration)
    {
        var mapped = ItemKind.Map(KindCode(item));
        if (!string.IsNullOrEmpty(mapped)) return mapped!;
        return CodeHelper.ParseCodeHeader(declaration).Type;
    }

    // ── member write ──────────────────────────────────────────────────────────────────────────────

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

    private void WriteMembers(ItemRef pou, IReadOnlyList<Member> members, string? ownerDeclaration)
    {
        if (members.Count == 0) return;

        // ONE walk for the whole write. FindChildByName used to re-run MemberSites per member, and MemberSites
        // CLASSIFIES every child it passes - a ReadObject plus an interface-name query each. For a POU with 20
        // members that is 20 walks and ~400 classifications to write 20 bodies. The tree does not change during
        // this loop: the member set was reconciled before it, and CODESYS handles survive a child write.
        // ORDINAL-IGNORE-CASE, like every other name comparison on this wire. IEC identifiers are
        // case-insensitive and both IDEs treat them so; `ReconcileMembers`, `OnlyChanged`, `BodyFormatGuard`,
        // `ItemLookup` and `TreeNav.NameIs` all use OrdinalIgnoreCase. This one used Ordinal, so a case-only
        // rename (`Calc` -> `calc`) got past the reconciler, which correctly created nothing, and then died HERE
        // claiming "the member is in the pushed source but not in the project" - which was false, and left the
        // POU's own declaration and body already written.
        var byName = new Dictionary<string, ItemRef>(StringComparer.OrdinalIgnoreCase);
        foreach (var site in Volt.Engine.Ide.MemberSites.Of(this, pou)) byName[site.Name] = site.Ref;

        foreach (var m in members)
        {
            if (!byName.TryGetValue(m.Name, out var target))
                throw new BridgeException(BridgeErrorCodes.NotFound,
                    $"'{m.Name}': the member is in the pushed source but not in the project — creating members " +
                    "is the push service's job, and writing through a missing one would land nothing");


            NetworkBody? graph = m.Body is { } b && NetworkText.Is(b) ? NetworkTextGate.Validate(b) : null;
            if (graph is null)
            {
                _om.WriteSourceText(target.Native,
                    m.Kind == ItemKind.Kinds.Action ? null : m.Declaration,
                    BodyMarker.Is(m.Body) ? null : m.Body);   // a marker is informational; never written back
            }
            else
            {
                _om.WriteSourceText(target.Native, m.Kind == ItemKind.Kinds.Action ? null : m.Declaration, null);
                CodesysNetworkWriter.Write(_om, target.Native, graph, Scope(m.Declaration, ownerDeclaration));
            }

            // The accessor is LOOKED UP by the code this vendor's classifier actually returns, and the
            // interface-ness is carried SEPARATELY, as a flag off the owner.
            //
            // It used to pass `PlcItfPropGet/Set` (654/655) for an interface property, on the reasoning that the
            // accessor's kind follows its owner. It does not, here: `CodesysTypeMap.RefineAccessor` hands back
            // only 613/614 for BOTH `IPropertyAccessorObject` and `IInterfacePropertyAccessorObject` — a
            // measured fact recorded on `ItemKind.PlcPropGet` itself ("CODESYS maps its interface accessors here
            // too"). So `FindAccessor(property, 654)` could never match, `live` was always null, and the guard
            // below fell through to a bare `return` — the exact silent discard its own comment says it was
            // written to fix. An engineer's edit to a `GET … END_GET` in a `.itf` was accepted and dropped, and
            // `volt status` then reported in sync.
            var ownerIsInterface = m.Kind == ItemKind.Kinds.InterfaceProperty;
            WriteAccessor(target, ItemKind.PlcPropGet, m.Getter, ownerIsInterface, ownerDeclaration);
            WriteAccessor(target, ItemKind.PlcPropSet, m.Setter, ownerIsInterface, ownerDeclaration);
        }
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
    private void WriteAccessor(ItemRef property, int code, Accessor? accessor, bool ownerIsInterface,
                               string? ownerDeclaration)
    {
        if (accessor is null) return;

        // An INTERFACE property's accessors are bodiless stubs and are never written (DIALECT D21 - the write
        // can hard-crash TcXaeShell). But returning SILENTLY meant an engineer's edit to a `GET ... END_GET` in
        // a `.itf` file was accepted and discarded, and `volt status` then said in sync. Refuse only what is
        // actually a CHANGE: an unchanged restatement is the ordinary no-op that keeps the item pushable.
        //
        // Decided from the OWNER, not from the accessor's own kind code: this vendor classifies an interface
        // accessor as 613/614 like any other, so a test on the code could never fire (see the call site).
        if (ownerIsInterface)
        {
            // The DETECTION is this vendor's own — it has to read the accessor back, because a CODESYS
            // interface accessor carries whatever the IDE put there. The refusal and its wording are shared
            // (`InterfaceAccessorGuard`), so the sentence an engineer reads cannot drift between vendors.
            //
            // A live accessor of null means the property does not carry one at all: there is nothing to write
            // to and nothing to refuse, so it stays a silent return rather than reaching the guard.
            var live = FindAccessor(property, code);
            if (live is not null)
            {
                var was = ReadAccessor(live.Value);
                InterfaceAccessorGuard.RefuseIfChanged(was.Declaration, was.Code,
                                                       accessor.Declaration, accessor.Code);
            }
            return;
        }

        int n = ChildCount(property);
        for (int i = 1; i <= n; i++)
        {
            var child = ChildAt(property, i);
            if (KindCode(child) != code) continue;

            // A GRAPHICAL ACCESSOR IS WRITTEN AS A DIAGRAM, not as source text.
            //
            // This wrote `accessor.Code` straight through `WriteSourceText`, with no graphical branch at
            // all - the only write path in this driver that lacked one. So a property whose GET/SET is
            // FBD or LD had its NETWORK TEXT stored as the accessor's ST body, and the project stopped
            // compiling: `';' expected instead of '0'`, `';' expected instead of 'FBD'` - the
            // `NETWORK 0 FBD` header being parsed as a statement.
            //
            // It round-tripped perfectly the whole time, because Volt read its own network text straight
            // back, and the test that exists for exactly this (`graphical-kinds.test.ts`, "an FB whose
            // PROPERTY has FBD in BOTH accessors round-trips and compiles") passed because its build
            // assertion filtered diagnostics by a POU name no vendor puts in one. That test's own comment
            // describes this bug as fixed; the fix covered the member path and never reached the accessor.
            //
            // Same two-step as every other body here: validate BEFORE touching the IDE, write the
            // declaration with a null body, then build the diagram through the network writer.
            var graph = accessor.Code is { } ac && NetworkText.Is(ac) ? NetworkTextGate.Validate(ac) : null;
            if (graph is null)
            {
                // A MARKER IS NEVER WRITTEN BACK — the same guard `WriteContent` and `WriteMembers` carry,
                // and this arm was rewritten without it. An accessor authored in CFC materializes as an
                // informational marker, `BodyFormatGuard` passes it (restating a marker is the ordinary
                // no-op that keeps the enclosing POU pushable at all), and writing it into a CFC aspect
                // throws — after the POU's declaration and earlier members have already committed. That
                // POU could then never be pushed again while the CFC accessor existed.
                _om.WriteSourceText(child.Native, accessor.Declaration,
                                    BodyMarker.Is(accessor.Code) ? null : accessor.Code);
                return;
            }

            _om.WriteSourceText(child.Native, accessor.Declaration, null);
            CodesysNetworkWriter.Write(_om, child.Native, graph, Scope(accessor.Declaration, ownerDeclaration));
            return;
        }
    }

    // ── non-source manifest ──
    /// <summary>Kinds this SESSION has already reported as having no descriptor reader. Instance-scoped, not
    /// static: the DLL outlives a PipeHost.Stop()/Start() inside a running IDE, and a support session that
    /// restarts the bridge must get the warning again rather than inherit a silenced process.</summary>
    private readonly HashSet<string> _kindsWithoutReader = new HashSet<string>(StringComparer.Ordinal);

    public string ReadManifest(ItemRef item, string kind) =>
        item.Native is LibRefNode lib ? lib.Manifest
        : kind == ItemKind.Kinds.Device ? _om.DeviceDescriptor(item.Native)
        : kind == ItemKind.Kinds.ProjectInfo ? _om.ProjectInfoDescriptor(item.Native)
        : kind == ItemKind.Kinds.Trace ? _om.TraceDescriptor(item.Native)
        : kind == ItemKind.Kinds.Recipe ? _om.RecipeDescriptor(item.Native)
        : kind == ItemKind.Kinds.SymbolConfig ? _om.SymbolConfigDescriptor(item.Native)
        : kind == ItemKind.Kinds.ProjectSettings ? _om.ProjectSettingsDescriptor(item.Native)
        : kind == ItemKind.Kinds.Task ? _om.TaskDescriptor(item.Native)
        : NoDescriptorReader(kind);

    /// <summary>A kind CODESYS classifies as a TRACKED item but for which no descriptor reader was ever written
    /// (visualization, image pool, text list, class diagram …). The manifest is the canonical empty one — the same
    /// bytes TwinCAT emits for an item with no metadata — and the gap is now NAMED in the log instead of being
    /// invisible. It is still a gap: every item of the kind hashes identically, so an edit to one of them cannot
    /// show up in `volt status`. The fix is the missing reader, and this line is what points at it.</summary>
    private string NoDescriptorReader(string kind)
    {
        bool first;
        lock (_kindsWithoutReader) first = _kindsWithoutReader.Add(kind);
        if (first)
            VoltLog.Warn($"no descriptor reader for kind '{kind}' — its items materialize as the empty manifest and all hash identically");
        return ItemKind.EmptyManifest(kind);
    }
}
