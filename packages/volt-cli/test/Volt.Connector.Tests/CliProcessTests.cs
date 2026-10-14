using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.Principal;
using Volt.Tests.Shared;
using Xunit;

namespace Volt.Connector.Tests;

/// <summary>The tray's wait on a running CLI before an update stops the TwinCAT worker (openspec installer-rebuild,
/// gate 2). An ELEVATED <c>volt.exe</c> of the same user is simulated without elevation: a stand-in process whose
/// DACL denies PROCESS_QUERY_INFORMATION + PROCESS_VM_READ reads exactly like one to an unelevated reader — WMI's
/// ExecutablePath null, <c>Process.MainModule</c> empty — while PROCESS_QUERY_LIMITED_INFORMATION stays granted.</summary>
public class CliProcessTests : IDisposable
{
    private readonly string _dir = Path.Combine(Path.GetTempPath(), "volt-cliprocess-" + Guid.NewGuid().ToString("N"));
    private readonly System.Collections.Generic.List<Process> _started = new();

    private string StandIn(string sub)
    {
        var bin = Path.Combine(_dir, sub, "bin");
        Directory.CreateDirectory(bin);
        var exe = Path.Combine(bin, "volt.exe");
        File.Copy(Path.Combine(Environment.SystemDirectory, "PING.EXE"), exe);
        return exe;
    }

    private Process Start(string exe, uint denied)
    {
        var p = Process.Start(new ProcessStartInfo(exe, "-n 120 127.0.0.1") { UseShellExecute = false, CreateNoWindow = true })!;
        _started.Add(p);
        if (denied != 0)
        {
            var sid = WindowsIdentity.GetCurrent().User!.Value;
            Guard(p.Handle, $"D:(D;;0x{denied:X4};;;WD)(A;;0x1FFFFF;;;{sid})(A;;0x1FFFFF;;;SY)");
        }
        return p;
    }

    [Fact]
    public void An_elevated_CLI_of_this_install_is_found()
    {
        var exe = StandIn("app");
        var p = Start(exe, 0x0410);
        Assert.Equal(p.Id, CliProcess.Find(exe));
    }

    [UnelevatedFact]
    public void A_volt_exe_whose_path_cannot_be_read_at_all_is_waited_on()
    {
        var p = Start(StandIn("elsewhere"), 0x1410);
        Assert.Equal(p.Id, CliProcess.Find(Path.Combine(_dir, "app", "bin", "volt.exe")));
    }

    [Fact]
    public void A_readable_volt_exe_from_another_path_is_not_this_install()
    {
        Start(StandIn("checkout"), 0);
        Assert.Null(CliProcess.Find(Path.Combine(_dir, "app", "bin", "volt.exe")));
    }

    public void Dispose()
    {
        var sid = WindowsIdentity.GetCurrent().User!.Value;
        foreach (var p in _started)
        {
            try { Guard(p.Handle, $"D:(A;;0x1FFFFF;;;{sid})(A;;0x1FFFFF;;;SY)"); p.Kill(); p.WaitForExit(5000); } catch { /* already gone */ }
            p.Dispose();
        }
        try { Directory.Delete(_dir, true); } catch { /* a stand-in still exiting */ }
    }

    private static void Guard(IntPtr process, string sddl)
    {
        if (!ConvertStringSecurityDescriptorToSecurityDescriptor(sddl, 1, out var sd, out _))
            throw new InvalidOperationException($"SDDL {sddl}: {Marshal.GetLastWin32Error()}");
        GetSecurityDescriptorDacl(sd, out _, out var dacl, out _);
        var r = SetSecurityInfo(process, 6 /* SE_KERNEL_OBJECT */, 4 /* DACL_SECURITY_INFORMATION */, IntPtr.Zero, IntPtr.Zero, dacl, IntPtr.Zero);
        LocalFree(sd);
        if (r != 0) throw new InvalidOperationException($"SetSecurityInfo: {r}");
    }

    [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern bool ConvertStringSecurityDescriptorToSecurityDescriptor(string sddl, uint revision, out IntPtr sd, out uint size);
    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern bool GetSecurityDescriptorDacl(IntPtr sd, out bool present, out IntPtr dacl, out bool defaulted);
    [DllImport("advapi32.dll")]
    private static extern uint SetSecurityInfo(IntPtr handle, int type, uint info, IntPtr owner, IntPtr group, IntPtr dacl, IntPtr sacl);
    [DllImport("kernel32.dll")] private static extern IntPtr LocalFree(IntPtr h);
}
