using System;
using System.Collections.Generic;
using System.Linq;
using Volt.Contracts;
using Volt.Engine.Format.Body;
using Volt.Engine.Format.Network;
using Volt.Engine.Format.St;
using Volt.Engine;
using Volt.Engine.Ide;
using Volt.Engine.Format.Task;
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
        var (body, unsupported) = ReadBody(iobj, declaration);

        var members = new List<Member>();
        var ownerIsInterface = KindCode(item) == ItemKind.PlcItf;
        foreach (var site in Volt.Engine.Ide.MemberSites.Of(this, item))
            members.Add(ReadMember(site, ownerIsInterface, declaration));

        // No separate language field: a graphical body's text LEADS with its `IMPLEMENTATION FBD|LD` line
        // (its stated language), so the language is already in the content and a second copy could only disagree.
        var kind = KindOf(item);
        return new ItemContent(
            kind,
            declaration.TrimEnd('\n'),
            body,
            members,
            unsupported,
            DutSubtypeOf(kind, declaration));
    }

    /// <summary>A DUT's subtype as this vendor states it (<see cref="ItemContent.DutSubtype"/>; null = no answer, the
    /// item is published <c>name.dut</c>), and null for every other kind.
    /// <para><b>INTERIM</b> (openspec <c>push-without-header-check</c> 5.B choice 7): the engine's stand-in
    /// <c>CodeHelper.TryDutSubtype</c> until 5.D answers from CODESYS's precompile signature
    /// (<c>Type</c>+<c>Structure</c> / <c>+Union</c> / <c>Alias</c>, <c>VarGlobal</c>+<c>Enum</c>; DIALECT C2g).</para></summary>
    private static DutSubtype? DutSubtypeOf(string kind, string declaration) =>
        kind == ItemKind.Kinds.Dut ? CodeHelper.TryDutSubtype(declaration) : null;

    public void WriteContent(ItemRef item, ItemContent content,
                             IReadOnlyDictionary<string, string> pushedDeclarations)
    {
        // A graphical body is validated BEFORE anything is written, so a refusal leaves the item untouched.
        var scope = NetworkScopeFor(content.Declaration, pushedDeclarations);
        NetworkBody? graph = content.Body is { } b && NetworkText.Is(b) ? NetworkText.Validate(b, scope) : null;

        if (graph is null)
        {
            // Textual: declaration and body ride one GetObjectToModify/SetObject transaction.
            //
            // AN UNSUPPORTED BODY is never written back (`ImplementationMarker.Written`). Restating its line is the ordinary no-op that keeps a POU with
            // a CFC/SFC body pushable at all - `volt pull` writes the line to disk and the next push restates every
            // file it has - so the body is dropped and the declaration still lands. WriteMembers
            // has said this since it was written; only the top-level path had not, and a CFC POU has no
            // TextDocument on its Implementation aspect, so the write failed loudly with
            // "the write would be accepted and land nothing" and a whole project holding one diagram could
            // never be pushed again.
            _om.WriteSourceText(item.Native, content.Declaration,
                                ImplementationMarker.Written(content.Body));
        }
        else
        {
            // Declaration first and body second is safe here in a way it never was on the document transport:
            // nothing re-imports the item, so nothing can regenerate the declaration behind the write. (The
            // ordering rule that used to live in PushService was about TwinCAT's IMPORTER, and there is no
            // import on this path at all.)
            _om.WriteSourceText(item.Native, content.Declaration, null);
            WriteGraph(item.Native, graph, scope);
        }

        WriteMembers(item, content.Members, content.Declaration, pushedDeclarations);
    }

    // ── body ──────────────────────────────────────────────────────────────────────────────────────

    /// <summary>The body's language and text. <b>Dispatch is a CAST</b>: the aspect's TYPE is the language, so
    /// nothing sniffs content and no separate language query is needed. An ST POU yields
    /// <c>STImplementationObject</c>, an FBD or LD POU yields <c>NWLImplementationObject</c>, a CFC POU yields
    /// <c>CFCImplementationObject</c> — measured, and the same project proves the discrimination
    /// (271 ST, 1 CFC in one project; 38 ST, 36 NWL in another).</summary>
    /// <summary>What the vendor holds, minus only the trailing NEWLINES Volt's file format cannot carry.
    ///
    /// <para>It used to be <c>Trim()</c>, and that made the read side an EDITOR. Leading whitespace is content:
    /// a body whose first line is indented, or which opens on a blank line, is exactly what the engineer wrote —
    /// and it is also what a PUSH legitimately sends, so trimming it turned every such push into a silent
    /// one-line edit that the next pull reported as drift. Nine files in `pro2193` came back changed after a
    /// migration for no other reason.</para>
    ///
    /// <para>Trailing newlines are the exception because they are not representable: <see cref="StWriter"/>
    /// ends a body with its own separator before <c>END_&lt;KIND&gt;</c>, so a body that ends in three blank
    /// lines cannot round-trip whatever this does. Dropping them here is the honest place to lose them.
    /// Trailing SPACES on the last real line are kept — those are text.</para></summary>
    private static string? BodyText(string raw) =>
        raw.TrimEnd('\n') is { } text && text.Trim().Length == 0 ? null : raw.TrimEnd('\n');

    /// <param name="declaration">The declarations the body resolves against, innermost first
    /// (<see cref="SourceScopes.Scope"/>) — a graphical body is written against its <see cref="NetworkScope"/>.</param>
    /// <returns>The body as workspace text, and — for an LD or FBD body that reads as <c>IMPLEMENTATION LD|FBD
    /// UNSUPPORTED</c> (network text is off, or cannot represent it: <see cref="NetworkText.Pulled"/>) — why, for the
    /// pull to report; null for every other body.</returns>
    private (string? Body, string? Unsupported) ReadBody(object? iobj, string? declaration)
    {
        var impl = iobj is null ? null : NwlInterop.Get(iobj, "Implementation");
        if (impl is null) return (null, null);

        switch (impl.GetType().Name)
        {
            case "STImplementationObject":
            {
                // ST, in memory, carries no line — so a keyword-shaped line in its text is refused here, where the
                // language is known, rather than read back from the file as the language it states.
                return (BodyText(CodesysObjectModel.ReadAspectText(iobj, "Implementation")) is { } st ? ImplementationMarker.RequireStBody(st) : null, null);
            }

            case "NWLImplementationObject":
            {
                // IL is a VIEW of this same aspect, not a separate one, so an IL body arrives HERE and not in
                // the UNSUPPORTED arm below. ReadViewMode used to THROW for it, and the cost of that throw was total:
                // Versioning.SafeVersion swallows it to UNREADABLE, and FetchService then drops the item from
                // `changed`, `items` AND `folders` — so one IL-view method inside an ordinary ST function block
                // removed the ENTIRE POU, declaration and every sibling method with it, from refs and fetch, on
                // every pull, with only a log warning. IL is unsupported, which is exactly what the UNSUPPORTED line
                // is for: `IMPLEMENTATION IL UNSUPPORTED`.
                var language = ReadViewMode(impl);
                if (language is null) return (ImplementationMarker.Unsupported(Languages.Il), null);

                // A BODY THE READER CANNOT REPRESENT IS `IMPLEMENTATION LD|FBD UNSUPPORTED`, NOT A MISSING POU — and so
                // is every LD and FBD body while network text is off in this process. `NetworkText.Pulled` decides both,
                // for both vendors: the switch first, then whatever the reader or the writer refuses.
                //
                // `ReadStCode` refuses an Execute box whose ST cannot be read — correctly: materializing the
                // box without the code it runs makes the body look complete when it is not. But the refusal is
                // a THROW deep in the node walk, and unguarded it reaches `Versioning.SafeVersion`, which
                // isolates it by stamping the item UNREADABLE; `FetchService` then drops the POU from
                // `changed`, `items` AND `folders`, so the engineer's file disappears from the workspace and
                // from git on every pull, with only a count in the "N unreadable" tally — declaration, body
                // and every sibling method with it. That is the identical failure the IL arm above exists to
                // stop, one arm lower down.
                //
                // TwinCAT never had the hole: its driver pre-empts the same refusal with an archive pre-scan
                // (`TcArchive.HasUnreadableExecuteBox`) and returns the UNSUPPORTED line. CODESYS reads LIVE objects and
                // has no equivalent pre-scan to run, so the SAME body gave a TwinCAT engineer a POU that says
                // what it holds and a CODESYS engineer no POU at all. The two now answer identically, which is
                // the byte-identical-response rule the wire exists to hold.
                //
                // A fact the text has no spelling for makes the body UNSUPPORTED, never a body without it — a negated
                // coil, a rung driving two jumps, a connection by an output slot the text cannot name. The writer
                // raises the one exception for every such fact (network text v2: pull never throws anything
                // else), so it is the same refusal as the reader's, and as IL.
                var view = language.Value;
                return NetworkText.Pulled(view, () =>
                    NetworkTextWriter.Write(CodesysNetworkReader.Read(impl, view), Declarations.ScopeForPull(declaration))
                        .TrimEnd('\n'));
            }

            default:
                // CFC and SFC: a language Volt does not read, so the body is its UNSUPPORTED line
                // (`IMPLEMENTATION CFC UNSUPPORTED`) and an engineer gets a file that says so rather than an editable-looking
                // approximation of a diagram.
                return (ImplementationMarker.Unsupported(UnreadLanguage(impl.GetType().Name)), null);
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

        // NULL means "a view Volt does not author" — IL, today. The caller turns that into IMPLEMENTATION IL UNSUPPORTED, which is
        // how every other unsupported language is handled. Throwing here instead took the whole enclosing POU
        // out of refs and fetch, which is a far larger loss than the body Volt cannot render.
        if (mode.Equals("IL", StringComparison.OrdinalIgnoreCase)) return null;

        throw new NotSupportedException(
            $"CODESYS: the graphical body's view mode is '{mode}', which Volt has never seen. FBD and LD are " +
            "authored, IL is hidden (IMPLEMENTATION IL UNSUPPORTED) — an unknown fourth view is refused rather than guessed at.");
    }

    /// <summary>The language of a body aspect Volt does not read — <c>CFCImplementationObject</c> to <c>CFC</c>,
    /// <c>SFCImplementationObject</c> to <c>SFC</c>.
    /// <para>Those two and nothing else. The UNSUPPORTED line states a language the reader and the LSP both know, so an
    /// aspect Volt has never seen is refused naming it — as <see cref="ReadViewMode"/> refuses an unknown view —
    /// rather than written into the file as a language no reader recognises. (It used to become a marker naming
    /// whatever the type name said.)</para></summary>
    private static string UnreadLanguage(string aspectTypeName)
    {
        var name = aspectTypeName.EndsWith("ImplementationObject", StringComparison.Ordinal)
            ? aspectTypeName.Substring(0, aspectTypeName.Length - "ImplementationObject".Length).ToUpperInvariant()
            : aspectTypeName.ToUpperInvariant();
        return name is Languages.Cfc or Languages.Sfc
            ? name
            : throw new NotSupportedException(
                $"CODESYS: the body aspect is '{aspectTypeName}', a language Volt has never seen. ST, FBD and LD are " +
                "read, CFC, SFC and IL are hidden (UNSUPPORTED) — an unknown language is refused rather than guessed at.");
    }

    // ── members ───────────────────────────────────────────────────────────────────────────────────


    private Member ReadMember(Volt.Engine.Ide.MemberSites.Site site, bool ownerIsInterface, string? ownerDeclaration)
    {
        var kind = MemberKind(site.Code, ownerIsInterface);
        var iobj = _om.ReadObject(site.Ref.Native);
        var declaration = MemberDeclaration(site);
        // An ACTION has no declaration of its own and resolves against its owner's (SourceScopes.BodiesOf).
        var scope = SourceScopes.Scope(site.Code == ItemKind.PlcAction ? null : declaration, ownerDeclaration);
        var (body, unsupported) = ReadBody(iobj, scope);

        Accessor? getter = null, setter = null;
        if (kind is ItemKind.Kinds.Property or ItemKind.Kinds.InterfaceProperty)
        {
            int n = ChildCount(site.Ref);
            for (int i = 1; i <= n; i++)
            {
                var acc = ChildAt(site.Ref, i);
                var accessor = ReadAccessor(acc, scope);
                if (KindCode(acc) == ItemKind.PlcPropGet) getter = accessor;
                else if (KindCode(acc) == ItemKind.PlcPropSet) setter = accessor;
            }
        }

        return new Member(kind, site.Name, declaration, body, site.Folder, getter, setter, Unsupported: unsupported);
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

    private Accessor ReadAccessor(ItemRef acc, string? propertyScope)
    {
        var iobj = _om.ReadObject(acc.Native);
        var declaration = AccessorDeclaration.Keep(CodesysObjectModel.ReadAspectText(iobj, "Interface"));
        var (body, unsupported) = ReadBody(iobj, SourceScopes.Scope(declaration, propertyScope));
        return new Accessor(declaration, body, unsupported);
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
        return decl.TrimEnd('\n');
    }

    private string ReadDeclarationText(ItemRef item) =>
        item.Native is LibRefNode lib ? lib.Manifest : _om.ReadDeclaration(item.Native);

    /// <summary>The project's declarations as a graphical body sees them — its own, another item's by name, every
    /// global list — through the one helper both drivers share (<see cref="ProjectDeclarations"/>: the push asked
    /// first, the IDE half cached for one operation — dropped at the start of every
    /// <see cref="WalkItems"/>). A body is written on pull and read on push against the <see cref="NetworkScope"/>
    /// built from them (task 3.9).
    ///
    /// <para>A graphical box can call through a name this POU does not declare:
    /// `Mach1_AuxData.IEC_TIMERS.OffDelayLockDrives(...)` walks a GVL, then a struct, then reaches the timer.
    /// Each hop is one more item's declaration, and only the driver can ask the IDE for it.</para>
    ///
    /// <para>This driver had a push PRE-FLIGHT override (<c>ValidateSource</c>) whose one job was resolving an FB
    /// call's type from the declarations before the write, for v1's text-derived <c>Box(Type: instance)</c>. The v2
    /// reader resolves the type from this same scope, so the engine's pre-flight (which reads every body against
    /// <see cref="NetworkScopeFor"/>) covers it, and the override went with the resolver.</para></summary>
    private ProjectDeclarations Declarations => _declarations ??= new ProjectDeclarations(this, ReadDeclarationText);
    private ProjectDeclarations? _declarations;

    public NetworkScope NetworkScopeFor(string? declaration, IReadOnlyDictionary<string, string> pushedDeclarations) =>
        Declarations.ScopeFor(declaration, pushedDeclarations);

    /// <summary>A graphical body into <paramref name="node"/>, inside one modify transaction.</summary>
    private void WriteGraph(object node, NetworkBody graph, NetworkScope scope) =>
        _om.ModifyObject(node, iobj => CodesysNetworkWriter.Write(iobj, graph, scope));


    /// <summary>The item's KIND, from the TREE — never from its text.
    ///
    /// <para>It used to fall back to parsing the declaration's header when the tree code did not map. That arm
    /// was unreachable and load-bearing-looking, which is the worst combination: every route into
    /// <c>ReadContent</c> is already gated on <c>ItemKind.Map</c> answering (<c>ProjectSnapshot</c>,
    /// <c>FetchService</c>, <c>PushService</c>, <c>ItemLookup</c>), so the fallback could only ever fire if one
    /// of those gates broke — and then it would answer with a GUESS instead of failing, putting a kind on the
    /// wire that the tree does not agree with.</para>
    ///
    /// <para>Failing loud costs nothing here: <c>Versioning.SafeVersion</c> turns the throw into one logged
    /// "unreadable" item rather than a dead walk.</para></summary>
    private string KindOf(ItemRef item) =>
        ItemKind.Map(KindCode(item))
        ?? throw new BridgeException(BridgeErrorCodes.InternalError,
            $"'{Name(item)}' has tree kind {KindCode(item)}, which maps to no Volt kind - it should never have " +
            "reached ReadContent, because every caller filters on that map first.");

    // ── member write ──────────────────────────────────────────────────────────────────────────────


    private void WriteMembers(ItemRef pou, IReadOnlyList<Member> members, string? ownerDeclaration,
                              IReadOnlyDictionary<string, string> pushedDeclarations)
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


            // An ACTION has no declaration of its own and resolves against its owner's (SourceScopes.BodiesOf).
            var memberScope = SourceScopes.Scope(m.Kind == ItemKind.Kinds.Action ? null : m.Declaration, ownerDeclaration);
            var scope = NetworkScopeFor(memberScope, pushedDeclarations);
            NetworkBody? graph = m.Body is { } b && NetworkText.Is(b) ? NetworkText.Validate(b, scope) : null;
            if (graph is null)
            {
                _om.WriteSourceText(target.Native,
                    m.Kind == ItemKind.Kinds.Action ? null : m.Declaration,
                    ImplementationMarker.Written(m.Body));   // an UNSUPPORTED body is never written back
            }
            else
            {
                _om.WriteSourceText(target.Native, m.Kind == ItemKind.Kinds.Action ? null : m.Declaration, null);
                WriteGraph(target.Native, graph, scope);
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
            WriteAccessor(target, ItemKind.PlcPropGet, m.Getter, ownerIsInterface, pushedDeclarations,
                          memberScope);
            WriteAccessor(target, ItemKind.PlcPropSet, m.Setter, ownerIsInterface, pushedDeclarations,
                          memberScope);
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
                               IReadOnlyDictionary<string, string> pushedDeclarations,
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
                var was = ReadAccessor(live.Value, ownerDeclaration);
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
            // compiling: `';' expected instead of '0'`, `';' expected instead of 'FBD'` - the v1
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
            var accessorScope = SourceScopes.Scope(accessor.Declaration, ownerDeclaration);
            var scope = NetworkScopeFor(accessorScope, pushedDeclarations);
            var graph = accessor.Code is { } ac && NetworkText.Is(ac) ? NetworkText.Validate(ac, scope) : null;
            if (graph is null)
            {
                // AN UNSUPPORTED BODY IS NEVER WRITTEN BACK — the same guard `WriteContent` and `WriteMembers` carry,
                // and this arm was rewritten without it. An accessor authored in CFC materializes as its
                // UNSUPPORTED line, `BodyFormatGuard` passes it (restating that line is the ordinary
                // no-op that keeps the enclosing POU pushable at all), and writing it into a CFC aspect
                // throws — after the POU's declaration and earlier members have already committed. That
                // POU could then never be pushed again while the CFC accessor existed.
                _om.WriteSourceText(child.Native, accessor.Declaration,
                                    ImplementationMarker.Written(accessor.Code));
                return;
            }

            _om.WriteSourceText(child.Native, accessor.Declaration, null);
            WriteGraph(child.Native, graph, scope);
            return;
        }
    }

    // ── non-source manifest ──
    /// <summary>Kinds this SESSION has already reported as having no descriptor reader. Instance-scoped, not
    /// static: the DLL outlives a PipeHost.Stop()/Start() inside a running IDE, and a support session that
    /// restarts the bridge must get the warning again rather than inherit a silenced process.</summary>
    private readonly HashSet<string> _kindsWithoutReader = new HashSet<string>(StringComparer.Ordinal);

    /// <summary>Write a task's settings back. The engine has already PARSED and GATED the descriptor, so
    /// what arrives is data this driver cannot misread — all that is left is the vendor call.</summary>
    public void WriteTask(ItemRef task, TaskSettings settings) => _om.WriteTask(task.Native, settings);

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
