using System.Globalization;
using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using Volt.Contracts;
using Volt.Engine;

namespace Volt.Ide.Twincat;

/// <summary>One node of XAE's Solution Explorer, as the VS hierarchy reports it: the node's NAME
/// (<c>VSHPROPID_Name</c> — measured equal to the PLC tree item's name for every node of a PLC project: folders,
/// POUs, DUTs, GVLs, the task, <c>External Types</c>, <c>References</c>, the <c>.tmc</c>), its canonical name (the
/// file path for a source file, <c>X.TcPOU;X.M</c> for a member) and its CAPTION, the label the tree draws.
/// <para><paramref name="Canonical"/> is null when its read FAILED; <paramref name="Unread"/> names any other read of the
/// node — its name, its caption, its child list — that failed, or is null. The reader records a failure rather than
/// throwing, because nodes Volt never classifies refuse reads Volt does not need (measured on Project14:
/// <c>GetCanonicalName</c> answers <c>E_NOTIMPL</c> for the PLC project node itself); for a node the snapshot does
/// classify, it refuses the node by name (<c>ExplorerSnapshot.From</c>).</para></summary>
internal sealed record ExplorerNode(string Name, string? Canonical, string Caption, IReadOnlyList<ExplorerNode> Children,
                                    string? Unread = null);

/// <summary>
/// Reads the Solution Explorer hierarchy of a TwinCAT XAE, out of process, through the DTE's OLE
/// <c>IServiceProvider</c> → <c>IVsSolution</c> → <c>IVsHierarchy</c> (ported from
/// <c>git show b2496efb4b:packages/volt-cli/scripts/probe-tc-kind-source.ps1</c>). The interfaces are declared here with <c>[ComImport]</c>, only up to the
/// last vtable slot used, so no TcXaeShell assembly is loaded into the worker. Cost measured on a 143-node solution:
/// 73–142 ms per read (≈700 ms on the first read in a fresh process).
///
/// <para><b>Unlike every other call Volt makes into XAE, these are not IDispatch:</b> IVsSolution, IEnumHierarchies and
/// IVsHierarchy cross the process boundary through the proxy/stub in <c>msenvp.dll</c> (PSFactoryBuffer
/// <c>{E6D78900-BB40-4039-9C54-593A242B65DA}</c>), and that proxy must be of the READER's bitness (DIALECT C2t,
/// "what the read requires"). TcXaeShell 15 is 32-bit and ships its own x86 copy, registration-free, beside it:
/// <c>Common7\IDE\Automation\msenvp.dll</c> + <c>msenvp.dll.manifest</c> (a 64-bit VS 2022-based shell carries an
/// amd64 one at the same place, measured on VS 2022 itself). The read ALWAYS activates the IDE's own manifest
/// (<see cref="ReadSystem"/>) and refuses without it (<see cref="ProxyManifestMissingException"/>): whatever COM has
/// registered is never what the read rests on — the only 64-bit copy anyone registers is Visual Studio's, which is
/// why a 64-bit reader worked on a machine with VS 2022 and nowhere else.</para>
/// </summary>
internal static class TcSolutionExplorer
{
    /// <summary>The IDE ships no proxy manifest where its shell keeps it: no reader can rest on its own proxy.</summary>
    public sealed class ProxyManifestMissingException : Exception
    {
        public ProxyManifestMissingException(string manifest)
            : base($"the IDE ships no proxy manifest for its hierarchy interfaces where its shell keeps one ({manifest})") { }
    }

    private const int RegdbEClassNotReg = unchecked((int)0x80040154);
    private const int RegdbEIidNotReg = unchecked((int)0x80040155);

    /// <summary>XAE's own registration-free proxy manifest, beside the IDE exe in <paramref name="ideDir"/>.</summary>
    private static string ManifestPath(string ideDir) => Path.Combine(Path.Combine(ideDir, "Automation"), "msenvp.dll.manifest");

    /// <summary>Is this HRESULT the proxy being absent — the class or interface not registered for the reader's
    /// bitness (the field's <c>0x80040154</c>) — rather than a read that failed?</summary>
    public static bool IsProxyMissing(int hr) => hr == RegdbEClassNotReg || hr == RegdbEIidNotReg;

    /// <summary>Can THIS process unmarshal the three interfaces, with XAE's manifest (in <paramref name="ideDir"/>)
    /// active? <c>CoGetPSClsid</c> + an in-proc <c>CoGetClassObject</c> on the proxy class, per interface — no call
    /// into XAE. 0 when it can, else the first failing HRESULT and what failed; throws
    /// <see cref="ProxyManifestMissingException"/> when the IDE ships no manifest.</summary>
    public static (int Hr, string What) ProxyCheck(string ideDir)
    {
        using (Activate(ideDir, out var refused))
            foreach (var t in new[] { typeof(IVsSolution), typeof(IEnumHierarchies), typeof(IVsHierarchy) })
            {
                var iid = t.GUID;
                var hr = CoGetPSClsid(ref iid, out var clsid);
                if (hr != 0) return (hr, $"{refused}CoGetPSClsid({t.Name})");
                var unknown = new Guid("00000000-0000-0000-C000-000000000046");
                hr = CoGetClassObject(ref clsid, ClsctxInprocServer, IntPtr.Zero, ref unknown, out var factory);
                if (hr != 0) return (hr, $"{refused}CoGetClassObject({clsid:B}) for {t.Name}");
                Marshal.Release(factory);
            }
        return (0, "");
    }

    private const uint ClsctxInprocServer = 1;
    [DllImport("ole32.dll")] private static extern int CoGetPSClsid(ref Guid riid, out Guid pClsid);
    [DllImport("ole32.dll")] private static extern int CoGetClassObject(ref Guid rclsid, uint dwClsContext, IntPtr pServerInfo,
                                                                        ref Guid riid, out IntPtr ppv);

    /// <summary>Activates XAE's proxy manifest on this thread until disposed. A manifest that is there but that Windows
    /// will not activate is not a failed read: the read goes on with the proxy COM has registered (null is returned,
    /// <paramref name="refused"/> says why, as a prefix for any message about the proxy that follows) — and if that is
    /// absent too, the reader's caller names both (IDE_UNSUPPORTED) — never a plain COMException, read as
    /// ITEM_UNVERIFIED: "a folder could not be read".</summary>
    private static IDisposable? Activate(string ideDir, out string refused)
    {
        refused = "";
        var manifest = ManifestPath(ideDir);
        if (!File.Exists(manifest)) throw new ProxyManifestMissingException(manifest);
        var ctx = new ActCtxW
        {
            cbSize = Marshal.SizeOf(typeof(ActCtxW)), dwFlags = ActCtxFlagAssemblyDirectoryValid,
            lpSource = manifest, lpAssemblyDirectory = Path.GetDirectoryName(manifest),
        };
        var handle = CreateActCtxW(ref ctx);
        if (handle == new IntPtr(-1))
        {
            refused = $"Windows did not activate {manifest} (CreateActCtx, Win32 {Marshal.GetLastWin32Error()}), so the registered proxy was tried: ";
            return null;
        }
        if (!ActivateActCtx(handle, out var cookie))
        {
            refused = $"Windows did not activate {manifest} (ActivateActCtx, Win32 {Marshal.GetLastWin32Error()}), so the registered proxy was tried: ";
            ReleaseActCtx(handle);
            return null;
        }
        return new Activation(handle, cookie);
    }

    private sealed class Activation : IDisposable
    {
        private readonly IntPtr _handle, _cookie;
        public Activation(IntPtr handle, IntPtr cookie) { _handle = handle; _cookie = cookie; }
        public void Dispose() { DeactivateActCtx(0, _cookie); ReleaseActCtx(_handle); }
    }

    private const uint ActCtxFlagAssemblyDirectoryValid = 0x004;

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct ActCtxW
    {
        public int cbSize;
        public uint dwFlags;
        public string? lpSource;
        public ushort wProcessorArchitecture;
        public ushort wLangId;
        public string? lpAssemblyDirectory;
        public string? lpResourceName;
        public string? lpApplicationName;
        public IntPtr hModule;
    }

    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)] private static extern IntPtr CreateActCtxW(ref ActCtxW actctx);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool ActivateActCtx(IntPtr hActCtx, out IntPtr lpCookie);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool DeactivateActCtx(uint dwFlags, IntPtr ulCookie);
    [DllImport("kernel32.dll")] private static extern void ReleaseActCtx(IntPtr hActCtx);

    private const uint VsItemIdRoot = 0xFFFFFFFE;
    private const uint VsItemIdNil = 0xFFFFFFFF;
    private const int VshPropIdCaption = -2003;
    private const int VshPropIdName = -2012;
    private const int VshPropIdFirstVisibleChild = -2041;
    private const int VshPropIdNextVisibleSibling = -2042;
    private const uint EpfAllProjects = 27;   // __VSENUMPROJFLAGS.EPF_ALLPROJECTS
    private const int MaxDepth = 16;

    private static readonly Guid SidVsSolution = new("7f7cd0db-91ef-49dc-9fa9-02d128515dd4");

    /// <summary>The hierarchy of the SYSTEM project named <paramref name="system"/> (its root names it, by name or
    /// caption), with every PLC project of it in full (<see cref="PlcSubtree"/>) — in one read; null when the
    /// solution holds no such system project. Scoped to the system project because two system projects may hold a PLC
    /// project of one name (<see cref="Find"/> then searches one). Throws when the hierarchy itself cannot be read.
    /// <paramref name="ideDir"/> is the IDE exe's folder: XAE's proxy manifest there is active for the whole read, so
    /// every interface the read unmarshals finds it. <paramref name="roots"/> is the operation's enumeration of the
    /// solution's projects.</summary>
    public static ExplorerNode? ReadSystem(object dte, string system, string ideDir, Roots roots)
    {
        using (Activate(ideDir, out var refused))
            try { return Read(dte, system, roots); }
            catch (Exception ex) when (ex is COMException or HierarchyReadException && refused.Length > 0 && IsProxyMissing(ex.HResult))
            { throw new HierarchyReadException(refused + ex.Message, ex.HResult, ex); }
    }

    /// <summary>The solution's project hierarchies, enumerated ONCE per operation and named as they are met
    /// (<see cref="TcObjectModel.ForgetExplorer"/> drops them with the snapshots). Each system project's read enumerated
    /// the solution's projects from the start until it met its own, reading each root's name and caption — n/2 projects
    /// per read, n reads per walk: O(n²) cross-process reads on an n-system solution (openspec
    /// <c>twincat-large-solution-refs</c>).</summary>
    internal sealed class Roots
    {
        private IEnumHierarchies? _enum;
        private bool _exhausted;
        private readonly List<(string Name, string Caption, List<string> Unread, IVsHierarchy Hierarchy)> _seen = new();

        /// <summary>The root named <paramref name="system"/> (by name or caption), enumerating on from where the last
        /// lookup stopped; null when the solution holds none.</summary>
        internal (string Name, string Caption, List<string> Unread, IVsHierarchy Hierarchy)? Find(object dte, string system)
        {
            foreach (var r in _seen)
                if (Names(r.Name, r.Caption, system)) return r;
            if (_exhausted) return null;
            _enum ??= Enumerate(dte);
            var one = new IVsHierarchy[1];
            while (_enum.Next(1, one, out var got) == 0 && got == 1)
            {
                var unread = new List<string>();
                var r = (Prop(one[0], VsItemIdRoot, VshPropIdName, unread), Prop(one[0], VsItemIdRoot, VshPropIdCaption, unread), unread, one[0]);
                _seen.Add(r);
                if (Names(r.Item1, r.Item2, system)) return r;
            }
            _exhausted = true;
            return null;
        }

        private static bool Names(string name, string caption, string system) =>
            string.Equals(name, system, StringComparison.Ordinal) || string.Equals(caption, system, StringComparison.Ordinal);

        private static IEnumHierarchies Enumerate(object dte)
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
            return projects;
        }
    }

    /// <summary>The system-manager tree node of the PLC projects: the canonical name XAE gives the system project's
    /// <c>PLC</c> node — its tree path, the one <c>LookupTreeItem("TIPC")</c> resolves, not a caption.</summary>
    private const string PlcNode = "TIPC";

    /// <summary>THE PLC SUBTREE ONLY (openspec <c>twincat-large-solution-refs</c>): the snapshot reads nothing outside the
    /// PLC projects' own trees — every caller finds a PLC project's node (<see cref="Find"/>) and reads below it. The rest
    /// of the system project — SYSTEM, MOTION, SAFETY, C++, the I/O tree with every device, terminal and channel, and each
    /// PLC project's instance with every mapped symbol — was read node by node, three cross-process calls a node, and
    /// grows with the plant, not with the code. Below the system project's root only the <c>PLC</c> node (canonical
    /// <see cref="PlcNode"/>) is descended; below a PLC project item (<c>TIPC|&lt;plc&gt;</c>) only its project node, not
    /// its instance (<c>TIPC|&lt;plc&gt;|&lt;plc&gt; Instance</c>, a system-manager path). Every node passed over is still
    /// listed, with no children; a node whose canonical name could not be read is descended, as before. The canonical
    /// names were measured on MultiProject (2026-10-21, <c>TcPlcSubtreeReadTests</c>), and the snapshot of every PLC project
    /// compared equal to the one the whole hierarchy gives.</summary>
    internal static bool PlcSubtree(int depth, string? canonical) => depth switch
    {
        0 => canonical is null || string.Equals(canonical, PlcNode, StringComparison.Ordinal),
        2 => canonical is null || !canonical.StartsWith(PlcNode + "|", StringComparison.Ordinal),
        _ => true,
    };

    private static ExplorerNode? Read(object dte, string system, Roots roots)
    {
        if (roots.Find(dte, system) is not { } found) return null;
        var (name, caption, rootUnread, hierarchy) = found;
        var unread = new List<string>(rootUnread);
        return new ExplorerNode(name, "", caption, Children(hierarchy, VsItemIdRoot, 0, unread, PlcSubtree), Unread(unread));
    }

    /// <summary>The node of the PLC project named <paramref name="name"/> (the PLC tree's nested project, e.g.
    /// <c>Untitled2 Project</c>) inside a system project's hierarchy, with every node beneath it; null when it holds none.
    /// The node of that name that holds children is the nested project (the PLC project item of the same name above it
    /// holds it); a project holding nothing answers its one node.</summary>
    public static ExplorerNode? Find(ExplorerNode node, string name) => Find(node, name, withChildren: true) ?? Find(node, name, withChildren: false);

    private static ExplorerNode? Find(ExplorerNode node, string name, bool withChildren)
    {
        if (string.Equals(node.Name, name, StringComparison.Ordinal) && (!withChildren || node.Children.Count > 0)) return node;
        foreach (var c in node.Children)
            if (Find(c, name, withChildren) is { } hit) return hit;
        return null;
    }

    /// <summary>The children of node <paramref name="id"/>, each with every read it needed. NO READ ENDS THE LIST
    /// QUIETLY OR STANDS IN A VALUE FOR ITSELF: a failure is recorded — on the child whose property it was, or in
    /// <paramref name="unread"/> (the parent's) when the child list itself could not be read on — and the snapshot
    /// refuses any such node inside the PLC project.</summary>
    /// <param name="descend">Whether to read the subtree of the child at <c>depth</c> whose canonical name is the
    /// string — null reads every subtree. A child not descended is listed with no children.</param>
    internal static List<ExplorerNode> Children(IVsHierarchy h, uint id, int depth, List<string> unread,
                                                Func<int, string?, bool>? descend = null)
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
            if (descend is not null && !descend(depth, canonical)) below = new List<ExplorerNode>();
            else if (h.GetNestedHierarchy(c, ref ih, out var nested, out var nestedId) == 0 && nested != IntPtr.Zero)
            {
                IVsHierarchy nh;
                try { nh = (IVsHierarchy)Marshal.GetObjectForIUnknown(nested); }
                finally { Marshal.Release(nested); }
                below = Children(nh, nestedId, depth + 1, mine, descend);
            }
            else below = Children(h, c, depth + 1, mine, descend);
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

    /// <summary>The VSITEMID a hierarchy answered as a VARIANT. A VSITEMID is a DWORD, and a project system boxes it as
    /// it likes: <c>VT_I4</c> (a pointer-valued id at or above 2 GB is a negative <c>Int32</c>), <c>VT_UI4</c>, a narrower
    /// type, or <c>VT_I8</c> holding the DWORD sign- or zero-extended. Each is the same 32 bits. A checked conversion
    /// threw <c>OverflowException</c> on every negative one (openspec <c>twincat-large-solution-refs</c> 2). A value no
    /// DWORD can be is refused by name, never truncated into another item's id.</summary>
    internal static uint ItemId(object v) => v switch
    {
        int i => unchecked((uint)i),
        uint u => u,
        long l when l >= int.MinValue && l <= uint.MaxValue => unchecked((uint)l),
        ulong ul when ul <= uint.MaxValue => (uint)ul,
        short s => unchecked((uint)s),
        ushort us => us,
        sbyte sb => unchecked((uint)sb),
        byte b => b,
        _ => throw new HierarchyReadException(
            $"the hierarchy answered an item id that is no DWORD: {v.GetType().Name} " +
            $"{Convert.ToString(v, CultureInfo.InvariantCulture)}"),
    };

    private static void Check(int hr, string what)
    {
        if (hr != 0) throw new HierarchyReadException($"{what} failed (0x{hr:X8})", hr);
    }

    [ComImport, Guid("6d5140c1-7436-11ce-8034-00aa006009fa"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IOleServiceProvider
    {
        [PreserveSig] int QueryService(ref Guid guidService, ref Guid riid, out IntPtr ppvObject);
    }

    [ComImport, Guid("7f7cd0db-91ef-49dc-9fa9-02d128515dd4"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IVsSolution
    {
        [PreserveSig] int GetProjectEnum(uint grfEnumFlags, ref Guid rguidEnumOnlyThisType, out IEnumHierarchies ppenum);
    }

    [ComImport, Guid("bec77711-2df9-44d7-b478-a453c2e8a134"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IEnumHierarchies
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
