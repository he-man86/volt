using System.Globalization;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text.RegularExpressions;
using Volt.Engine;
using Volt.Contracts;
using Volt.Engine.Format.Body;
using Volt.Engine.Host;
using Volt.Engine.Ide;
using Volt.Engine.Item;

namespace Volt.Ide.Twincat;

/// <summary>
/// Access to the live TwinCAT/Beckhoff project through the XAE automation model — the DTE plus the
/// system manager and PLC tree — reached out-of-process over COM. The COM objects are late-bound through
/// <c>dynamic</c>; that lives ONLY here, behind the typed <see cref="ItemRef"/>/<c>object</c> boundary,
/// so the <c>BeckhoffDriver</c> facets (and Core) stay dynamic-free. This is the Beckhoff analogue of the
/// CODESYS bridge's <c>CodesysObjectModel</c>: the driver holds one of these and delegates all genuine
/// IDE access to it.
///
/// <para>Every member here must be invoked on the bridge's STA thread (see <c>StaDispatcher</c>) —
/// the COM objects are apartment-bound.</para>
/// </summary>
internal sealed partial class TcObjectModel
{
    private dynamic? _dte;
    private dynamic? _sysManager;
    private dynamic? _plcNode;
    private string? _projectName;
    // The identity health reports (DIALECT V5). The product is the running shell's own answer, read at every DTE bind;
    // the vendor is the XAE exe's, read once (the xae pid is fixed for the worker's life); the build is the open
    // SOLUTION's remote manager, re-read with every snapshot because the solution can change inside one DTE.
    private string? _ideVersion;
    private string? _productName;
    private string? _productVersion;
    private string? _productVendor;

    // The ONE XAE window this worker owns, by its stable process id. Selection and recovery re-acquire THIS pid
    // (stable across a DTE re-registration), never search other windows. Set once at startup by ConnectToPid.
    private int _xaePid;

    // The DESIRED selection — the project this worker serves: the one a client last picked by name (the connector's
    // `select`), or, until one does, the one the ATTACH took up (`AttachFirstProject`). Recovery (ReattachProject,
    // after a project close / re-registration / RPC drop) re-establishes THIS, by its stable NAME, instead of resolving
    // the first-available. Without it, any hiccup silently flipped a two-XAE setup to the other project — and a
    // bridge no client ever sends `select` (the relay) never recovered at all. Deliberately SURVIVES Disconnect.
    private string? _wantProject;

    // "Connected" = a project is BOUND: its DTE + TwinCAT project (system manager) are resolved. It deliberately
    // does NOT require the PLC node — that is CONTENT, resolved lazily on the first content op (see EnsurePlc), so a
    // select/health never has to walk into the PLC application. Plain field reads — safe off the STA thread. The
    // `is not null` pattern is load-bearing on a `dynamic` field: `!= null` would compile to a runtime-binder
    // BinaryOperation call site (a bound COM call), while a pattern match binds against the static type object.
    public bool IsConnected => _dte is not null && _sysManager is not null;
    /// <summary>The TwinCAT build (<c>TcRemoteManager.Version</c>), null when it states none — never the shell's.</summary>
    public string? IdeVersion => _ideVersion;
    /// <summary>The shell's <c>DTE.Name</c> (`TcXaeShell`).</summary>
    public string? ProductName => _productName;
    /// <summary>The shell's <c>DTE.Version</c> (`15.0`).</summary>
    public string? ProductVersion => _productVersion;
    /// <summary>The XAE exe's <c>CompanyName</c> (`Beckhoff`).</summary>
    public string? ProductVendor => _productVendor;
    public string? ProjectName => _projectName;

    /// <summary>Whether this worker has a project to serve — picked by a client's `select`, or taken up by the attach.
    /// When true, recovery re-establishes THAT project by its stable name; when false, the window has no TwinCAT
    /// project open yet (health lists what it has, none serving).</summary>
    public bool HasSelection => !string.IsNullOrEmpty(_wantProject);

    // ── health (TOP-LEVEL liveness only — no content) ────────────────
    /// <summary>Does the bound IDE/solution still respond? A single top-level read (project count) — no PLC node, no
    /// tree walk. This is the ONLY thing the health poll touches.</summary>
    public bool ProbeIdeAlive()
    {
        if (_dte == null) return false;
        try { var _ = (int)_dte.Solution.Count; return true; }
        catch { return false; }
    }

    /// <summary>Whether the solution has unsaved changes, or null if it can't be read.</summary>
    public bool? ProjectDirty()
    {
        try { return !_dte!.Solution.Saved; } catch { return null; }
    }

    // ── referenced-library signatures ───────────────────────────────

    /// <summary>Every referenced library's public declarations, from the library manager's own call.
    ///
    /// <para><c>ProduceAllLibrarySignatures()</c> takes no argument and answers for ALL libraries at once —
    /// which matters, because the per-library <c>ProduceLibrarySignatures(pLibRef: VT_PTR)</c> wants a raw
    /// pointer an RCW cannot satisfy (DIALECT C2c). So this is one COM call for the whole project, not one per
    /// library.</para>
    ///
    /// <para>A project with no <c>References</c> node legitimately has no signatures and answers empty. A
    /// FAILING call is not swallowed: reporting "no libraries" for a project that has them would make the LSP
    /// mark every library call unresolved, which is worse than a loud failure.</para></summary>
    public IReadOnlyList<Volt.Engine.Library.LibSignature> ExtractLibrarySignatures()
    {
        // ONCE PER PLC PROJECT (openspec multi-application-tree, design §6): each has its own library manager, and its
        // signatures land beside ITS `.library` files — each signature carries the PLC project it was read from.
        var all = new List<Volt.Engine.Library.LibSignature>();
        foreach (var plc in Plcs())
        {
            Use(plc);
            var manager = FindLibraryManager(PlcRoot(), 0);
            if (manager == null)
            {
                VoltLog.Debug($"twincat lib signatures: no library manager under {plc} — no references");
                continue;
            }

            // A manager that answers NO document is not a project with no libraries (cli-bridges review B7).
            var xml = (string?)((dynamic)manager).ProduceAllLibrarySignatures()
                ?? throw new InvalidOperationException(
                    $"twincat: the library manager of {plc} answered ProduceAllLibrarySignatures() with nothing — refused " +
                    "rather than read as a project with no libraries, which would delete every library-signature file");
            var sigs = TcLibrarySignatures.Parse(xml);
            VoltLog.Debug($"twincat lib signatures: {plc}: {xml.Length} chars -> {sigs.Count} signatures");
            all.AddRange(sigs.Select(s => s with { Application = plc.Path }));
        }
        return all;
    }

    /// <summary>The library manager (TwinCAT names the node "References"), found by ITEM TYPE rather than by
    /// name so a localized or renamed node still resolves. Bounded: it sits directly under the PLC project.
    ///
    /// <para><b>NO CATCH — null means ABSENT, never "I could not tell".</b> This walked the tree behind three
    /// swallows, so a COM fault (RPC_E_CALL_REJECTED is the everyday one — a modal dialog in XAE blocks COM)
    /// came back as null and <see cref="ExtractLibrarySignatures"/> turned that into an EMPTY signature list
    /// plus a Debug line that is off by default. That is not a cosmetic loss: <c>fetch</c> reports
    /// <c>librariesRefreshed</c> TRUE alongside the empty list, and <c>IdeTree.DroppedLibraryFile</c> then
    /// removes EVERY library-signature file the client holds — a real deletion in the engineer's repository,
    /// and a STICKY one, because the next fetch sees unchanged <c>.library</c> versions, re-renders nothing,
    /// and leaves the files gone until a library version changes. Every library call reads as unresolved in
    /// the LSP until then.</para>
    ///
    /// <para>The swallow also destroyed the HRESULT: an RPC fault escaping here is exactly what
    /// <c>BeckhoffDriver.ShouldMarkDegraded</c> classifies, so the session never degraded and never recovered
    /// while every call failed identically. <see cref="ExtractLibrarySignatures"/>'s own contract already said
    /// this in words — "a FAILING call is not swallowed: reporting 'no libraries' for a project that has them
    /// is worse than a loud failure" — and the CODESYS twin throws on both of its equivalents. The same rule is
    /// written on <see cref="ItemType"/> ("NO CATCH") and on <c>PlcRoot()</c> ("NO FALLBACK"); this call site
    /// simply never got it.</para></summary>
    private object? FindLibraryManager(object node, int depth)
    {
        if (depth > 3) return null;
        if (ItemType(node) == ItemKind.PlcLibMan) return node;

        var n = ChildCount(node);
        for (int i = 1; i <= n; i++)
        {
            object child;
            // A POU Volt must not open (DIALECT C2i) is not the library manager, nor holds it.
            try { child = ChildAt(node, i); }
            catch (UnreadableItemException) { continue; }
            if (FindLibraryManager(child, depth + 1) is { } hit) return hit;
        }

        return null;
    }

    // ── tree primitives ─────────────────────────────────────────────
    /// <summary>The ADDRESSED PLC project's root (its NestedProject, <see cref="CurrentPlc"/>). Lazily resolves the PLC
    /// projects on first use (EnsurePlc) — this is THE point where a content op reaches into a PLC application. Asked of
    /// the PLC project item once per operation (<see cref="TcPlc.Root"/>, dropped with the snapshots).</summary>
    public object PlcRoot()
    {
        EnsurePlc();

        // NO FALLBACK: a stale-handle RPC fault here must reach `ShouldMarkDegraded`, so `RunRead` recovers. A
        // substitute node is the origin of every walk — a wrong one shifts every folder path in the project.
        return CurrentPlc.Root ??= (object)_plcNode!.NestedProject;
    }

    // Raw COM reads — these THROW on failure; the tree-walk callers catch and skip/continue (that
    // skip-on-failure is part of the walk algorithm, so it stays in the facet, not here).
    /// <summary>A node's child count — and, for a PLC folder, the check that the Solution Explorer snapshot lists
    /// exactly that many (<see cref="RequireListed"/>). Every scan reads the count before any child, so a folder the
    /// snapshot cannot vouch for refuses there, before a child of it is opened: the walk reports its whole subtree
    /// unwalked, a lookup fails named.</summary>
    public int ChildCount(object node)
    {
        var count = RawChildCount(node);
        if (ItemType(node) == ItemKind.PlcFolder) RequireListed(Explorer(), node, count);
        return count;
    }

    /// <summary><see cref="ChildCount(object)"/> of a node whose kind the caller has just read (<see cref="ItemType"/>) —
    /// the walk classifies every child before it counts that child's children.</summary>
    public int ChildCount(object node, int kind)
    {
        var count = RawChildCount(node);
        if (kind == ItemKind.PlcFolder) RequireListed(Explorer(), node, count);
        return count;
    }

    private static int RawChildCount(object node) => (int)((dynamic)node).ChildCount;
    /// <summary>THE single point where a PLC tree child is opened — every walk, lookup and helper reaches children
    /// through here (DIALECT C2i).
    ///
    /// <para>Fast path, which every real project takes: the Solution Explorer snapshot flags nothing, and this is the
    /// plain <c>Child[i]</c>. Guarded path, for a folder that holds a POU the IDE does not read as a POU: its children
    /// are addressed BY NAME (<c>LookupChild</c>, after checking its child count against the hierarchy's), and the
    /// flagged name is answered with <see cref="UnreadableItemException"/> without any call into XAE — touching it
    /// would kill TcXaeShell, and a <c>try</c> here would only catch the corpse. Addressing by name rather than
    /// skipping an index keeps the safety off the assumption that the hierarchy's ORDER matches the tree's (it did
    /// on the three folders measured; the vendor does not promise it).</para></summary>
    public object ChildAt(object node, int index1Based)
    {
        var explorer = Explorer();
        if (explorer.Clean || GuardedAt(explorer, node) is not { } guarded)
            return (object)((dynamic)node).Child[index1Based];

        var count = RawChildCount(node);
        if (count != guarded.Names.Count)
            throw new BridgeException(ConflictCodes.ItemUnverified,
                $"'{PathOf(node)}' holds a POU Volt must not touch (DIALECT C2i), so its children are addressed by " +
                $"name — and the PLC tree lists {count} of them where the Solution Explorer lists " +
                $"{guarded.Names.Count}. This folder is not read.");
        // A DUT and a folder may share a name (DIALECT D34): addressed by name, both indices would answer the one node
        // LookupChild finds, reading it twice and the other never — a folder's POUs missing in silence (5Qa review).
        if (guarded.Names.GroupBy(n => n, StringComparer.OrdinalIgnoreCase).FirstOrDefault(g => g.Count() > 1) is { } twice)
            throw new BridgeException(ConflictCodes.ItemUnverified,
                $"'{PathOf(node)}' holds a POU Volt must not touch (DIALECT C2i), so its children are addressed by " +
                $"name — and two of them are named '{twice.Key}' (DIALECT D34), which a name cannot tell apart. This " +
                "folder is not read.");
        var name = guarded.Names[index1Based - 1];
        if (guarded.Untouchable.Contains(name))
            throw new UnreadableItemException(name, ExplorerSnapshot.Reason(name), ExplorerSnapshot.PouKind);
        return (object)((dynamic)node).LookupChild(name);
    }

    /// <summary>THE SNAPSHOT MUST LIST WHAT THE TREE HOLDS, or it cannot vouch for it. A folder's flags come from the
    /// hierarchy alone, so a folder the hierarchy lists short — or not at all (a read that came back incomplete, a
    /// project system that fills children lazily) — would look like a folder with nothing to avoid, and the fast path
    /// would open a broken POU in it: XAE dies (C2i). So a PLC folder outside any POU must be listed with exactly the
    /// tree's child count, or it is refused, named, and not read (the walk reports it unwalked: nothing beneath it reads
    /// as deleted). Only a FOLDER can hold a top-level POU; the PLC project node itself is checked once per snapshot
    /// (<see cref="Explorer"/>).</summary>
    private void RequireListed(ExplorerSnapshot explorer, object node, int count)
    {
        if (RelPath(node) is not { } rel || explorer.InsidePou(rel)) return;
        var listed = explorer.ListedChildren(rel);
        if (listed != count && CurrentPlc.StaleSinceWrite)
        {
            // Volt's own create or delete in this operation is newer than the snapshot: ask a fresh one.
            ForgetExplorer();
            explorer = Explorer();
            if (explorer.InsidePou(rel)) return;
            listed = explorer.ListedChildren(rel);
        }
        if (listed != count)
            throw new BridgeException(ConflictCodes.ItemUnverified,
                $"'{rel}' holds {count} children in the PLC tree, and the Solution Explorer lists " +
                $"{(listed is { } n ? n.ToString(CultureInfo.InvariantCulture) : "no such folder")}. Volt reads a folder only when the hierarchy " +
                "vouches for every child — a POU it does not list could be one that crashes TcXaeShell (DIALECT C2i). " +
                "This folder is not read.");
    }

    /// <summary>Reads a SYSTEM project's Solution Explorer hierarchy, root first — by a reader of the XAE's own bitness
    /// (<see cref="TcHierarchy"/>); replaceable so the offline suite can hand in a hierarchy (the DTE there is a plain
    /// double, not an OLE service provider). Null when the solution holds no such system project. One read covers every
    /// PLC project of the system project, and is kept for the operation (<see cref="_systemHierarchies"/>): the read walks
    /// the whole system project (~47 ms on MultiProject's `TwinCAT Project14`), and was paid once per PLC project.</summary>
    internal Func<object, string, ExplorerNode?> ReadExplorer { get; set; }

    /// <summary>This operation's system-project hierarchies, by system project name; dropped with the snapshots
    /// (<see cref="ForgetExplorer"/>).</summary>
    private readonly Dictionary<string, ExplorerNode?> _systemHierarchies = new(StringComparer.Ordinal);

    public TcObjectModel() { ReadExplorer = (dte, system) => TcHierarchy.ReadSystem(_xaePid, dte, system); }

    /// <summary>Why this bridge serves nothing, or null: the IDE's hierarchy cannot be read by any reader Volt has
    /// (<see cref="HierarchyUnreachableException"/>), and Volt does not walk the TwinCAT tree without it (C2i). Set by
    /// the start check (<see cref="CheckHierarchy"/>) or the first read that meets it, and kept: what is missing is
    /// the machine's, and no retry installs it.</summary>
    public string? Unsupported { get; private set; }

    /// <summary>Asks, without calling into XAE, whether a reader of this XAE's hierarchy can exist here — once, at
    /// the worker's start, so <c>health</c> states it before any op runs into it.</summary>
    public void CheckHierarchy()
    {
        if (TcHierarchy.Missing(_xaePid) is { } missing) Unsupported = Sentence(missing);
    }

    private BridgeException Unreachable(string missing)
    {
        Unsupported = Sentence(missing);
        return new BridgeException(BridgeErrorCodes.IdeUnsupported, Unsupported);
    }

    /// <summary>The one sentence <c>health</c> and every refused op carry (<c>BridgeErrorCodes.IdeUnsupported</c>):
    /// the IDE, as its identity reads (V5), and what it lacks.</summary>
    private string Sentence(string missing) =>
        $"{_productName ?? "TwinCAT XAE"} {_productVersion ?? "(version unread)"}" +
        (_ideVersion is { } build ? $" (TwinCAT {build})" : "") +
        $": {missing}, so the bridge cannot read XAE's Solution Explorer and serves nothing (DIALECT C2i).";

    /// <summary>The addressed PLC project's snapshot for this operation (<see cref="TcPlc.Explorer"/>).</summary>
    private ExplorerSnapshot? _explorer
    {
        get => CurrentPlc.Explorer;
        set => CurrentPlc.Explorer = value;
    }

    /// <summary>The addressed PLC project root's tree path (<see cref="TcPlc.RootPath"/>).</summary>
    private string? _plcRootPath
    {
        get => CurrentPlc.RootPath;
        set => CurrentPlc.RootPath = value;
    }

    /// <summary>Every POU flagged in this session (keyed <c>&lt;PLC project path&gt;|folder^name</c>) that Volt has not since deleted
    /// through its parent. Its caption can heal while it stays the tree item that was loaded broken — the engineer
    /// fixes the text in the editor — and nothing measured says the crash follows the caption rather than the load
    /// (every measured repair made a NEW item: delete + create). So it stays unopened, refused by name, until Volt
    /// itself replaces it (a forced push).</summary>
    private readonly HashSet<string> _flaggedThisSession = new(StringComparer.OrdinalIgnoreCase);

    /// <summary>Drop the snapshots — every PLC project's — so the next child access reads the hierarchy afresh. Called
    /// at the start of every operation (<c>BeckhoffDriver.MarshalToIdeThread</c>), and after a structural write while
    /// something is flagged (a create or delete changes the names a guarded folder is addressed by).</summary>
    public void ForgetExplorer()
    {
        _systemHierarchies.Clear();
        if (_plcs is null) return;
        foreach (var plc in _plcs) { plc.Explorer = null; plc.RootPath = null; plc.Root = null; plc.StaleSinceWrite = false; }
    }

    /// <summary>A CLEAN snapshot read before a structural write in this operation: it still lists the old child counts.
    /// Kept (a clean project addresses children by index and needs nothing else from it), but a count it disagrees on is
    /// asked again of a fresh read before the folder is refused (<see cref="RequireListed"/>) — the refusal is for a
    /// hierarchy that came back short, not for one Volt's own create or delete made stale (5Qa review: a create + update
    /// + delete batch, and every member create's re-find, were refused live "holds 2 … the Solution Explorer lists 3").
    /// Per PLC project: <see cref="TcPlc.StaleSinceWrite"/>.</summary>
    private void StructureChanged()
    {
        if (_explorer is { Clean: false }) ForgetExplorer();
        else if (_explorer is not null) CurrentPlc.StaleSinceWrite = true;
    }

    /// <summary>The snapshot for this operation, read once. REQUIRED: without it Volt cannot know which child would
    /// crash XAE, so an unreadable hierarchy fails the operation — there is no unguarded walk to fall back to.</summary>
    public ExplorerSnapshot Explorer()
    {
        if (_explorer is { } known) return known;
        var plcProject = GetName(PlcRoot());
        ExplorerNode? node;
        // SCOPED TO ITS SYSTEM PROJECT: two system projects may each hold a PLC project of one name (`Untitled1` in
        // `TwinCAT Project14` and in `TwinCAT Project1`), and a name alone would read the first one's hierarchy.
        try
        {
            var system = CurrentPlc.System;
            if (!_systemHierarchies.TryGetValue(system, out var hierarchy))
                _systemHierarchies[system] = hierarchy = ReadExplorer(_dte!, system);
            node = hierarchy is null ? null : TcSolutionExplorer.Find(hierarchy, plcProject);
        }
        catch (HierarchyUnreachableException ex) { throw Unreachable(ex.Message); }
        catch (Exception ex)
        {
            throw new BridgeException(ConflictCodes.ItemUnverified,
                "the Solution Explorer hierarchy is unreadable; Volt does not walk the TwinCAT tree without it " +
                $"(DIALECT C2i): {ex.Message}");
        }
        if (node is null)
            throw new BridgeException(ConflictCodes.ItemUnverified,
                $"the Solution Explorer hierarchy has no node for the PLC project '{plcProject}'; Volt does not walk " +
                "the TwinCAT tree without it (DIALECT C2i)");
        var key = CurrentPlc.Path + "|";
        // A bare-captioned POU the system manager still RESOLVES BY PATH is a tree item of this load — created or
        // rewritten since XAE loaded the project — and reads like any other, as CODESYS reads it. One loaded broken is
        // not in the path index: LookupTreeItem answers "not found" (0x98510001) without harm, where Child/LookupChild on
        // it kills XAE. Measured live 2026-10-04 (openspec bridge-refusal-review 8.4, DIALECT C2i): in session found
        // (ItemType 604); after a solution close + reopen, and after a project reload-from-disk, not found, XAE alive.
        var rootPath = _plcRootPath ??= PathOf(PlcRoot());
        var snapshot = ExplorerSnapshot.From(node,
            _flaggedThisSession.Where(k => k.StartsWith(key, StringComparison.OrdinalIgnoreCase)).Select(k => k.Substring(key.Length)).ToList(),
            inThisLoad: rel => LookupPath(rootPath + "^" + rel) is not null);
        var rootCount = RawChildCount(PlcRoot());
        if (snapshot.ListedChildren("") != rootCount)
            throw new BridgeException(ConflictCodes.ItemUnverified,
                $"the PLC project '{plcProject}' holds {rootCount} children in the PLC tree, and the Solution Explorer " +
                $"lists {snapshot.ListedChildren("")}; Volt does not walk the TwinCAT tree on a hierarchy that does not " +
                "vouch for every child (DIALECT C2i)");
        _explorer = snapshot;
        foreach (var path in snapshot.UntouchablePaths) _flaggedThisSession.Add(key + path);
        if (!_explorer.Clean)
            VoltLog.Warn($"twincat: {plcProject} holds POUs the IDE does not read as POUs - not opened (DIALECT C2i)");
        return _explorer;
    }

    /// <summary>The guarded folder <paramref name="node"/> is, or null. Its tree path is read only here, on a project
    /// that has something flagged.</summary>
    private ExplorerSnapshot.Guarded? GuardedAt(ExplorerSnapshot explorer, object node) =>
        RelPath(node) is { } rel ? explorer.At(rel) : null;

    /// <summary><paramref name="node"/>'s path below the PLC project (<c>""</c> for the project itself), in the
    /// snapshot's spelling; null for a node outside it.</summary>
    private string? RelPath(object node)
    {
        var root = _plcRootPath ??= PathOf(PlcRoot());
        var path = PathOf(node);
        if (string.Equals(path, root, StringComparison.Ordinal)) return "";
        return path.StartsWith(root + "^", StringComparison.Ordinal) ? path.Substring(root.Length + 1) : null;
    }
    public object Parent(object node) => (object)((dynamic)node).Parent;
    public string GetName(object node) => (string)((dynamic)node).Name ?? "";

    // TwinCAT's native ItemType IS the vendor-neutral code.
    //
    // NO CATCH. This swallowed every COM fault and answered ItemKind.Unknown, with a comment claiming "an
    // unreadable node is skipped, never phantom-emitted" - and nothing skipped it. The walk emitted the item
    // with kind -2, nothing reached `unwalked`, so WalkResult.Complete stayed TRUE, FetchService did not
    // suppress deletions, and a pull DELETED the engineer's file for an item sitting in the IDE.
    //
    // It also disarmed two engine guards FROM BELOW, both of which are careful for exactly this reason:
    // ItemLookup.Find ("Refusing to report it as absent") returned null, so a push CREATED an item that already
    // exists; and MemberSites.Of ("No catch, deliberately") dropped a member, so the next push DELETED it.
    // CODESYS's KindCodeOf has no catch either. The fault belongs to the WALK, which records it as an unwalked
    // subtree - a signal the engine can act on, unlike a kind nobody can distinguish from a real one.
    public int ItemType(object node) => (int)((dynamic)node).ItemType;

    public object CreateChild(object parent, string name, int kindCode, string? language = null)
    {
        // The 4th arg (vInfo) is the implementation language for a POU body. TwinCAT rejects ANY String
        // vInfo for a FUNCTION ("vInfo (Type: String) not supported") — omit it (Type.Missing).
        // Interfaces and their children have no body language — pass null (TC rejects "ST" for these).
        // TC does not accept "LD" directly — create as FBD; the ladder view is stored as
        // DefaultViewMode metadata in the NWL archive, which the read keeps.
        var lang = language is "LD" ? "FBD" : (language ?? "ST");

        // A DUT is created as the STRUCT skeleton (606), never as 623. On TwinCAT 623 is not a generic DUT — it is
        // TREEITEMTYPE_PLCDUTALIAS, which is why `CreateChild` refuses a null vInfo there ("Base class not
        // specified!") and takes any string as the alias's BASE CLASS. Volt passed the body language, so every DUT
        // was created as an alias to a type named "ST": a malformed object whose `<baseType/>` is empty, whose own
        // export TwinCAT then refuses to re-import ("incomplete content" against TC6). The per-child write only
        // survived it because `WriteText` landed the real declaration afterwards.
        //
        // Seeding the struct and writing the pushed DECLARATION into it is exactly what CODESYS does (`create_dut`
        // with `DutType.Structure`), and it is measured to work here for all four shapes: the compiler takes the
        // DECLARED shape (an enum body in the 606 seed is an enum to it). One seed, no per-subtype dispatch.
        // The TREE CODE does not follow: a DUT created this way reads 606 whatever its body in the live session
        // (DIALECT C2e, which corrects C2b — C2b's "an enum declaration becomes 605" was measured on the deleted
        // PLCopen import path; what a reload does to a CREATED DUT's code is unmeasured). Volt reads no subtype
        // at all: every DUT is `X.dut` (openspec `push-without-header-check` 5.P).
        if (kindCode == ItemKind.PlcDut) kindCode = ItemKind.PlcDutStruct;

        // A task is TWO items and the SYSTEM one comes first — measured, from the vendor's own refusal:
        // "No task 'X' found in Realtime-Settings!" (DIALECT C19b).
        if (kindCode == ItemKind.PlcTask) { StructureChanged(); return CreatePlcTask(parent, name); }

        // A POU is created as the FUNCTION_BLOCK (604) whatever its text — ONE seed, as the DUT's is the struct
        // (openspec `push-without-header-check` 5.Q, design S1): the declaration written next is what the compiler
        // takes (a 604 holding PROGRAM text builds clean as a program, DIALECT C2f), and a reload re-derives the tree
        // code from it (C2h). Nothing in Volt reads which of 602/603/604 a POU is. (The FUNCTION arm's
        // `Type.Missing` vInfo went with the per-kind POU extensions.)
        object? vInfo = kindCode switch
        {
            ItemKind.PlcDutStruct or ItemKind.PlcDutEnum or ItemKind.PlcDutUnion => System.Type.Missing,
            ItemKind.PlcItf => null,
            // A task's POU call is a REFERENCE with no body, so it has no language to be given: the name is the
            // whole of it. Read back by WriteCallList, so a wrong vInfo fails loudly rather than leaving a task
            // that calls nothing. (A task itself never reaches here — see CreatePlcTask.)
            ItemKind.PlcProgRef => System.Type.Missing,
            // Interface method/property: TC wants the return/data type as a STRING vInfo (carried in the
            // `language` arg by PushService, null when untyped) — NOT a body language. Matches the working
            // Beckhoff sample (BuildChildVInfo): method→returnType, property→dataType, else null.
            ItemKind.PlcItfMeth or ItemKind.PlcItfProp => (object?)language,
            // Interface property accessors: "ST" body language (per the Beckhoff CreateChild sample).
            ItemKind.PlcItfPropGet or ItemKind.PlcItfPropSet => "ST",
            _ => lang,
        };
        StructureChanged();
        return (object)((dynamic)parent).CreateChild(name, kindCode, "", vInfo);
    }
    /// <summary>Remove a child. A TASK takes its SYSTEM task with it — the PLC item is only a reference, so
    /// deleting it alone leaves an orphan under Realtime Settings that nothing in the workspace can see, and
    /// every create/delete cycle would leak one more.</summary>
    public void DeleteChild(object parent, string name)
    {
        var linked = LinkedTaskOfChild(parent, name);
        // Replaced by Volt: a recreated item of the name is a new tree item, and opens normally.
        if (_flaggedThisSession.Count > 0 && RelPath(parent) is { } rel)
            _flaggedThisSession.Remove(CurrentPlc.Path + "|" + (rel.Length == 0 ? name : rel + "^" + name));
        StructureChanged();
        DiscardMemberDocuments(parent, name);
        ((dynamic)parent).DeleteChild(name);
        if (linked is { } path) DeleteSystemTask(path);
    }

    /// <summary>Close, WITHOUT saving, the open member documents of the child <paramref name="name"/> of
    /// <paramref name="parent"/> that is about to be deleted. XAE keeps a document per member a write reached
    /// (<c>X.TcPOU;X.M</c>, <c>X.TcPOU;X.P.Get</c>, <c>X.TcPOU;X\F\M</c> in a POU folder), dirty until a save, and deleting the item or the member asks, MODALLY,
    /// "Save changes to the following items?" — a modal dialog blocks every COM call (DIALECT D45). What is deleted needs
    /// no buffer, and an archive round trip carries the live texts in the archive (<see cref="LiveTexts"/>), so nothing is
    /// lost. The item's own document never asks, and is left alone.</summary>
    internal void DiscardMemberDocuments(object parent, string name)
    {
        if (_dte == null)
            throw new BridgeException(BridgeErrorCodes.PlcDisconnected, $"cannot delete '{name}': no IDE is attached");
        var pou = ItemKind.HoldsMembers(ItemType(parent)) ? parent : EnclosingPouOf(parent);
        var owner = pou is null ? null : GetName(pou);
        var mine = new List<object>();
        foreach (var doc in (System.Collections.IEnumerable)_dte.Documents)
        {
            var full = (string)((dynamic)doc).FullName;
            var at = full.IndexOf(';');
            if (at < 0) continue;
            var file = System.IO.Path.GetFileNameWithoutExtension(full.Substring(0, at));
            // The POU, then its member path: `X.M`, `X.P.Get`, and `X\Helpers\M` for a member in a POU folder.
            var steps = full.Substring(at + 1).Split('.', '\\');
            var ofIt = owner is null
                ? string.Equals(file, name, StringComparison.OrdinalIgnoreCase)
                  && string.Equals(steps[0], name, StringComparison.OrdinalIgnoreCase)
                : string.Equals(file, owner, StringComparison.OrdinalIgnoreCase)
                  && string.Equals(steps[0], owner, StringComparison.OrdinalIgnoreCase)
                  && steps.Skip(1).Contains(name, StringComparer.OrdinalIgnoreCase);
            if (ofIt) mine.Add(doc);
        }
        foreach (var doc in mine) ((dynamic)doc).Close(VsSaveChangesNo);
    }

    /// <summary>EnvDTE <c>vsSaveChanges.vsSaveChangesNo</c>.</summary>
    private const int VsSaveChangesNo = 2;
    /// <summary>Rename a tree item. A CASE-ONLY rename goes through a temporary name: done in one step and left unsaved,
    /// XAE renames the file in place and then asks, modally, whether to reload a file "changed outside the environment"
    /// (and a later delete of the item asks to save it) — a modal dialog blocks every COM call. Through another name
    /// first it asks nothing (DIALECT D45, measured on 4024).</summary>
    public void Rename(object node, string newName)
    {
        StructureChanged();
        dynamic n = node;
        var current = (string)n.Name;
        if (!string.Equals(current, newName, StringComparison.Ordinal)
            && string.Equals(current, newName, StringComparison.OrdinalIgnoreCase))
            n.Name = newName + "_v" + Guid.NewGuid().ToString("N", System.Globalization.CultureInfo.InvariantCulture).Substring(0, 8);
        n.Name = newName;
    }

    /// <summary>Relocate an item whole. TwinCAT's tree item has no <c>Move</c>/<c>Reparent</c> member — the full
    /// dispatch surface of <c>ITcSmTreeItem</c> was enumerated off the shipped type library to settle that, rather
    /// than inferred from a handful of name guesses — but <see cref="TcItemArchive"/> builds one out of the
    /// export/import pair, which carries children and graphical bodies. See DIALECT D4f. The archive is the item's SAVED
    /// document, so the round trip carries what the IDE holds (<see cref="LiveTexts"/>, DIALECT D45).</summary>
    public void Move(object node, object target)
    {
        var parent = Parent(node);
        var name = GetName(node);
        var live = LiveTexts(node);
        StructureChanged();
        // Typed BEFORE the call: the dynamic arguments bind the whole invocation at runtime, where a method group has no type.
        Func<object, IReadOnlyCollection<string>> childNames = ChildNames;
        Action discard = () => DiscardMemberDocuments(parent, name);
        TcItemArchive.Move((dynamic)parent, (dynamic)target, name, live, discard, PlcRoot(), childNames);
    }

    /// <summary>Every text slot of <paramref name="item"/> and its members as the IDE holds them NOW — what an archive
    /// round trip must carry, since the export is the SAVED document (DIALECT D45). Members are found through
    /// <see cref="ChildAt"/>, so a child Volt must not open (C2i) is not read (its archived text travels). An interface
    /// accessor's declaration is no automation slot (D21) and is not read.</summary>
    internal IReadOnlyList<TcItemArchive.LiveText> LiveTexts(object item)
    {
        var texts = new List<TcItemArchive.LiveText>
        {
            new(Array.Empty<string>(), ReadSlot(item, "DeclarationText"), ReadSlot(item, "ImplementationText")),
        };
        var itf = ItemType(item) == ItemKind.PlcItf;
        Walk(item, Array.Empty<string>());
        return texts;

        void Walk(object node, string[] path)
        {
            for (int i = 1, n = RawChildCount(node); i <= n; i++)
            {
                object child;
                try { child = ChildAt(node, i); }
                catch (UnreadableItemException) { continue; }
                var type = ItemType(child);
                if (type == ItemKind.PlcFolder) { Walk(child, path); continue; }   // a POU-internal folder is no path step
                var at = path.Append(GetName(child)).ToArray();
                if (!(itf && type is ItemKind.PlcItfPropGet or ItemKind.PlcItfPropSet))
                    texts.Add(new(at, ReadSlot(child, "DeclarationText"), ReadSlot(child, "ImplementationText")));
                Walk(child, at);
            }
        }
    }

    /// <summary>A text slot's value, or null when the object has no such slot (a binder miss, a COM "no such member").</summary>
    private static string? ReadSlot(object node, string member)
    {
        try
        {
            dynamic n = node;
            return member == "DeclarationText" ? (string?)n.DeclarationText : (string?)n.ImplementationText;
        }
        catch (Microsoft.CSharp.RuntimeBinder.RuntimeBinderException) { return null; }
        catch (System.Runtime.InteropServices.COMException ex) when (IsMissingMember(ex)) { return null; }
    }

    /// <summary>A node's child names, through <see cref="ChildAt"/> — so a child Volt must not open (DIALECT C2i) is
    /// answered by the name its refusal carries, never touched. For <see cref="TcItemArchive.Move"/>'s undo.</summary>
    private IReadOnlyCollection<string> ChildNames(object node)
    {
        var names = new List<string>();
        for (int i = 1, n = ChildCount(node); i <= n; i++)
        {
            try { names.Add(GetName(ChildAt(node, i))); }
            catch (UnreadableItemException untouchable) { names.Add(untouchable.Name); }
        }
        return names;
    }

    /// <summary>Place a POU MEMBER into a folder inside its own POU. Delegates to
    /// <see cref="TcItemArchive.MoveMember"/>, which rewrites the POU's own <c>.TcPOU</c> — a member is not a
    /// separate file, so it has no archive of its own to move.</summary>
    public void MoveMember(object pou, string memberName, string folderPath)
    {
        var live = LiveTexts(pou);
        StructureChanged();
        var parent = Parent(pou);
        var name = GetName(pou);
        Action discard = () => DiscardMemberDocuments(parent, name);
        TcItemArchive.MoveMember((dynamic)parent, name, live, discard, memberName, folderPath);
    }

    /// <summary>Give POU MEMBERS graphical bodies. Delegates to <see cref="TcItemArchive.SetMemberBodies"/>,
    /// which rewrites the POU's own <c>.TcPOU</c> and re-imports it — the only route that works, because
    /// assigning an NWL archive to a member's <c>ImplementationText</c> stores it as ST TEXT (D32).</summary>
    public void SetMemberBodies(object pou, System.Collections.Generic.IReadOnlyList<(string[] Path, string Nwl)> bodies)
    {
        var live = LiveTexts(pou);
        StructureChanged();
        var parent = Parent(pou);
        var name = GetName(pou);
        Action discard = () => DiscardMemberDocuments(parent, name);
        TcItemArchive.SetMemberBodies((dynamic)parent, name, live, discard, bodies);
    }

    /// <summary>The POU that ENCLOSES <paramref name="node"/>, or null when the node is not inside one — the test
    /// that separates a top-level item (which has its own file, and moves by archive) from a member (which does
    /// not). Walks up through the POU-internal folders a member may sit in.</summary>
    public object? EnclosingPouOf(object node)
    {
        dynamic current = node;
        for (var hops = 0; hops < 32; hops++)
        {
            object? parent;
            try { parent = (object?)current.Parent; } catch { return null; }
            if (parent is null) return null;
            var kind = ItemType(parent);
            if (ItemKind.HoldsMembers(kind))
                return parent;
            if (kind != ItemKind.PlcFolder) return null;   // left the POU without finding one
            current = parent;
        }
        return null;
    }

    /// <summary>The <c>^</c>-separated tail of <paramref name="node"/>'s path below <paramref name="ancestor"/>,
    /// as a backslash-joined folder path — TwinCAT's own spelling for a member's <c>FolderPath</c>. Empty when the
    /// node IS the ancestor.</summary>
    public string RelativePath(object ancestor, object node)
    {
        var above = PathOf(ancestor);
        var below = PathOf(node);
        if (string.Equals(above, below, StringComparison.Ordinal)) return "";
        if (!below.StartsWith(above + "^", StringComparison.Ordinal))
            throw new InvalidOperationException($"'{below}' is not inside '{above}'");
        return below.Substring(above.Length + 1).Replace('^', '\\');
    }

    // ── source text ─────────────────────────────────────────────────
    /// <summary>An item's declaration. NEVER defaulted (openspec bridge-one-to-one finding 8, task 3.5): a
    /// <c>DeclarationText</c> that answers nothing read as <c>""</c> wrote an emptied POU into the workspace, which the next
    /// push wrote back. It is refused by name.</summary>
    public string ReadDeclaration(object node) =>
        (string)((dynamic)node).DeclarationText
        ?? throw new BridgeException(BridgeErrorCodes.Unreadable,
            $"twincat: '{GetName(node)}' answers no DeclarationText — refused rather than read as an empty declaration.");
    /// <summary>An item's body text. Only a MISSING implementation slot yields <c>""</c> — an interface, DUT or
    /// GVL has no body and TwinCAT's COM object does not expose the member for it. Every OTHER failure is
    /// rethrown, because this read is FAIL-CLOSED: <c>BodyLanguage</c> is <c>LanguageOf(ReadImplementation(...))</c>,
    /// so a swallowed failure returned <c>""</c> for a body that does exist, which reports as TEXTUAL — and that
    /// is the exact value <c>PushService</c>'s body-format guard uses to refuse a textual push over a live
    /// CFC/SFC body. A body Volt could not read must never classify as textual; it must stop the push.</summary>
    public string ReadImplementation(object node)
    {
        // A member that EXISTS and answers nothing is no empty body (finding 8, task 3.5): refused by name.
        try
        {
            return (string)((dynamic)node).ImplementationText
                ?? throw new BridgeException(BridgeErrorCodes.Unreadable,
                    $"twincat: '{GetName(node)}' answers no ImplementationText — refused rather than read as an empty body.");
        }
        catch (Microsoft.CSharp.RuntimeBinder.RuntimeBinderException) { return ""; }
        catch (System.Runtime.InteropServices.COMException ex) when (IsMissingMember(ex)) { return ""; }
    }

    // The COM "this object has no such member" HRESULTs, as opposed to a member that exists and failed.
    private static bool IsMissingMember(System.Runtime.InteropServices.COMException ex) =>
        (uint)ex.HResult is 0x80020003    // DISP_E_MEMBERNOTFOUND
                         or 0x80020006    // DISP_E_UNKNOWNNAME
                         or 0x80004001;   // E_NOTIMPL

    public void WriteText(object node, string? declaration, string? implementation)
    {
        // No silent catch: a failed COM assignment must surface. A NULL declaration means the item has no
        // declaration slot at all (an action) — don't touch DeclarationText, which a TwinCAT action's COM
        // object doesn't even expose. NULL implementation means the same (no impl slot — interface). An
        // EMPTY-STRING implementation is a REAL body value ("") and MUST be written to CLEAR the existing
        // body — skipping it (the old `!IsNullOrEmpty` guard) left a stale body when a POU was emptied,
        // diverging from CODESYS's `WriteSourceText` (which writes on `implementation != null`).
        //
        // Every slot a text is sent at is asked of the OBJECT first (openspec bridge-refusal-review D26): a member the
        // COM object does not expose is refused by name before either slot is written, so no half of the write lands.
        // It was a kind table (`HasBodySlot`) in the driver — a kind it called bodiless had its body DROPPED and the push
        // said "updated" — and a raw binder throw (INTERNAL_ERROR) for an object of a body kind that lacked the member.
        dynamic n = node;
        if (declaration != null) RequireSlot(node, "DeclarationText", "declaration");
        if (implementation != null) RequireSlot(node, "ImplementationText", "body");
        if (declaration != null) n.DeclarationText = declaration;
        if (implementation != null) n.ImplementationText = implementation;
    }

    /// <summary>The object exposes <paramref name="member"/>, or the write is refused <c>UNSUPPORTED</c> naming the item and
    /// the slot. Asked by READING it — the one probe <see cref="ReadImplementation"/> already classifies: a binder miss
    /// (a .NET object) or a COM "no such member" HRESULT is a missing slot; any other failure is rethrown.</summary>
    private void RequireSlot(object node, string member, string what)
    {
        try
        {
            dynamic n = node;
            _ = member == "DeclarationText" ? (object?)n.DeclarationText : (object?)n.ImplementationText;
            return;
        }
        catch (Microsoft.CSharp.RuntimeBinder.RuntimeBinderException) { }
        catch (System.Runtime.InteropServices.COMException ex) when (IsMissingMember(ex)) { }
        throw new BridgeException(BridgeErrorCodes.Unsupported,
            $"TwinCAT: '{GetName(node)}' has no {member.Replace("Text", "")} — a {what} was pushed at a slot this object " +
            "does not have; refusing rather than dropping it.");
    }

    /// <summary>The item's own XML, as TwinCAT itself would save it.
    /// <para><paramref name="recursive"/> is load-bearing and easy to miss: <c>ProduceXml()</c> with no
    /// argument returns the item's METADATA only, with none of its children — so an interface came back
    /// without the <c>&lt;Property&gt;</c> elements that carry the accessors, and the accessor read had
    /// nothing to find. <c>ProduceXml(true)</c> is the whole object, children included.</para></summary>
    public string ProduceXml(object node, bool recursive = false) =>
        (string)((dynamic)node).ProduceXml(recursive) ?? "";

    /// <summary>The HRESULT TwinCAT returns for a tree path that does not exist — <c>Item 'x' not found</c>.
    /// Measured on live TcXaeShell 15.0 (2026-08-30) against two bogus paths, one under an existing root and one
    /// at the root: both answered <c>0x98510001</c>.</summary>
    private const int TcItemNotFound = unchecked((int)0x98510001);

    /// <summary>Resolve a tree item by its full path, or null when IT IS NOT THERE. Used where
    /// a held handle cannot be trusted (a task's system item, a reload).
    ///
    /// <para><b>Only a genuine not-found becomes null.</b> This caught EVERY <see cref="COMException"/>, so an
    /// RPC drop mid-push came back as "absent" — a wrong diagnosis for a channel fault. Worse, the HRESULT is the only thing
    /// <c>BeckhoffDriver.ShouldMarkDegraded</c> can classify, so the session never degraded and <c>Recover()</c>
    /// never ran while health stayed green. That is verbatim the fallback removed from <c>PlcRoot()</c> with a
    /// DO-NOT record 250 lines above; this was the same shape one call lower.</para></summary>
    private object? LookupPath(string path)
    {
        try { return (object)_sysManager!.LookupTreeItem(path); }
        catch (COMException ex) when (ex.HResult == TcItemNotFound) { return null; }
        catch (Microsoft.CSharp.RuntimeBinder.RuntimeBinderException) { return null; }
    }

    private static string PathOf(object node) => (string)((dynamic)node).PathName ?? "";

}
