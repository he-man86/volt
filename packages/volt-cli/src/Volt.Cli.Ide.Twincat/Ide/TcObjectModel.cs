using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text.RegularExpressions;
using Volt.Engine;
using Volt.Contracts;
using Volt.Engine.Format.Body;
using Volt.Engine.Host;
using Volt.Engine.Item;

namespace Volt.Cli.Ide.Twincat;

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
    private string? _plcProjectPath;
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
        try { return _plcNode!.NestedProject; } catch { /* fall through to lookup */ }
        return LookupTreeItemDynamic(_plcProjectPath!);
    }

    // Raw COM reads — these THROW on failure; the tree-walk callers catch and skip/continue (that
    // skip-on-failure is part of the walk algorithm, so it stays in the facet, not here).
    public int ChildCount(object node) => (int)((dynamic)node).ChildCount;
    public object ChildAt(object node, int index1Based) => (object)((dynamic)node).Child[index1Based];
    public object Parent(object node) => (object)((dynamic)node).Parent;
    public string GetName(object node) => (string)((dynamic)node).Name ?? "";

    // TwinCAT's native ItemType IS the vendor-neutral code. A read failure returns ItemKind.Unknown (not 0
    // — that's the real SystemRoot code), so an unreadable node is skipped, never phantom-emitted.
    public int ItemType(object node) { try { return (int)((dynamic)node).ItemType; } catch { return ItemKind.Unknown; } }

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

    /// <summary>The item's raw item-metadata XML (ProduceXml), or "" if it produces none.</summary>
    public string ProduceXml(object node) => (string)((dynamic)node).ProduceXml() ?? "";

    // ── PLCopen XML transport ───────────────────────────────────────
    // ExportPouXml / ImportPlcOpenXml lived here and are DELETED with the PLCopen transport. The import
    // half carried a `Move` back into the item's own folder, because TwinCAT's PlcOpenImport always deposits
    // at the PLC-project ROOT — measured across the whole options x bFolderStructure x flat/nested matrix,
    // where all eight REPLACE cells relocated a foldered POU. Nothing imports now, so nothing relocates and
    // there is nothing to undo.

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
