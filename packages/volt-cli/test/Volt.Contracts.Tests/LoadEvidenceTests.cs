using System;
using System.Diagnostics;
using System.Linq;
using System.Reflection;
using Volt.Contracts;
using Xunit;

namespace Volt.Contracts.Tests;

/// <summary>
/// THE FIELD LOG ALONE ANSWERS "WHICH COPIES WERE LOADED" AND "WHAT EXACTLY FAILED" (openspec ide-identity-report
/// 3.1 / 3.2).
///
/// <para>Both open field failures — <c>MissingMethodException: Volt.Wire.PipeClient.Call(…)</c> on CODESYS 3.5.17 and
/// <c>MissingFieldException: Volt.Contracts.WireJson.Write</c> on 3.5.21.50 — reached PLCAssist as a bare message.
/// Every unstamped Volt build is <c>1.0.0.0</c> by assembly AND file version, so a log naming only those could not
/// tell two builds apart; the file's ProductVersion (<c>1.0.0+&lt;commit&gt;</c>) can.</para>
/// </summary>
public class LoadEvidenceTests
{
    private static LoadedCopies.Copy C(string name, string product, string location, bool gac = false, string version = "1.0.0.0") =>
        new(name, version, "1.0.0.0", product, location, gac);

    private const string Bundle = @"C:\Users\u\AppData\Local\Temp\Volt\codesys-bridge\4242";

    [Fact]
    public void One_build_with_one_copy_of_each_name_is_no_conflict()
    {
        var copies = new[]
        {
            C("Volt.Wire", "1.0.0+aaa", Bundle + @"\Volt.Wire.dll"),
            C("Volt.Contracts", "1.0.0+aaa", Bundle + @"\Volt.Contracts.dll"),
            C("System.Text.Json", "10.0.12+bbb", Bundle + @"\System.Text.Json.dll", version: "10.0.0.12"),
        };

        Assert.Empty(LoadedCopies.Conflicts(copies));
        Assert.Single(LoadedCopies.Builds(copies));
    }

    /// <summary>3.2: a second Volt build in the process — told apart by ProductVersion, as the ten PLCAssist bundles
    /// are (seven commits, every file 1.0.0.0).</summary>
    [Fact]
    public void Two_Volt_builds_are_named_with_their_commits_assemblies_and_folders()
    {
        var copies = new[]
        {
            C("Volt.Ide.Codesys", "1.0.0+aaa", Bundle + @"\Volt.Ide.Codesys.dll"),
            C("Volt.Wire", "1.0.0+bbb", @"C:\Other\Volt.Wire.dll"),
        };

        var line = Assert.Single(LoadedCopies.Conflicts(copies));
        Assert.Equal(
            $"2 Volt builds loaded: product 1.0.0+aaa (Volt.Ide.Codesys) at {Bundle}; product 1.0.0+bbb (Volt.Wire) at C:\\Other",
            line);
    }

    /// <summary>3.1 (d): a System.Text.Json from the GAC beside the bundle's — two instances of the type the failing
    /// members carry.</summary>
    [Fact]
    public void A_name_loaded_twice_is_named_with_every_copy_and_the_GAC_is_said()
    {
        var gac = @"C:\Windows\Microsoft.NET\assembly\GAC_MSIL\System.Text.Json\v4.0_10.0.0.0__cc7b13ffcd2ddd51\System.Text.Json.dll";
        var copies = new[]
        {
            C("System.Text.Json", "10.0.0+ccc", gac, gac: true, version: "10.0.0.0"),
            C("System.Text.Json", "10.0.12+bbb", Bundle + @"\System.Text.Json.dll", version: "10.0.0.12"),
        };

        var line = Assert.Single(LoadedCopies.Conflicts(copies));
        Assert.Equal(
            $"System.Text.Json loaded 2 times: 10.0.0.0 (file 1.0.0.0, product 10.0.0+ccc, GAC) at {gac}; " +
            $"10.0.0.12 (file 1.0.0.0, product 10.0.12+bbb) at {Bundle}\\System.Text.Json.dll",
            line);
    }

    /// <summary>Measured live on a plain CODESYS SP21 Patch 4 (2026-10-03), every call served: CODESYS's own
    /// LacBinaries copies beside the Windows GAC's and Volt's. Side-by-side framework versions are normal there — not a
    /// conflict, or every healthy install would report one.</summary>
    [Fact]
    public void CODESYS_own_side_by_side_framework_copies_are_listed_not_flagged()
    {
        var lac = @"C:\Program Files\CODESYS 3.5.21.40\CODESYS\LacBinaries\GAC_MSIL";
        var copies = new[]
        {
            C("System.Memory", "4.6.28619.01", lac + @"\System.Memory.0.1.1__cc7b13ffcd2ddd51\System.Memory.dll", version: "4.0.1.1"),
            C("System.Memory", "4.6.31308.01", @"C:\WINDOWS\Microsoft.Netssembly\GAC_MSIL\System.Memory4.0_4.0.1.2__cc7b13ffcd2ddd51\System.Memory.dll", gac: true, version: "4.0.1.2"),
            C("System.Memory", "4.6.3+f62ca000", Bundle + @"\System.Memory.dll", version: "4.0.5.0"),
            C("Microsoft.Bcl.AsyncInterfaces", "5.0.0+cf258a14", lac + @"\Microsoft.Bcl.AsyncInterfaces.0.0.0__cc7b13ffcd2ddd51\Microsoft.Bcl.AsyncInterfaces.dll", version: "5.0.0.0"),
            C("Microsoft.Bcl.AsyncInterfaces", "10.0.12+95017c71", Bundle + @"\Microsoft.Bcl.AsyncInterfaces.dll", version: "10.0.0.12"),
            C("Volt.Wire", "1.0.0+aaa", Bundle + @"\Volt.Wire.dll"),
        };

        Assert.Empty(LoadedCopies.Conflicts(copies));
    }

    [Fact]
    public void The_live_reading_names_this_assemblys_product_version_and_file()
    {
        var self = typeof(LoadedCopies).Assembly;
        var info = FileVersionInfo.GetVersionInfo(self.Location);

        var copy = Assert.Single(LoadedCopies.Loaded(), c => c.Name == "Volt.Contracts");
        Assert.Equal($"{self.GetName().Version} (file {info.FileVersion}, product {info.ProductVersion}) at {self.Location}",
            copy.Describe());
        Assert.Contains("+", info.ProductVersion);   // an unstamped build states its commit — the build's identity
    }

    // ── the failed call ──────────────────────────────────────────

    private static Exception Raise(Action a)
    {
        try { a(); } catch (Exception e) { return e; }
        throw new InvalidOperationException("nothing was thrown");
    }

    /// <summary>A REAL MissingMethodException (the runtime's own text), as a client sees it: the type, the member, and
    /// what was loaded at that moment.</summary>
    [Fact]
    public void A_missing_member_reaches_the_client_with_its_type_member_and_the_loaded_copies()
    {
        var ex = Raise(() => typeof(string).InvokeMember("NoSuchMember", BindingFlags.InvokeMethod | BindingFlags.Public |
                                                         BindingFlags.Instance, null, "", null));

        var message = CallFailure.Message(ex);

        Assert.StartsWith("MissingMethodException: Method 'System.String.NoSuchMember' not found.", message);
        Assert.Contains(LoadedCopies.Conflicts().Count == 0
            ? "[loaded: one copy of each Volt and System.Text.Json assembly, one Volt build]"
            : "[load conflict: ", message);
    }

    /// <summary>The field's exact shape, wrapped as reflection or a type initializer would wrap it: the client still
    /// reads the missing member, the log keeps the whole chain with its stack, and every watched copy.</summary>
    [Fact]
    public void A_wrapped_missing_member_is_looked_through_and_the_log_keeps_stack_and_copies()
    {
        const string field = "Method not found: 'Void Volt.Wire.PipeClient.Call(System.String, System.Object, " +
                             "System.Action`1<System.Text.Json.JsonElement>, Int32)'.";
        var ex = Raise(() => throw new TargetInvocationException(Raise(() => throw new MissingMethodException(field))));

        Assert.StartsWith("MissingMethodException: " + field + " [", CallFailure.Message(ex));

        var log = CallFailure.LogText(ex);
        Assert.Contains("System.Reflection.TargetInvocationException", log);
        Assert.Contains("---> System.MissingMethodException: " + field, log);
        Assert.Contains("   at Volt.Contracts.Tests.LoadEvidenceTests", log);       // the stack
        Assert.Contains("  loaded at the failure:", log);
        var self = typeof(LoadedCopies).Assembly;
        Assert.Contains($"    Volt.Contracts {LoadedCopies.Of(self).Describe()}", log);
        Assert.Contains("    System.Text.Json ", log);
        Assert.Contains("  load conflicts:", log);
    }

    [Fact]
    public void An_ordinary_failure_says_its_type_and_carries_no_load_evidence()
    {
        var ex = Raise(() => throw new InvalidOperationException("the IDE's compiler faulted"));

        Assert.Equal("InvalidOperationException: the IDE's compiler faulted", CallFailure.Message(ex));
        Assert.DoesNotContain("loaded at the failure", CallFailure.LogText(ex));
        // a missing FILE that is not an assembly is not a binding failure either
        Assert.Equal("FileNotFoundException: no such file",
            CallFailure.Message(new System.IO.FileNotFoundException("no such file", @"C:\proj\POU.st")));
    }
}
