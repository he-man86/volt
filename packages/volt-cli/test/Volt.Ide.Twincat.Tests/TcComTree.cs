using System.Runtime.InteropServices;

namespace Volt.Ide.Twincat.Tests;

/// <summary>The COM-tree doubles every TwinCAT suite needs the same way: the system manager and its <c>TIPC</c> node.
/// Plain C# objects reached through <c>dynamic</c>, as the driver reaches the COM ones, so their members are typed
/// <c>object</c> — each test keeps its own <c>Node</c> / <c>Plc</c>, which differ.</summary>
public static class TcComTree
{
    /// <summary>What <c>ITcSysManager.LookupTreeItem</c> throws for a path it cannot resolve (measured, DIALECT D29).</summary>
    public static COMException NotFound(string path) =>
        new($"Item '{path}' not found", unchecked((int)0x98510001));

    /// <summary><c>TIPC</c>: one PLC project, at every index (the walk asks for <c>Child[1]</c>).</summary>
    public sealed class Tipc
    {
        public Tipc(object plc) => Child = new PlcList(plc);
        public int ChildCount => 1;
        public PlcList Child { get; }
        public sealed class PlcList { private readonly object _p; public PlcList(object p) => _p = p; public object this[int _] => _p; }
    }

    /// <summary>A system manager that resolves <c>TIPC</c> to <paramref name="tipc"/> and nothing else — with no
    /// <c>tipc</c>, a project whose tree is never reached.</summary>
    public sealed class SysManager
    {
        private readonly object? _tipc;
        public SysManager(object? tipc = null) => _tipc = tipc;
        public object LookupTreeItem(string path) => path == "TIPC" && _tipc is not null ? _tipc : throw NotFound(path);
    }
}
