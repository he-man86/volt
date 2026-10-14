using System;
using System.IO.Pipes;
using System.Runtime.InteropServices;
using System.Security.Principal;
using Microsoft.Win32.SafeHandles;
using Volt.Wire;
using Xunit;

namespace Volt.Tests.Shared;

/// <summary>
/// WHO A BRIDGE PIPE ADMITS (openspec environment-dependency-audit 2.2). Compiled into the net10 CLI suite and the net48
/// CODESYS suite — the CODESYS bridge serves its pipe in-proc on .NET Framework, the TwinCAT worker on .NET 10, and
/// <c>PipeAcl</c> is one P/Invoke path under both.
///
/// <para>What is measured here runs unelevated (a UAC consent no unattended run can give): every instance
/// <see cref="PipeServer"/> creates carries <c>PipeAcl</c> for this user, and a pipe carrying the ELEVATED
/// default — <c>D:(A;;FA;;;SY)(A;;FA;;;BA)(A;;FA;;;&lt;owner&gt;)(A;;FR;;;WD)(A;;FR;;;AN)</c> with the owner an elevated
/// token has, Administrators (both measured 2026-10-13, see <c>PipeAcl</c>) — refuses this same user read-write,
/// which the client names.</para>
/// </summary>
public class PipeAccessTests
{
    private static string NewName() => "volt-test-acl-" + Guid.NewGuid().ToString("N");

    [Fact]
    public void Every_bridge_pipe_admits_its_user_by_SID_at_Medium_integrity_and_nobody_else()
    {
        var name = NewName();
        using var server = new PipeServer(name, (req, emit) => new { ok = true });
        server.Start();
        using var client = new NamedPipeClientStream(".", name, PipeDirection.InOut);
        client.Connect(5000);
        var user = WindowsIdentity.GetCurrent().User!.Value;
        // What PipeAcl writes is D:P(…)S:(ML;;NW;;;ME); read back from the live pipe the kernel adds one control flag,
        // SACL auto-inherited ("S:AI", measured 2026-10-13 on net10 and net48) — the ACEs are exactly the written ones.
        // The user's SID spelled as SDDL spells it: the built-in Administrator (a CI runner) reads back as "LA", not S-1-5-…-500.
        Assert.Equal(DaclSddl($"D:P(A;;FA;;;SY)(A;;FA;;;BA)(A;;FA;;;{user})") + "S:AI(ML;;NW;;;ME)", Sddl(client.SafePipeHandle));
    }

    [Fact]
    public void A_bridge_pipe_still_serves_a_call()
    {
        var name = NewName();
        using var server = new PipeServer(name, (req, emit) => new { ok = true });
        server.Start();
        var r = new PipeClient(name).Call("health", connectTimeoutMs: 5000);
        Assert.True(r.GetProperty("ok").GetBoolean());
    }

    /// <summary>The field case: an IDE run "as administrator" with the default pipe ACL (Administrators as owner). This
    /// user, unelevated, holds Administrators deny-only, so only Everyone's read is left — a read-write open is refused,
    /// and the client says WHY rather than "access to the path is denied".</summary>
    [UnelevatedFact]
    public void The_elevated_default_refuses_the_same_user_and_the_client_names_it()
    {
        var name = NewName();
        using var elevatedDefault = CreateServer(name, "D:P(A;;FA;;;SY)(A;;FA;;;BA)(A;;FR;;;WD)(A;;FR;;;AN)");
        var e = Assert.Throws<PipeAccessDeniedException>(() => new PipeClient(name).Call("health", connectTimeoutMs: 5000));
        Assert.Equal(name, e.PipeName);
        Assert.Contains("refused this process (access denied)", e.Message);
        Assert.Contains("elevated", e.Message);
    }

    // ── test-local Win32 ─────────────────────────────────────────────────────────────────────────────────────────

    private static string Sddl(SafeHandle h)
    {
        const int DACL = 0x4, LABEL = 0x10;
        var err = GetSecurityInfo(h, 6 /* SE_KERNEL_OBJECT */, DACL | LABEL, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, out var sd);
        Assert.True(err == 0, $"GetSecurityInfo failed: {err}");
        try
        {
            Assert.True(ConvertSecurityDescriptorToStringSecurityDescriptorW(sd, 1, DACL | LABEL, out var s, IntPtr.Zero), "SD → SDDL failed");
            try { return Marshal.PtrToStringUni(s)!; }
            finally { LocalFree(s); }
        }
        finally { LocalFree(sd); }
    }

    /// <summary>A DACL through the same SD → SDDL rendering <see cref="Sddl(SafeHandle)"/> reads back with.</summary>
    private static string DaclSddl(string sddl)
    {
        const int DACL = 0x4;
        Assert.True(ConvertStringSecurityDescriptorToSecurityDescriptorW(sddl, 1, out var sd, IntPtr.Zero), "SDDL refused");
        try
        {
            Assert.True(ConvertSecurityDescriptorToStringSecurityDescriptorW(sd, 1, DACL, out var s, IntPtr.Zero), "SD → SDDL failed");
            try { return Marshal.PtrToStringUni(s)!; }
            finally { LocalFree(s); }
        }
        finally { LocalFree(sd); }
    }

    private static SafePipeHandle CreateServer(string name, string sddl)
    {
        Assert.True(ConvertStringSecurityDescriptorToSecurityDescriptorW(sddl, 1, out var sd, IntPtr.Zero), "SDDL refused");
        try
        {
            var sa = new SECURITY_ATTRIBUTES { nLength = Marshal.SizeOf(typeof(SECURITY_ATTRIBUTES)), lpSecurityDescriptor = sd };
            var h = CreateNamedPipeW(@"\\.\pipe\" + name, 0x3, 0x8, 255, 0, 0, 0, ref sa);
            Assert.False(h.IsInvalid, $"CreateNamedPipe failed: {Marshal.GetLastWin32Error()}");
            return h;
        }
        finally { LocalFree(sd); }
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct SECURITY_ATTRIBUTES { public int nLength; public IntPtr lpSecurityDescriptor; public int bInheritHandle; }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern SafePipeHandle CreateNamedPipeW(string name, uint openMode, uint pipeMode, uint maxInstances,
        uint outBuffer, uint inBuffer, uint defaultTimeout, ref SECURITY_ATTRIBUTES sa);

    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern int GetSecurityInfo(SafeHandle h, int type, int info, IntPtr owner, IntPtr group, IntPtr dacl, IntPtr sacl, out IntPtr sd);

    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool ConvertSecurityDescriptorToStringSecurityDescriptorW(IntPtr sd, int revision, int info, out IntPtr sddl, IntPtr len);

    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool ConvertStringSecurityDescriptorToSecurityDescriptorW(string sddl, uint revision, out IntPtr sd, IntPtr size);

    [DllImport("kernel32.dll")] private static extern IntPtr LocalFree(IntPtr h);
}
