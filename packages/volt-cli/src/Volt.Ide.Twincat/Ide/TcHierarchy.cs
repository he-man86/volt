using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using Volt.Wire;

namespace Volt.Ide.Twincat;

/// <summary>The Solution Explorer hierarchy cannot be read in this IDE AT ALL — what a reader needs is not there (no
/// proxy for the worker's bitness, a worker of the other bitness) — as opposed to a read that failed. The message says what is
/// missing; <c>TcObjectModel.Explorer</c> turns it into the bridge's <c>IDE_UNSUPPORTED</c> sentence.</summary>
internal sealed class HierarchyUnreachableException : Exception
{
    public HierarchyUnreachableException(string missing) : base(missing) { }
}

/// <summary>
/// WHO READS XAE's SOLUTION EXPLORER (DIALECT C2t). The hierarchy interfaces are not IDispatch: they cross into this
/// worker through msenvp.dll's proxy, which must be of the READER's bitness, and the copy an IDE can be relied on to
/// carry is its own, of its own bitness (TcXaeShell 15: x86, registration-free, <c>Automation\msenvp.dll.manifest</c>).
/// So the worker has the XAE's bitness — the connector starts the x86 build for a 32-bit XAE and the x64 build for a
/// 64-bit one — and reads the hierarchy in-process. A worker of the other bitness reads nothing and says so by name.
/// </summary>
internal static class TcHierarchy
{
    private const string Proxy = "the proxy of the Visual Studio hierarchy interfaces (msenvp.dll, PSFactoryBuffer {E6D78900-BB40-4039-9C54-593A242B65DA})";

    /// <summary>Does a worker of this bitness read the hierarchy of an XAE of that bitness? Only when they match, because
    /// the proxy it loads is the XAE's own (DIALECT C2t). Pure, so every cell is tested offline
    /// (<c>TcHierarchySelectionTests</c>) — the 64-bit XAE (TcXaeShell64) included, which no machine here runs.</summary>
    internal static bool Reads(bool xaeIs32Bit, bool workerIs64Bit) => xaeIs32Bit != workerIs64Bit;

    /// <summary>The request for the PLC project <paramref name="plcProject"/> (its nested project's name) inside the system
    /// project <paramref name="system"/>, one line: a name alone would answer the first system project's PLC project of
    /// that name (<c>TcSolutionExplorer.ReadPlcProject</c>).</summary>
    public static string Scoped(string system, string plcProject) => system + TcSolutionExplorer.ScopeSeparator + plcProject;

    /// <summary>The PLC project's hierarchy node of XAE <paramref name="xaePid"/> — see <c>TcSolutionExplorer.ReadPlcProject</c>.
    /// Throws <see cref="HierarchyUnreachableException"/> when this worker cannot unmarshal it, anything else when the
    /// read failed.</summary>
    public static ExplorerNode? Read(int xaePid, object dte, string plcProject)
    {
        var xae = Xae(xaePid);
        if (!Reads(xae.Is32Bit, Environment.Is64BitProcess)) throw new HierarchyUnreachableException(OtherBitness(xae.Is32Bit));
        try { return TcSolutionExplorer.ReadPlcProject(dte, plcProject, xae.IdeDir); }
        catch (TcSolutionExplorer.ProxyManifestMissingException ex) { throw new HierarchyUnreachableException(ex.Message); }
        catch (COMException ex) when (TcSolutionExplorer.IsProxyMissing(ex.HResult))
        { throw new HierarchyUnreachableException($"{Proxy} is not available to this {Bits} worker: {ex.Message}"); }
    }

    /// <summary>What this worker lacks to read this XAE, without calling into it — null when nothing is missing. The
    /// worker asks once at start (<c>BeckhoffDriver.CheckHierarchy</c>), so <c>health</c> states it before any op does.</summary>
    public static string? Missing(int xaePid)
    {
        var xae = Xae(xaePid);
        if (!Reads(xae.Is32Bit, Environment.Is64BitProcess)) return OtherBitness(xae.Is32Bit);
        try
        {
            var (hr, what) = TcSolutionExplorer.ProxyCheck(xae.IdeDir);
            return hr == 0 ? null : $"{Proxy} is not available to this {Bits} worker: {what} failed (0x{hr:X8})";
        }
        catch (TcSolutionExplorer.ProxyManifestMissingException ex) { return ex.Message; }
    }

    private static string OtherBitness(bool xaeIs32Bit) =>
        $"the XAE is {(xaeIs32Bit ? "32" : "64")}-bit and this TwinCAT worker is {Bits}: its Solution Explorer is read only by "
        + $"the {(xaeIs32Bit ? "x86" : "x64")} worker, the one the connector starts for it";

    private static string Bits => Environment.Is64BitProcess ? "64-bit" : "32-bit";

    /// <summary>The XAE's exe folder and bitness, by its pid.</summary>
    private static (string IdeDir, bool Is32Bit) Xae(int pid)
    {
        var h = OpenProcess(ProcessQueryLimitedInformation, false, pid);
        if (h == IntPtr.Zero) throw new InvalidOperationException($"cannot open the XAE process {pid} (Win32 {Marshal.GetLastWin32Error()})");
        try
        {
            var path = new StringBuilder(1024);
            var size = path.Capacity;
            if (!QueryFullProcessImageName(h, 0, path, ref size))
                throw new InvalidOperationException($"cannot read the XAE process {pid}'s image path (Win32 {Marshal.GetLastWin32Error()})");
            var is32 = ProcessBitness.Is32Bit(pid)
                ?? throw new InvalidOperationException($"cannot read the XAE process {pid}'s bitness");
            return (Path.GetDirectoryName(path.ToString())!, is32);
        }
        finally { CloseHandle(h); }
    }

    private const uint ProcessQueryLimitedInformation = 0x1000;
    [DllImport("kernel32.dll", SetLastError = true)] private static extern IntPtr OpenProcess(uint access, bool inherit, int pid);
    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern bool QueryFullProcessImageName(IntPtr h, uint flags, StringBuilder name, ref int size);
    [DllImport("kernel32.dll")] private static extern bool CloseHandle(IntPtr h);
}
