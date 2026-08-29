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

namespace Volt.Cli.Ide.Codesys;

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
        foreach (var site in MemberSites(item))
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
            CodesysNetworkWriter.Write(_om, item.Native, graph);
        }

        WriteMembers(item, content.Members);
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
                var language = ReadViewMode(impl);
                var model = CodesysNetworkReader.Read(impl, language);
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
    private static BodyLanguage ReadViewMode(object impl)
    {
        var mode = NwlInterop.Require(impl, "DefaultViewMode").ToString() ?? "";
        if (mode.Equals("Ld", StringComparison.OrdinalIgnoreCase)) return BodyLanguage.Ld;
        if (mode.Equals("Fbd", StringComparison.OrdinalIgnoreCase)) return BodyLanguage.Fbd;
        throw new NotSupportedException(
            $"CODESYS: the graphical body's view mode is '{mode}'. Volt authors FBD and LD; IL is the same " +
            "network model in a third view and is not written back, so the body is refused rather than " +
            "re-rendered as something the engineer did not author.");
    }

    /// <summary>The marker language for an unsupported graphical aspect — <c>CFCImplementationObject</c> to
    /// <c>CFC</c>.</summary>
    private static string MarkerLanguage(string aspectTypeName) =>
        aspectTypeName.EndsWith("ImplementationObject", StringComparison.Ordinal)
            ? aspectTypeName.Substring(0, aspectTypeName.Length - "ImplementationObject".Length).ToUpperInvariant()
            : aspectTypeName.ToUpperInvariant();

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

    /// <summary>Every member of a POU and the folder it sits in, walked off the project TREE.
    /// <para><b>No catch, deliberately.</b> A swallowed fault here does not degrade gracefully — it MUTATES the
    /// project on the next push. A member the walk failed to reach materializes with a null folder, the writer
    /// emits no <c>%FOLDER</c> directive, the pulled file looks legitimately folder-less, and the next push
    /// resolves that null to the POU ROOT and creates a DUPLICATE beside the real member. Because the version
    /// hash is taken over the folder-less text, <c>volt status</c> reports clean the whole way through. A
    /// partial map is not a degraded answer, it is a wrong one. The isolation boundary is one level up, in
    /// <c>Versioning.SafeVersion</c>, which catches per item and logs which one.</para></summary>
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
            // A property's GET/SET are not members in their own right — they are the property's accessors, and
            // they are read with it.
            // ONLY kinds the file layout can carry. A transition is inlined in the POU and is NOT a member:
            // no reader models one, so it never reaches the file and can never be in a pushed member set —
            // yielding it here would put it in the reconciliation and a push would delete it. Accessors are
            // excluded too: a property's GET/SET are read WITH the property.
            if (!ItemKind.IsMember(code)) continue;

            yield return new MemberSite(string.IsNullOrEmpty(basePath) ? null : basePath, child, name, code);
        }
    }

    private Member ReadMember(MemberSite site, bool ownerIsInterface)
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
        _ => ItemKind.Map(code) ?? ItemKind.Kinds.Method,
    };

    private Accessor ReadAccessor(ItemRef acc)
    {
        var iobj = _om.ReadObject(acc.Native);
        var (_, body) = ReadBody(iobj);
        return new Accessor(KeepDecl(CodesysObjectModel.ReadAspectText(iobj, "Interface")), body);
    }

    /// <summary>A member's declaration, from the member's OWN declaration aspect.
    /// <para><b>An ACTION is the one member with no declaration to read</b>, in any IDE: IEC gives an action a
    /// name and a body and nothing else. Its header is COMPOSED here rather than read — that is not a fallback
    /// for a missing value, it is the whole of what an action's header is.</para></summary>
    private string MemberDeclaration(MemberSite site)
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

    // ── member write ──────────────────────────────────────────────────────────────────────────────

    private void WriteMembers(ItemRef pou, IReadOnlyList<Member> members)
    {
        if (members.Count == 0) return;

        // ONE walk for the whole write. FindChildByName used to re-run MemberSites per member, and MemberSites
        // CLASSIFIES every child it passes - a ReadObject plus an interface-name query each. For a POU with 20
        // members that is 20 walks and ~400 classifications to write 20 bodies. The tree does not change during
        // this loop: the member set was reconciled before it, and CODESYS handles survive a child write.
        var byName = new Dictionary<string, ItemRef>(StringComparer.Ordinal);
        foreach (var site in MemberSites(pou)) byName[site.Name] = site.Ref;

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
                CodesysNetworkWriter.Write(_om, target.Native, graph);
            }

            // The accessor's own kind, decided by the OWNER - the same rule the member kind follows. Passing
            // the POU code for an interface property would make the crash guard in WriteAccessor unreachable.
            var itfProp = m.Kind == ItemKind.Kinds.InterfaceProperty;
            WriteAccessor(target, itfProp ? ItemKind.PlcItfPropGet : ItemKind.PlcPropGet, m.Getter);
            WriteAccessor(target, itfProp ? ItemKind.PlcItfPropSet : ItemKind.PlcPropSet, m.Setter);
        }
    }

    /// <summary>Write a property's GET or SET. The accessor EXISTS by the time this runs - creating and deleting
    /// one is <c>PushService.ReconcileAccessor</c>'s job, with every other child - so a null here means only
    /// "nothing to write", never "remove it".
    ///
    /// <para><b>An INTERFACE property accessor is a bodiless stub and must never be written to.</b> It declares
    /// that a getter/setter exists and nothing more. TwinCAT COM rejects a declaration/implementation write on
    /// one and can HARD-CRASH the IDE (RPC 0x800706BE), on read as well as write - measured, and the reason the
    /// original fix created these as bodiless "ST" stubs and wrote nothing. The rule was lost with the PLCopen
    /// transport, where the import wrote the whole object at once and never touched an accessor directly.</para>
    /// </summary>
    private void WriteAccessor(ItemRef property, int code, Accessor? accessor)
    {
        if (accessor is null) return;
        if (code is ItemKind.PlcItfPropGet or ItemKind.PlcItfPropSet) return;

        int n = ChildCount(property);
        for (int i = 1; i <= n; i++)
        {
            var child = ChildAt(property, i);
            if (KindCode(child) != code) continue;
            _om.WriteSourceText(child.Native, accessor.Declaration, accessor.Code);
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
