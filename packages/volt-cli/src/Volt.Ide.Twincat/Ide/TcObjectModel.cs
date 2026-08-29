using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text.RegularExpressions;
using Volt.Engine;
using Volt.Contracts;
using Volt.Engine.Format.Body;
using Volt.Engine.Host;
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
    private string? _ideVersion;

    // The ONE XAE window this worker owns, by its stable process id. Selection and recovery re-acquire THIS pid
    // (stable across a DTE re-registration), never search other windows. Set once at startup by ConnectToPid.
    private int _xaePid;

    // The DESIRED selection — the project name the user last explicitly picked (the connector's `select`). Recovery
    // (ReattachProject, after a project close / re-registration / RPC drop) re-establishes THIS, by its stable
    // NAME, instead of resolving the first-available. Without it, any hiccup silently flipped a two-XAE setup to the
    // other project. Set only by an explicit project select; deliberately SURVIVES Disconnect.
    private string? _wantProject;

    // "Connected" = a project is BOUND: its DTE + TwinCAT project (system manager) are resolved. It deliberately
    // does NOT require the PLC node — that is CONTENT, resolved lazily on the first content op (see EnsurePlc), so a
    // select/health never has to walk into the PLC application. Plain field reads — safe off the STA thread. The
    // `is not null` pattern is load-bearing on a `dynamic` field: `!= null` would compile to a runtime-binder
    // BinaryOperation call site (a bound COM call), while a pattern match binds against the static type object.
    public bool IsConnected => _dte is not null && _sysManager is not null;
    public string? IdeVersion => _ideVersion;
    public string? ProjectName => _projectName;

    /// <summary>Whether the user has explicitly picked a project (the connector's `select`). When true, recovery
    /// re-establishes THAT project by its stable name; when false, nothing is bound (health shows no project).</summary>
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

    // ── tree primitives ─────────────────────────────────────────────
    /// <summary>The PLC project root (its NestedProject), the default parent for new POUs. Lazily resolves the PLC
    /// node on first use (EnsurePlc) — this is THE point where a content op reaches into the PLC application.</summary>
    public object PlcRoot()
    {
        EnsurePlc();

        // NO FALLBACK, and this one was worse than a swallow. The bare catch replaced a stale-handle RPC fault
        // with `LookupTreeItemDynamic(_plcProjectPath)` - and `_plcProjectPath` is not a path: Session.cs sets it
        // to `(string)plc.Name`, the child's bare NAME, while the value being replaced is that child's
        // NestedProject, one level below. So the substitute either failed to resolve, or resolved a DIFFERENT
        // node - and this is the origin of GetTreeRoot, GetPlcProjectRoot and WalkItems, so every folder path in
        // the project would shift by a segment.
        //
        // The real cost was to the recovery machinery: an RPC fault here is exactly what `ShouldMarkDegraded`
        // exists to classify, and swallowing it meant `RunRead` never called `Recover()`. The failure surfaced
        // as "cannot find tree item", whose HRESULT is outside the RPC family, so health stayed GREEN while
        // every op failed identically until someone restarted the worker. In an in-process host that wedges
        // inside the IDE instead.
        //
        // FindPlcProject's own comment already argued no such fallback belongs anywhere; this was the one place
        // that still had it, and `_plcProjectPath`'s only reader.
        return _plcNode!.NestedProject;
    }

    // Raw COM reads — these THROW on failure; the tree-walk callers catch and skip/continue (that
    // skip-on-failure is part of the walk algorithm, so it stays in the facet, not here).
    public int ChildCount(object node) => (int)((dynamic)node).ChildCount;
    public object ChildAt(object node, int index1Based) => (object)((dynamic)node).Child[index1Based];
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
        // DefaultViewMode metadata in the NWL archive, which TcPouReader preserves on read-back.
        var lang = language is "LD" ? "FBD" : (language ?? "ST");

        // A DUT is created as the STRUCT skeleton (606), never as 623. On TwinCAT 623 is not a generic DUT — it is
        // TREEITEMTYPE_PLCDUTALIAS, which is why `CreateChild` refuses a null vInfo there ("Base class not
        // specified!") and takes any string as the alias's BASE CLASS. Volt passed the body language, so every DUT
        // was created as an alias to a type named "ST": a malformed object whose `<baseType/>` is empty, whose own
        // export TwinCAT then refuses to re-import ("incomplete content" against TC6). The per-child write only
        // survived it because `WriteText` landed the real declaration afterwards.
        //
        // Seeding the struct and letting the pushed DECLARATION re-derive the subtype is exactly what CODESYS does
        // (`create_dut` with `DutType.Structure`), and it is measured to work here for all four shapes: struct
        // stays 606, an enum declaration becomes 605, a union 607, and an alias — `: INT;` or `: STRING(80);` —
        // becomes 623 with the right base. One seed, no per-subtype dispatch. DIALECT C2b.
        if (kindCode == ItemKind.PlcDut) kindCode = ItemKind.PlcDutStruct;

        object? vInfo = kindCode switch
        {
            ItemKind.PlcPouFunc => System.Type.Missing,
            ItemKind.PlcDutStruct or ItemKind.PlcDutEnum or ItemKind.PlcDutUnion => System.Type.Missing,
            ItemKind.PlcItf => null,
            // Interface method/property: TC wants the return/data type as a STRING vInfo (carried in the
            // `language` arg by PushService, null when untyped) — NOT a body language. Matches the working
            // Beckhoff sample (BuildChildVInfo): method→returnType, property→dataType, else null.
            ItemKind.PlcItfMeth or ItemKind.PlcItfProp => (object?)language,
            // Interface property accessors: "ST" body language (per the Beckhoff CreateChild sample).
            ItemKind.PlcItfPropGet or ItemKind.PlcItfPropSet => "ST",
            _ => lang,
        };
        return (object)((dynamic)parent).CreateChild(name, kindCode, "", vInfo);
    }
    public void DeleteChild(object parent, string name) => ((dynamic)parent).DeleteChild(name);
    public void Rename(object node, string newName) => ((dynamic)node).Name = newName;

    /// <summary>Relocate a child whole. TwinCAT's tree item has no <c>Move</c>/<c>Reparent</c> member — the full
    /// dispatch surface of <c>ITcSmTreeItem</c> was enumerated off the shipped type library to settle that, rather
    /// than inferred from a handful of name guesses — but <see cref="TcItemArchive"/> builds one out of the
    /// export/import pair, which carries children and graphical bodies. See DIALECT D4f.</summary>
    public void Move(object parent, object target, string name) =>
        TcItemArchive.Move((dynamic)parent, (dynamic)target, name);

    /// <summary>Place a POU MEMBER into a folder inside its own POU. Delegates to
    /// <see cref="TcItemArchive.MoveMember"/>, which rewrites the POU's own <c>.TcPOU</c> — a member is not a
    /// separate file, so it has no archive of its own to move.</summary>
    public void MoveMember(object pouParent, string pouName, string memberName, string folderPath) =>
        TcItemArchive.MoveMember((dynamic)pouParent, pouName, memberName, folderPath);

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
            if (kind is ItemKind.PlcPouProg or ItemKind.PlcPouFunc or ItemKind.PlcPouFb or ItemKind.PlcItf)
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
    public string ReadDeclaration(object node) => (string)((dynamic)node).DeclarationText ?? "";
    /// <summary>An item's body text. Only a MISSING implementation slot yields <c>""</c> — an interface, DUT or
    /// GVL has no body and TwinCAT's COM object does not expose the member for it. Every OTHER failure is
    /// rethrown, because this read is FAIL-CLOSED: <c>BodyLanguage</c> is <c>LanguageOf(ReadImplementation(...))</c>,
    /// so a swallowed failure returned <c>""</c> for a body that does exist, which reports as TEXTUAL — and that
    /// is the exact value <c>PushService</c>'s body-format guard uses to refuse a textual push over a live
    /// CFC/SFC body. A body Volt could not read must never classify as textual; it must stop the push.</summary>
    public string ReadImplementation(object node)
    {
        try { return (string)((dynamic)node).ImplementationText ?? ""; }
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
        dynamic n = node;
        if (declaration != null) n.DeclarationText = declaration;
        if (implementation != null) n.ImplementationText = implementation;
    }

    /// <summary>The item's own XML, as TwinCAT itself would save it.
    /// <para><paramref name="recursive"/> is load-bearing and easy to miss: <c>ProduceXml()</c> with no
    /// argument returns the item's METADATA only, with none of its children — so an interface came back
    /// without the <c>&lt;Property&gt;</c> elements that carry the accessors, and the accessor read had
    /// nothing to find. <c>ProduceXml(true)</c> is the whole object, children included.</para></summary>
    public string ProduceXml(object node, bool recursive = false) =>
        (string)((dynamic)node).ProduceXml(recursive) ?? "";

    // ── PLCopen XML transport ───────────────────────────────────────
    // The PLCopen TRANSPORT is deleted and stays deleted: content does not travel as a document, and every
    // pull and every edit of an existing body goes through the archive. What survives here is narrower and is
    // the only thing PLCopen is still good for — CREATING a graphical body TwinCAT does not yet have.
    //
    // Nothing else can do it. `TcNetworkWriter` refuses to build archive elements because a `BoxTreeBox`
    // carries `InputParam`, `OutputParam`, `CallType`, `EN`, `ENO` and `Id` — results of the IDE RESOLVING the
    // call — and guessing them once wrote twenty unopenable `.TcPOU` files. DIALECT N10 then ruled out reaching
    // the live NWL objects at all (TwinCAT ships the scripting contract without its implementation), and N11
    // ruled out deriving the archive from the shipped assemblies (`BoxTreeBox` has no concrete class to
    // reflect over). An IMPORT inverts the problem: Volt states the topology and the IDE resolves the rest.

    /// <summary>Import a PLCopen document, REPLACING <paramref name="pou"/>, and return a LIVE handle to the
    /// result — the passed one is dead by then.
    ///
    /// <para><b>Two vendor facts drive everything here.</b> First, DIALECT D4d: a TwinCAT PLCopen import
    /// INVALIDATES every handle into the item it replaced, so the caller is handed a re-resolved node rather
    /// than being trusted to remember. Second, the import ALWAYS deposits at the PLC-project root — measured
    /// across the whole options × bFolderStructure × flat/nested matrix, where all eight REPLACE cells relocated
    /// a foldered POU — so a POU that lived in a folder is put back, or a create would silently move the
    /// engineer's object.</para></summary>
    public object ImportPlcOpen(object pou, System.Xml.Linq.XDocument document)
    {
        dynamic node = pou;
        string name = (string)node.Name;
        string parentPath = PathOf((object)node.Parent);
        string rootPath = PathOf(PlcRoot());

        var file = System.IO.Path.Combine(System.IO.Path.GetTempPath(),
                                          "volt-plcopen-" + Guid.NewGuid().ToString("N") + ".xml");
        try
        {
            document.Save(file);

            // DELETE THE SHELL FIRST, rather than asking the import to replace it.
            //
            // Measured: importing over an existing POU with options=2 - the value Beckhoff document as REPLACE -
            // did not replace it. It left the original untouched and deposited the real body beside it as
            // `VltE2E_fanout_1`, i.e. it RENAMED. Whatever that option means on this install, it is not what its
            // name promises, and a push that silently produces a second POU is worse than one that fails.
            //
            // Deleting first makes the outcome independent of the option's semantics: there is no collision, so
            // there is nothing to resolve. It is safe because this path only runs for a body with NO ITEMS - a
            // shell nobody has drawn in - and the verification below turns a silent no-op into an error rather
            // than leaving the engineer without the POU.
            var parent = LookupPath(parentPath)
                ?? throw new InvalidOperationException(
                       $"TwinCAT: the parent of '{name}' vanished before its body could be imported.");
            DeleteChild(parent, name);

            ((dynamic)PlcRoot()).PlcOpenImport(file, 0);
        }
        finally
        {
            try { System.IO.File.Delete(file); } catch { /* a temp file we could not remove is not a push failure */ }
        }

        // Put it back if the import moved it. Comparing PATHS rather than handles is deliberate: the handles
        // this method was given are exactly the ones the import just killed.
        if (!string.Equals(parentPath, rootPath, StringComparison.OrdinalIgnoreCase))
        {
            var landed = LookupPath(rootPath + "^" + name);
            var parent = LookupPath(parentPath);
            if (landed != null && parent != null) TcItemArchive.Move(PlcRoot(), parent, name);
        }

        var landedItem = LookupPath(parentPath + "^" + name)
               ?? LookupPath(rootPath + "^" + name)
               ?? throw new InvalidOperationException(
                      $"TwinCAT: '{name}' is gone after its PLCopen import - the shell was deleted and the " +
                      "import did not put it back. Check the IDE before pushing again.");

        // VERIFY, because the failure mode here is silence. An importer that does not understand the document
        // does not throw; it produces an empty POU, which would then read back as "no body" and look like the
        // engineer had drawn nothing. Having just deleted the shell, that is the one outcome worth catching.
        if (TcArchive.HasNoItems(TcArchive.Root(ReadImplementation(landedItem))))
            throw new InvalidOperationException(
                $"TwinCAT: the PLCopen import of '{name}' produced an empty body. The document was accepted but " +
                "nothing was built from it, so the push is being failed rather than reported as applied.");

        return landedItem;
    }

    /// <summary>Resolve a tree item by its full path, or null when it is not there. Used after an import, where
    /// every previously held handle is invalid.</summary>
    private object? LookupPath(string path)
    {
        try { return (object)_sysManager!.LookupTreeItem(path); }
        catch (COMException) { return null; }
        catch (Microsoft.CSharp.RuntimeBinder.RuntimeBinderException) { return null; }
    }

    private static string PathOf(object node) => (string)((dynamic)node).PathName ?? "";

    /// <summary>Walk up to the enclosing POU (FB / function / program / interface). Only called for items
    /// the language gate already classified as graphical POUs, so the POU is found at/near hop 0.</summary>
    private dynamic? EnclosingPou(dynamic item)
    {
        dynamic node = item;
        for (var hops = 0; hops < 32; hops++)
        {
            int t = ItemType((object)node);   // shared read: an unreadable node yields ItemKind.Unknown, never 0 (SystemRoot)
            if (t is ItemKind.PlcPouProg or ItemKind.PlcPouFunc or ItemKind.PlcPouFb or ItemKind.PlcItf) return node;
            node = node.Parent;
            if (node == null) return null;
        }
        return null;
    }

    /// <summary>PLC-project-relative selection path for PlcOpenExport ('.'-separated, folder-qualified).
    /// MEASURED (DIALECT C2a/D9): the dotted project-relative path is the grammar. `POUs.PLC_PRG` and
    /// `VltProbeF.VltProbeDutF` both export; the BARE name of a foldered item does not — `PlcOpenExport('PLC_PRG')`
    /// answers "Selection 'PLC_PRG' not found!". A root-level item's bare name works because its dotted path IS
    /// its name. Reading that refusal as a vendor limit is what produced the retracted C2.</summary>
    private string PouSelectionPath(dynamic pou)
    {
        try
        {
            string pouPath = (string)pou.PathName;
            string plcPath = (string)((dynamic)PlcRoot()).PathName;
            if (pouPath.StartsWith(plcPath + "^", StringComparison.Ordinal))
                return pouPath.Substring(plcPath.Length + 1).Replace('^', '.');
            return pouPath.Replace('^', '.');
        }
        catch { try { return (string)pou.Name; } catch { return ""; } }
    }

}
