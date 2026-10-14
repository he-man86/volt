using System;
using System.Diagnostics;

namespace Volt.Wire;

/// <summary>THE FILE A TYPE'S CODE WAS LOADED FROM. An assembly bundled into a single-file exe (the TwinCAT worker
/// PLCAssist ships) has an EMPTY <c>Location</c> — documented .NET behaviour — and its file is then the process's own exe.
/// Anywhere else <c>Location</c> is the DLL itself: the merged <c>Volt.Ide.Codesys.dll</c> in CODESYS, never CODESYS.exe.</summary>
public static class AssemblyFile
{
    public static string? Of(Type anchor)
    {
        var location = anchor.Assembly.Location;
        if (location.Length > 0) return location;
        using var self = Process.GetCurrentProcess();
        return self.MainModule?.FileName;
    }
}
