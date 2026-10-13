using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;

namespace Volt.Ide.Twincat;

/// <summary>The Solution Explorer hierarchy cannot be read in this IDE AT ALL — what a reader needs is not there (no
/// proxy for its bitness, no reader of its bitness) — as opposed to a read that failed. The message says what is
/// missing; <c>TcObjectModel.Explorer</c> turns it into the bridge's <c>IDE_UNSUPPORTED</c> sentence.</summary>
internal sealed class HierarchyUnreachableException : Exception
{
    public HierarchyUnreachableException(string missing) : base(missing) { }
}

/// <summary>
/// WHICH PROCESS READS XAE's SOLUTION EXPLORER (DIALECT C2i, "what the read requires"). The hierarchy interfaces are
/// not IDispatch: they cross into this worker through msenvp.dll's proxy, which must be of the READER's bitness, and
/// the copy an IDE can be relied on to carry is its own, of its own bitness (TcXaeShell 15: x86, registration-free,
/// <c>Automation\msenvp.dll.manifest</c>). So the hierarchy is read by a process of the IDE's bitness: this worker
/// when they match, else <see cref="HelperExe"/> (net48 x86, beside this exe), which reads it with XAE's manifest
/// active and answers it as JSON. Measured: the x64 worker read the 32-bit XAE only through a 64-bit msenvp that
/// Visual Studio 2019/2022 registers — never on a plain TwinCAT install (0x80040154).
/// </summary>
internal static class TcHierarchy
{
    public const string HelperExe = "VoltTwincatExplorer.exe";
    private const int HelperProxyMissing = 2;
    private const int HelperTimeoutMs = 120_000;
    private const string Proxy = "the proxy of the Visual Studio hierarchy interfaces (msenvp.dll, PSFactoryBuffer {E6D78900-BB40-4039-9C54-593A242B65DA})";

    private static string HelperPath => Path.Combine(AppContext.BaseDirectory, HelperExe);

    /// <summary>The PLC project's hierarchy node of XAE <paramref name="xaePid"/> — see <c>TcSolutionExplorer.ReadPlcProject</c>.
    /// Throws <see cref="HierarchyUnreachableException"/> when no reader can unmarshal it, anything else when the read
    /// failed.</summary>
    public static ExplorerNode? Read(int xaePid, object dte, string plcProject)
    {
        var xae = Xae(xaePid);
        if (!NeedsHelper(xae.Is32Bit))
        {
            try { return TcSolutionExplorer.ReadPlcProject(dte, plcProject, xae.IdeDir); }
            catch (COMException ex) when (TcSolutionExplorer.IsProxyMissing(ex.HResult))
            { throw new HierarchyUnreachableException($"{Proxy} is not available to this {Bits} reader: {ex.Message}"); }
        }
        var json = RunHelper(xae.IdeDir, "--xae-pid", xaePid.ToString(), "--plc-project", plcProject);
        return JsonSerializer.Deserialize<ExplorerNode?>(json, Json);
    }

    /// <summary>What a reader of this XAE lacks, without calling into it — null when nothing is missing. The worker
    /// asks once at start (<c>BeckhoffDriver.CheckHierarchy</c>), so <c>health</c> states it before any op does.</summary>
    public static string? Missing(int xaePid)
    {
        var xae = Xae(xaePid);
        if (!NeedsHelper(xae.Is32Bit))
        {
            var (hr, what) = TcSolutionExplorer.ProxyCheck(xae.IdeDir);
            return hr == 0 ? null : $"{Proxy} is not available to this {Bits} reader: {what} failed (0x{hr:X8})";
        }
        try { RunHelper(xae.IdeDir, "--check"); return null; }
        catch (HierarchyUnreachableException ex) { return ex.Message; }
    }

    private static string Bits => Environment.Is64BitProcess ? "64-bit" : "32-bit";

    private static bool NeedsHelper(bool xaeIs32Bit) => xaeIs32Bit && Environment.Is64BitProcess;

    private static readonly JsonSerializerOptions Json = new() { PropertyNameCaseInsensitive = true };

    /// <summary>Runs the x86 reader; its stdout on exit 0. Exit <see cref="HelperProxyMissing"/>, or no helper at all,
    /// is the IDE lacking what a reader needs (<see cref="HierarchyUnreachableException"/>); any other failure is a
    /// failed read.</summary>
    private static string RunHelper(string ideDir, params string[] args)
    {
        if (!File.Exists(HelperPath))
            throw new HierarchyUnreachableException(
                $"the 32-bit hierarchy reader {HelperExe} is missing beside the bridge ({AppContext.BaseDirectory}); reinstall Volt");
        var psi = new ProcessStartInfo(HelperPath)
        {
            UseShellExecute = false, CreateNoWindow = true,
            RedirectStandardOutput = true, RedirectStandardError = true,
            StandardOutputEncoding = Encoding.UTF8, StandardErrorEncoding = Encoding.UTF8,
        };
        psi.ArgumentList.Add("--ide-dir");
        psi.ArgumentList.Add(ideDir);
        foreach (var a in args) psi.ArgumentList.Add(a);
        using var p = Process.Start(psi) ?? throw new InvalidOperationException($"{HelperExe} did not start");
        var stderr = p.StandardError.ReadToEndAsync();
        var stdout = p.StandardOutput.ReadToEndAsync();
        if (!p.WaitForExit(HelperTimeoutMs))
        {
            try { p.Kill(); } catch (InvalidOperationException) { /* exited meanwhile */ }
            throw new TimeoutException($"{HelperExe} did not answer within {HelperTimeoutMs / 1000} s");
        }
        if (p.ExitCode == 0) return stdout.Result;
        if (p.ExitCode == HelperProxyMissing)
            throw new HierarchyUnreachableException($"{Proxy} is not available to the 32-bit reader: {stderr.Result}");
        throw new InvalidOperationException($"{HelperExe} failed (exit {p.ExitCode}): {stderr.Result}");
    }

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
            if (!IsWow64Process(h, out var wow64))
                throw new InvalidOperationException($"cannot read the XAE process {pid}'s bitness (Win32 {Marshal.GetLastWin32Error()})");
            return (Path.GetDirectoryName(path.ToString())!, wow64);
        }
        finally { CloseHandle(h); }
    }

    private const uint ProcessQueryLimitedInformation = 0x1000;
    [DllImport("kernel32.dll", SetLastError = true)] private static extern IntPtr OpenProcess(uint access, bool inherit, int pid);
    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern bool QueryFullProcessImageName(IntPtr h, uint flags, StringBuilder name, ref int size);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool IsWow64Process(IntPtr h, out bool wow64);
    [DllImport("kernel32.dll")] private static extern bool CloseHandle(IntPtr h);
}
