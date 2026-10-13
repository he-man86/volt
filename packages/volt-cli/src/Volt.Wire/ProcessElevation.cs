using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.Linq;
using System.Runtime.InteropServices;

namespace Volt.Wire;

/// <summary>
/// Is a process elevated ("as administrator")? Read from its token's <c>TokenElevation</c> (openspec
/// environment-dependency-audit 2.2). Measured 2026-10-13 on Windows 11: an UNELEVATED process opens the token of an
/// ELEVATED process of the same user for <c>TOKEN_QUERY</c> (via <c>PROCESS_QUERY_LIMITED_INFORMATION</c>) and reads
/// <c>TokenElevation = 1</c> — CODESYSControlSysTray and GatewaySysTray, elevated, owner Administrators, High integrity.
/// A token that cannot be read (another user's process) is <c>null</c>: not known, and never read as "not elevated".
/// </summary>
public static class ProcessElevation
{
    /// <summary>The processes named <paramref name="names"/> (no extension), each with its elevation (null = unreadable).</summary>
    public static List<(int Pid, bool? Elevated)> Of(IEnumerable<string> names)
    {
        var found = new List<(int, bool?)>();
        foreach (var name in names)
            foreach (var p in Process.GetProcessesByName(name))
                using (p) found.Add((p.Id, Read(p.Id)));
        return found;
    }

    /// <summary>This process's own elevation — its token is always readable, so a failure is thrown, named.</summary>
    public static bool Self() =>
        Read(Process.GetCurrentProcess().Id) ?? throw new Win32Exception(Marshal.GetLastWin32Error(), "cannot read this process's own token elevation");

    private static bool? Read(int pid)
    {
        var process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid);
        if (process == IntPtr.Zero) return null;
        try
        {
            if (!OpenProcessToken(process, TOKEN_QUERY, out var token)) return null;
            try { return GetTokenInformation(token, TokenElevation, out var elevated, 4, out _) ? elevated != 0 : (bool?)null; }
            finally { CloseHandle(token); }
        }
        finally { CloseHandle(process); }
    }

    private const uint PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
    private const uint TOKEN_QUERY = 0x8;
    private const int TokenElevation = 20;

    [DllImport("kernel32.dll", SetLastError = true)] private static extern IntPtr OpenProcess(uint access, bool inherit, int pid);
    [DllImport("advapi32.dll", SetLastError = true)] private static extern bool OpenProcessToken(IntPtr process, uint access, out IntPtr token);
    [DllImport("advapi32.dll", SetLastError = true)] private static extern bool GetTokenInformation(IntPtr token, int cls, out int value, int len, out int returned);
    [DllImport("kernel32.dll")] private static extern bool CloseHandle(IntPtr h);
}
