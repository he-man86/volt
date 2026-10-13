using System.Globalization;
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

    /// <summary>Which process reads the hierarchy of an XAE of this bitness, from a worker of that bitness: the reader's
    /// bitness must be the XAE's, because the proxy it loads is the XAE's own (DIALECT C2t). Pure, so the choice is
    /// tested offline for every cell (<c>TcHierarchySelectionTests</c>) — the 64-bit XAE (TcXaeShell64) included,
    /// which no machine here runs.</summary>
    internal enum Reader { InProcess, X86Helper, None }

    internal static Reader ReaderFor(bool xaeIs32Bit, bool workerIs64Bit) =>
        xaeIs32Bit == !workerIs64Bit ? Reader.InProcess
        : xaeIs32Bit ? Reader.X86Helper
        : Reader.None;   // a 64-bit XAE and a 32-bit worker: Volt ships no 64-bit reader beside an x86 worker

    /// <summary>The PLC project's hierarchy node of XAE <paramref name="xaePid"/> — see <c>TcSolutionExplorer.ReadPlcProject</c>.
    /// Throws <see cref="HierarchyUnreachableException"/> when no reader can unmarshal it, anything else when the read
    /// failed.</summary>
    public static ExplorerNode? Read(int xaePid, object dte, string plcProject)
    {
        var xae = Xae(xaePid);
        switch (ReaderFor(xae.Is32Bit, Environment.Is64BitProcess))
        {
            case Reader.InProcess:
                try { return TcSolutionExplorer.ReadPlcProject(dte, plcProject, xae.IdeDir); }
                catch (TcSolutionExplorer.ProxyManifestMissingException ex) { throw new HierarchyUnreachableException(ex.Message); }
                catch (COMException ex) when (TcSolutionExplorer.IsProxyMissing(ex.HResult))
                { throw new HierarchyUnreachableException($"{Proxy} is not available to this {Bits} reader: {ex.Message}"); }
            case Reader.X86Helper:
                return Served(xae.IdeDir, xaePid, plcProject);
            default:
                throw new HierarchyUnreachableException(NoReader);
        }
    }

    /// <summary>What a reader of this XAE lacks, without calling into it — null when nothing is missing. The worker
    /// asks once at start (<c>BeckhoffDriver.CheckHierarchy</c>), so <c>health</c> states it before any op does.</summary>
    public static string? Missing(int xaePid)
    {
        var xae = Xae(xaePid);
        switch (ReaderFor(xae.Is32Bit, Environment.Is64BitProcess))
        {
            case Reader.InProcess:
                try
                {
                    var (hr, what) = TcSolutionExplorer.ProxyCheck(xae.IdeDir);
                    return hr == 0 ? null : $"{Proxy} is not available to this {Bits} reader: {what} failed (0x{hr:X8})";
                }
                catch (TcSolutionExplorer.ProxyManifestMissingException ex) { return ex.Message; }
            case Reader.X86Helper:
                try { Check(xae.IdeDir); return null; }
                catch (HierarchyUnreachableException ex) { return ex.Message; }
            default:
                return NoReader;
        }
    }

    private const string NoReader = "the XAE is 64-bit and this bridge is a 32-bit process, and no 64-bit hierarchy reader ships with it";

    private static string Bits => Environment.Is64BitProcess ? "64-bit" : "32-bit";

    private static readonly JsonSerializerOptions Json = new() { PropertyNameCaseInsensitive = true };

    // The x86 reader this worker keeps, one per worker (one worker serves one XAE). Long-lived on purpose: a process per
    // read cost ~450 ms against ~100 ms for the read itself, and the e2e latency gate caught it (an empty push, two reads,
    // 972 ms against its 500 ms floor). It exits when this process does — its stdin closes.
    private static Process? _served;
    private static readonly object Gate = new();

    /// <summary>One read through the served x86 reader (<c>VoltTwincatExplorer --serve</c>): the PLC project name in,
    /// one answer line out — <c>0 &lt;json&gt;</c>, <c>2 &lt;message&gt;</c> (no proxy for the reader:
    /// <see cref="HierarchyUnreachableException"/>), <c>1 &lt;message&gt;</c> (the read failed).</summary>
    private static ExplorerNode? Served(string ideDir, int xaePid, string plcProject)
    {
        lock (Gate)
        {
            if (_served is not { HasExited: false })
            {
                _served?.Dispose();
                _served = Start(ideDir, redirectError: false, "--serve", "--xae-pid", xaePid.ToString(CultureInfo.InvariantCulture));
            }
            var p = _served;
            p.StandardInput.WriteLine(plcProject);
            p.StandardInput.Flush();
            var reply = p.StandardOutput.ReadLineAsync();
            if (!reply.Wait(HelperTimeoutMs))
            {
                Stop(p);
                throw new TimeoutException($"{HelperExe} did not answer within {HelperTimeoutMs / 1000} s");
            }
            if (reply.Result is not { } answer)
            {
                Stop(p);
                throw new InvalidOperationException($"{HelperExe} ended without an answer (exit {(p.HasExited ? p.ExitCode.ToString(CultureInfo.InvariantCulture) : "?")})");
            }
            var space = answer.IndexOf(' ');
            var (code, rest) = space < 0 ? (answer, "") : (answer.Substring(0, space), answer.Substring(space + 1));
            return code switch
            {
                "0" => JsonSerializer.Deserialize<ExplorerNode?>(rest, Json),
                "2" => throw new HierarchyUnreachableException($"{Proxy} is not available to the 32-bit reader: {rest}"),
                _ => throw new InvalidOperationException($"{HelperExe}: {rest}"),
            };
        }
    }

    private static void Stop(Process p)
    {
        try { p.Kill(); } catch (InvalidOperationException) { /* exited meanwhile */ }
        p.Dispose();
        _served = null;
    }

    /// <summary><c>VoltTwincatExplorer --check</c>: exit 0 = a reader of XAE's bitness can unmarshal the hierarchy here;
    /// exit 2 = it cannot (<see cref="HierarchyUnreachableException"/>); anything else is a check that failed.</summary>
    private static void Check(string ideDir)
    {
        using var p = Start(ideDir, redirectError: true, "--check");
        var stderr = p.StandardError.ReadToEndAsync();
        if (!p.WaitForExit(HelperTimeoutMs))
        {
            try { p.Kill(); } catch (InvalidOperationException) { /* exited meanwhile */ }
            throw new TimeoutException($"{HelperExe} --check did not answer within {HelperTimeoutMs / 1000} s");
        }
        if (p.ExitCode == 0) return;
        if (p.ExitCode == HelperProxyMissing)
            throw new HierarchyUnreachableException($"{Proxy} is not available to the 32-bit reader: {stderr.Result}");
        throw new InvalidOperationException($"{HelperExe} --check failed (exit {p.ExitCode}): {stderr.Result}");
    }

    /// <summary>Starts the x86 reader beside this exe — or says it is missing, which no retry cures.</summary>
    private static Process Start(string ideDir, bool redirectError, params string[] args)
    {
        if (!File.Exists(HelperPath))
            throw new HierarchyUnreachableException(
                $"the 32-bit hierarchy reader {HelperExe} is missing beside the bridge ({AppContext.BaseDirectory}); reinstall Volt");
        var psi = new ProcessStartInfo(HelperPath)
        {
            UseShellExecute = false, CreateNoWindow = true,
            RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = redirectError,
            StandardInputEncoding = new UTF8Encoding(false), StandardOutputEncoding = Encoding.UTF8,
        };
        if (redirectError) psi.StandardErrorEncoding = Encoding.UTF8;
        psi.ArgumentList.Add("--ide-dir");
        psi.ArgumentList.Add(ideDir);
        foreach (var a in args) psi.ArgumentList.Add(a);
        return Process.Start(psi) ?? throw new InvalidOperationException($"{HelperExe} did not start");
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
