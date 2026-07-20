using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

namespace Volt.Cli.Transport;

/// <summary>
/// Discovers live bridge pipes by enumerating the Windows named-pipe namespace (<c>\\.\pipe\</c>). Every running
/// CODESYS in-proc host serves its own <c>volt.bridge.codesys.&lt;pid&gt;</c>, so a client finds them ALL by listing
/// the namespace for the <see cref="PipeNames.CodesysPrefix"/> — no registry, no coordination file, and the entries
/// vanish with their process (self-cleaning).
///
/// Uses native FindFirstFile/FindNextFile, NOT <c>Directory.GetFiles(@"\\.\pipe\")</c>: the managed API validates
/// entries as file names and throws for pipe names that contain characters illegal in file names (plenty of system
/// pipes do), which would sink the whole enumeration. The native walk returns raw names and never throws.
/// </summary>
public static class PipeDiscovery
{
    /// <summary>Live pipe names (bare, without the <c>\\.\pipe\</c> prefix) that start with <paramref name="prefix"/>.
    /// Best-effort: never throws — returns what it enumerated, or an empty list on any failure.</summary>
    public static IReadOnlyList<string> List(string prefix)
    {
        var result = new List<string>();
        var handle = FindFirstFile(@"\\.\pipe\*", out var data);
        if (handle == InvalidHandle) return result;
        try
        {
            do
            {
                var name = data.cFileName;
                if (!string.IsNullOrEmpty(name) && name.StartsWith(prefix, StringComparison.Ordinal))
                    result.Add(name);
            }
            while (FindNextFile(handle, out data));
        }
        catch { /* best-effort — return whatever we gathered */ }
        finally { FindClose(handle); }
        return result;
    }

    private static readonly IntPtr InvalidHandle = new IntPtr(-1);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr FindFirstFile(string lpFileName, out Win32FindData lpFindFileData);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool FindNextFile(IntPtr hFindFile, out Win32FindData lpFindFileData);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool FindClose(IntPtr hFindFile);

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct Win32FindData
    {
        public uint dwFileAttributes;
        public System.Runtime.InteropServices.ComTypes.FILETIME ftCreationTime;
        public System.Runtime.InteropServices.ComTypes.FILETIME ftLastAccessTime;
        public System.Runtime.InteropServices.ComTypes.FILETIME ftLastWriteTime;
        public uint nFileSizeHigh;
        public uint nFileSizeLow;
        public uint dwReserved0;
        public uint dwReserved1;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)] public string cFileName;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 14)] public string cAlternateFileName;
    }
}
