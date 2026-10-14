using System.Security.Principal;
using Xunit;

namespace Volt.Tests.Shared;

/// <summary>A fact whose premise holds only unelevated, skipped BY NAME in an elevated process (a CI runner is one): there
/// Administrators is enabled and the debug privilege bypasses a process DACL, so an ACL the test sets up to refuse this
/// user admits it instead — a pipe client then waits on a raw pipe nobody serves, a hidden path reads back.</summary>
public sealed class UnelevatedFactAttribute : FactAttribute
{
    public UnelevatedFactAttribute()
    {
        if (new WindowsPrincipal(WindowsIdentity.GetCurrent()).IsInRole(WindowsBuiltInRole.Administrator))
            Skip = "elevated process: Administrators and the debug privilege bypass the ACL this test sets up (measured only unelevated)";
    }
}
