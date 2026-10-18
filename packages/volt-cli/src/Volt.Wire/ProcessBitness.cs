using System;
using System.Runtime.InteropServices;

namespace Volt.Wire;

/// <summary>
/// Is a process 32-bit? Read with <c>IsWow64Process</c> through <c>PROCESS_QUERY_LIMITED_INFORMATION</c>: on 64-bit
/// Windows (the only Windows Volt runs on) a WOW64 process is a 32-bit one. The connector picks the TwinCAT worker
/// build by it and the worker checks its own match (DIALECT C2t).
/// </summary>
public static class ProcessBitness
{
    /// <summary>True for a 32-bit process, false for a 64-bit one, null when the process cannot be opened or read (it
    /// exited, or it is another user's) — not known, and never read as either bitness.</summary>
    public static bool? Is32Bit(int pid)
    {
        var h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid);
        if (h == IntPtr.Zero) return null;
        try { return IsWow64Process(h, out var wow64) ? wow64 : (bool?)null; }
        finally { CloseHandle(h); }
    }

    private const uint PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;

    [DllImport("kernel32.dll", SetLastError = true)] private static extern IntPtr OpenProcess(uint access, bool inherit, int pid);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool IsWow64Process(IntPtr h, out bool wow64);
    [DllImport("kernel32.dll")] private static extern bool CloseHandle(IntPtr h);
}
