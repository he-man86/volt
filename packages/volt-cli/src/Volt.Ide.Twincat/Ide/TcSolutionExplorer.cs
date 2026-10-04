using System;
using System.Collections.Generic;
using System.Linq;
using System.Runtime.InteropServices;
using Volt.Contracts;
using Volt.Engine;
using Volt.Engine.Ide;
using Volt.Engine.Item;

namespace Volt.Ide.Twincat;

/// <summary>One node of XAE's Solution Explorer, as the VS hierarchy reports it: the node's NAME
/// (<c>VSHPROPID_Name</c> — measured equal to the PLC tree item's name for every node of a PLC project: folders,
/// POUs, DUTs, GVLs, the task, <c>External Types</c>, <c>References</c>, the <c>.tmc</c>), its canonical name (the
/// file path for a source file, <c>X.TcPOU;X.M</c> for a member) and its CAPTION, the label the tree draws.
/// <para><paramref name="Canonical"/> is null when its read FAILED; <paramref name="Unread"/> names any other read of the
/// node — its name, its caption, its child list — that failed, or is null. The reader records a failure rather than
/// throwing, because nodes Volt never classifies refuse reads Volt does not need (measured on Project14:
/// <c>GetCanonicalName</c> answers <c>E_NOTIMPL</c> for the PLC project node itself); for a node the snapshot does
/// classify, it refuses the node by name (<see cref="ExplorerSnapshot.From"/>).</para></summary>
internal sealed record ExplorerNode(string Name, string? Canonical, string Caption, IReadOnlyList<ExplorerNode> Children,
                                    string? Unread = null);

/// <summary>
/// Which children of the PLC tree Volt must never touch, read WITHOUT touching any of them (DIALECT C2i).
///
/// <para>After a solution load, the first <c>Child(i)</c> or <c>LookupChild</c> on the tree item of a POU whose text the
/// IDE does not read as a POU kills TcXaeShell (access violation in <c>TwinCAT System Manager.dll</c>); a <c>try</c> in
/// Volt receives <c>0x800706BE</c> after XAE has died, so there is nothing to guard on this side. The Solution Explorer
/// hierarchy lists those items without harm, and its caption says whether the IDE parsed one: a <c>.TcPOU</c> node is
/// captioned <c>name (PRG|FB|FUN)</c> while it does, and its bare name otherwise (5 of 5 such POUs, 0 of 21 other
/// items; the caption follows a text write at once). Only the suffix's PRESENCE is read, never its spelling.</para>
///
/// <para>This is the only place the caption is read. Untested here and recorded as such: an XAE option or UI
/// language that shows no suffix on ANY POU would flag every POU — every op would then refuse loudly by name, and
/// nothing would crash.</para>
/// </summary>
internal sealed class ExplorerSnapshot
{
    private readonly Dictionary<string, Guarded> _guarded;
    private readonly Dictionary<string, int> _listed;
    private readonly HashSet<string> _pous;

    /// <summary>A folder holding at least one POU Volt must not touch: every child name in hierarchy order, and the
    /// names that are not to be opened.</summary>
    public sealed record Guarded(IReadOnlyList<string> Names, IReadOnlySet<string> Untouchable);

    private ExplorerSnapshot(Dictionary<string, Guarded> guarded, Dictionary<string, int> listed, HashSet<string> pous)
    { _guarded = guarded; _listed = listed; _pous = pous; }

    /// <summary>True when the project has no POU Volt must not touch — every real project measured — and the tree is
    /// read exactly as before, with no extra call.</summary>
    public bool Clean => _guarded.Count == 0;

    /// <summary>The guarded folder at <paramref name="relPath"/> (tree names below the PLC project, joined with
    /// <c>^</c>; <c>""</c> is the project itself), or null when that folder holds nothing to avoid.</summary>
    public Guarded? At(string relPath) => _guarded.TryGetValue(relPath, out var g) ? g : null;

    /// <summary>How many children the hierarchy lists for the node at <paramref name="relPath"/>; null when it lists no
    /// such node. Every node outside a POU is counted, so a folder the PLC tree has and the hierarchy does not — or holds
    /// more children than it lists — is visible as exactly that, and is never taken for a folder with nothing to avoid
    /// (the snapshot can only flag what it lists).</summary>
    public int? ListedChildren(string relPath) => _listed.TryGetValue(relPath, out var n) ? n : null;

    /// <summary>Is the node at <paramref name="relPath"/> inside (or itself) a POU? A POU's subtree holds its members,
    /// never a top-level POU, so nothing beneath one needs the hierarchy's word. A node the hierarchy LISTS outside a
    /// POU is not inside one, whatever its path: a folder beside a POU of its name has the POU's path, and was waved
    /// through the count check by it (5Qa review).</summary>
    public bool InsidePou(string relPath)
    {
        if (_listed.ContainsKey(relPath)) return false;
        for (var path = relPath; path.Length > 0; path = path.Substring(0, Math.Max(0, path.LastIndexOf('^'))))
            if (_pous.Contains(path)) return true;
        return false;
    }

    /// <summary>Every flagged POU, as its path below the PLC project (<c>folder^name</c>).</summary>
    public IEnumerable<string> UntouchablePaths =>
        _guarded.SelectMany(g => g.Value.Untouchable.Select(n => g.Key.Length == 0 ? n : g.Key + "^" + n));

    /// <summary>The snapshot of the PLC project whose hierarchy node is <paramref name="plcProject"/>.</summary>
    /// <param name="stillUntouchable">POU paths flagged earlier in this session and not since replaced by Volt: they stay
    /// flagged whatever their caption says now (<c>TcObjectModel.Explorer</c> says why).</param>
    /// <param name="inThisLoad">Asked only of a bare-captioned POU (by its path below the PLC project): is it a tree item
    /// of THIS load, which XAE survives a touch of? Answered by the system manager's path lookup
    /// (<c>TcObjectModel.Explorer</c>); without it every bare-captioned POU is untouchable.</param>
    public static ExplorerSnapshot From(ExplorerNode plcProject, IReadOnlyCollection<string>? stillUntouchable = null,
                                        Func<string, bool>? inThisLoad = null)
    {
        var guarded = new Dictionary<string, Guarded>(StringComparer.Ordinal);
        var listed = new Dictionary<string, int>(StringComparer.Ordinal);
        var pous = new HashSet<string>(StringComparer.Ordinal);
        Collect(plcProject, "", guarded, listed, pous,
                new HashSet<string>(stillUntouchable ?? Array.Empty<string>(), StringComparer.OrdinalIgnoreCase),
                inThisLoad ?? (_ => false));
        return new ExplorerSnapshot(guarded, listed, pous);
    }

    private static void Collect(ExplorerNode node, string path, Dictionary<string, Guarded> guarded,
                                Dictionary<string, int> listed, HashSet<string> pous, HashSet<string> still,
                                Func<string, bool> inThisLoad)
    {
        // A NODE THAT WAS NOT FULLY READ CANNOT BE VOUCHED FOR: a caption read as "" would pass a broken POU for a
        // parsed one, and a child list cut short would hide one. Refused, named — never read as "nothing to avoid".
        if (node.Unread is { } unread)
            throw new BridgeException(ConflictCodes.ItemUnverified,
                $"the Solution Explorer did not read '{(path.Length == 0 ? node.Name : path)}' in full ({unread}); Volt does " +
                "not walk the TwinCAT tree on a hierarchy that cannot vouch for every POU (DIALECT C2i)");
        listed[path] = node.Children.Count;
        var untouchable = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var child in node.Children)
        {
            var childPath = path.Length == 0 ? child.Name : path + "^" + child.Name;
            if (child.Unread is not null) Collect(child, childPath, guarded, listed, pous, still, inThisLoad);   // refuses it, named
            // Whether it is a POU at all is read from its canonical name: unread, it cannot be classified.
            if (child.Canonical is null)
                throw new BridgeException(ConflictCodes.ItemUnverified,
                    $"the Solution Explorer did not read the canonical name of '{childPath}'; Volt cannot tell whether it is " +
                    "a POU that crashes TcXaeShell, so it does not walk the TwinCAT tree (DIALECT C2i)");
            if ((IsPou(child) && still.Contains(childPath)) || (IsUnparsedPou(child) && !inThisLoad(childPath)))
            { untouchable.Add(child.Name); pous.Add(childPath); continue; }
            // A POU's own children are its members, which the tree reaches only through the POU itself.
            if (IsPou(child)) pous.Add(childPath);
            // A DUT and a folder may share a name (DIALECT D34), so two nodes have one path. A childless one (the DUT,
            // a GVL) states nothing a folder's count needs and must not overwrite it: it hid the folder's POUs (5Qa e2e).
            else if (child.Children.Count > 0 || !listed.ContainsKey(childPath)) Collect(child, childPath, guarded, listed, pous, still, inThisLoad);
        }
        if (untouchable.Count > 0)
            guarded[path] = new Guarded(node.Children.Select(c => c.Name).ToList(), untouchable);
    }

    private static bool IsPou(ExplorerNode n) =>
        n.Canonical!.EndsWith(".TcPOU", StringComparison.OrdinalIgnoreCase);

    /// <summary>A <c>.TcPOU</c> node captioned with its bare name: the IDE does not read its text as a POU.</summary>
    private static bool IsUnparsedPou(ExplorerNode n) =>
        IsPou(n) && string.Equals(n.Caption, n.Name, StringComparison.Ordinal);

    /// <summary>What a walk and a refusal say about such a POU — the FACT, and no client instruction: the same words
    /// reach a refusal raised inside a push's apply loop, which can now arrive on an accepted push, and the CLI adds its
    /// own advice from the code (openspec <c>push-keeps-what-landed</c> 2.5; "Push the fixed text with --force" was
    /// here).</summary>
    public static string Reason(string name) =>
        $"TwinCAT does not read '{name}' as a POU; touching its tree item crashes TcXaeShell after a load " +
        "(DIALECT C2i), so Volt does not read it.";

    /// <summary>The wire kind a <c>.TcPOU</c> is, known without opening it: a POU is ONE kind, <c>X.pou</c> (openspec
    /// <c>push-without-header-check</c> 5.Q), so an untouchable POU is named under exactly one name and the CLI matches
    /// it to its file. (It was three candidates — program, function block, function — while the extension said which.)</summary>
    public static readonly IReadOnlyList<string> PouKinds = new[] { ItemKind.Kinds.Pou };
}

/// <summary>
/// Reads the Solution Explorer hierarchy of a TwinCAT XAE, out of process, through the DTE's OLE
/// <c>IServiceProvider</c> → <c>IVsSolution</c> → <c>IVsHierarchy</c> (ported from
/// <c>probe-tc-kind-source.ps1</c> (deleted; <c>git show b2496efb4b:packages/volt-cli/scripts/probe-tc-kind-source.ps1</c>)). The interfaces are declared here with <c>[ComImport]</c>, only up to the
/// last vtable slot used, so no TcXaeShell assembly is loaded into the worker. Cost measured on a 143-node solution:
/// 73–142 ms per read (≈700 ms on the first read in a fresh process).
/// </summary>
internal static class TcSolutionExplorer
{
    private const uint VsItemIdRoot = 0xFFFFFFFE;
    private const uint VsItemIdNil = 0xFFFFFFFF;
    private const int VshPropIdCaption = -2003;
    private const int VshPropIdName = -2012;
    private const int VshPropIdFirstVisibleChild = -2041;
    private const int VshPropIdNextVisibleSibling = -2042;
    private const uint EpfAllProjects = 27;   // __VSENUMPROJFLAGS.EPF_ALLPROJECTS
    private const int MaxDepth = 16;

    private static readonly Guid SidVsSolution = new("7f7cd0db-91ef-49dc-9fa9-02d128515dd4");

    /// <summary>The hierarchy node of the PLC project named <paramref name="plcProjectName"/> (the PLC tree's nested
    /// project, e.g. <c>Untitled2 Project</c>), with every node beneath it; null when the hierarchy has no such node.
    /// Throws when the hierarchy itself cannot be read.</summary>
    public static ExplorerNode? ReadPlcProject(object dte, string plcProjectName)
    {
        var sp = (IOleServiceProvider)dte;
        var sid = SidVsSolution;
        var iid = typeof(IVsSolution).GUID;
        Check(sp.QueryService(ref sid, ref iid, out var p), "QueryService(SVsSolution)");
        IVsSolution solution;
        try { solution = (IVsSolution)Marshal.GetObjectForIUnknown(p); }
        finally { Marshal.Release(p); }

        var any = Guid.Empty;
        Check(solution.GetProjectEnum(EpfAllProjects, ref any, out var projects), "IVsSolution.GetProjectEnum");
        var one = new IVsHierarchy[1];
        while (projects.Next(1, one, out var got) == 0 && got == 1)
        {
            var unread = new List<string>();
            var name = Prop(one[0], VsItemIdRoot, VshPropIdName, unread);
            var caption = Prop(one[0], VsItemIdRoot, VshPropIdCaption, unread);
            var root = new ExplorerNode(name, "", caption, Children(one[0], VsItemIdRoot, 0, unread), Unread(unread));
            if (Find(root, plcProjectName) is { } hit) return hit;
        }
        return null;
    }

    private static ExplorerNode? Find(ExplorerNode node, string name)
    {
        if (string.Equals(node.Name, name, StringComparison.Ordinal) && node.Children.Count > 0) return node;
        foreach (var c in node.Children)
            if (Find(c, name) is { } hit) return hit;
        return null;
    }

    /// <summary>The children of node <paramref name="id"/>, each with every read it needed. NO READ ENDS THE LIST
    /// QUIETLY OR STANDS IN A VALUE FOR ITSELF: a failure is recorded — on the child whose property it was, or in
    /// <paramref name="unread"/> (the parent's) when the child list itself could not be read on — and the snapshot
    /// refuses any such node inside the PLC project.</summary>
    internal static List<ExplorerNode> Children(IVsHierarchy h, uint id, int depth, List<string> unread)
    {
        var list = new List<ExplorerNode>();
        if (depth > MaxDepth) { unread.Add($"deeper than {MaxDepth} levels"); return list; }
        if (Failed(h.GetProperty(id, VshPropIdFirstVisibleChild, out var first), "VSHPROPID_FirstVisibleChild", unread)) return list;
        if (first is null) { unread.Add("VSHPROPID_FirstVisibleChild answered no item id"); return list; }
        var c = ItemId(first);
        while (c != VsItemIdNil)
        {
            var mine = new List<string>();
            var canonical = h.GetCanonicalName(c, out var cn) == 0 ? cn ?? "" : null;
            List<ExplorerNode> below;
            var ih = typeof(IVsHierarchy).GUID;
            if (h.GetNestedHierarchy(c, ref ih, out var nested, out var nestedId) == 0 && nested != IntPtr.Zero)
            {
                IVsHierarchy nh;
                try { nh = (IVsHierarchy)Marshal.GetObjectForIUnknown(nested); }
                finally { Marshal.Release(nested); }
                below = Children(nh, nestedId, depth + 1, mine);
            }
            else below = Children(h, c, depth + 1, mine);
            var name = Prop(h, c, VshPropIdName, mine);
            var caption = Prop(h, c, VshPropIdCaption, mine);
            list.Add(new ExplorerNode(name, canonical, caption, below, Unread(mine)));
            if (Failed(h.GetProperty(c, VshPropIdNextVisibleSibling, out var next), "VSHPROPID_NextVisibleSibling", unread)) return list;
            if (next is null) { unread.Add("VSHPROPID_NextVisibleSibling answered no item id"); return list; }
            c = ItemId(next);
        }
        return list;
    }

    /// <summary>A string property of a node; a failed read is recorded in <paramref name="unread"/>, and the
    /// <c>""</c> returned then is never trusted (the node is refused).</summary>
    private static string Prop(IVsHierarchy h, uint id, int prop, List<string> unread)
    {
        if (Failed(h.GetProperty(id, prop, out var v), $"GetProperty({prop})", unread)) return "";
        if (v is null) { unread.Add($"GetProperty({prop}) answered no value"); return ""; }
        return v.ToString() ?? "";
    }

    private static bool Failed(int hr, string what, List<string> unread)
    {
        if (hr == 0) return false;
        unread.Add($"{what} failed (0x{hr:X8})");
        return true;
    }

    private static string? Unread(List<string> unread) => unread.Count == 0 ? null : string.Join("; ", unread);

    private static uint ItemId(object v) => v is int i ? unchecked((uint)i) : Convert.ToUInt32(v);

    private static void Check(int hr, string what)
    {
        if (hr != 0) throw new COMException($"{what} failed (0x{hr:X8})", hr);
    }

    [ComImport, Guid("6d5140c1-7436-11ce-8034-00aa006009fa"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IOleServiceProvider
    {
        [PreserveSig] int QueryService(ref Guid guidService, ref Guid riid, out IntPtr ppvObject);
    }

    [ComImport, Guid("7f7cd0db-91ef-49dc-9fa9-02d128515dd4"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IVsSolution
    {
        [PreserveSig] int GetProjectEnum(uint grfEnumFlags, ref Guid rguidEnumOnlyThisType, out IEnumHierarchies ppenum);
    }

    [ComImport, Guid("bec77711-2df9-44d7-b478-a453c2e8a134"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IEnumHierarchies
    {
        [PreserveSig] int Next(uint celt, [Out, MarshalAs(UnmanagedType.LPArray, SizeParamIndex = 0)] IVsHierarchy[] rgelt,
                               out uint pceltFetched);
    }

    // Declared up to GetCanonicalName, the last slot used; the slots before it must stay in vtable order.
    [ComImport, Guid("59b2d1d0-5db0-4f9f-9609-13f0168516d6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IVsHierarchy
    {
        [PreserveSig] int SetSite(IntPtr psp);
        [PreserveSig] int GetSite(out IntPtr ppsp);
        [PreserveSig] int QueryClose(out int pfCanClose);
        [PreserveSig] int Close();
        [PreserveSig] int GetGuidProperty(uint itemid, int propid, out Guid pguid);
        [PreserveSig] int SetGuidProperty(uint itemid, int propid, ref Guid rguid);
        [PreserveSig] int GetProperty(uint itemid, int propid, [MarshalAs(UnmanagedType.Struct)] out object? pvar);
        [PreserveSig] int SetProperty(uint itemid, int propid, [MarshalAs(UnmanagedType.Struct)] object var);
        [PreserveSig] int GetNestedHierarchy(uint itemid, ref Guid iidHierarchyNested, out IntPtr ppHierarchyNested,
                                             out uint pitemidNested);
        [PreserveSig] int GetCanonicalName(uint itemid, [MarshalAs(UnmanagedType.BStr)] out string? pbstrName);
    }
}
