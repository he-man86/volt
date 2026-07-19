using System;
using System.Diagnostics;
using System.IO;
using System.Text.Json;
using Volt.Cli.Core.Wire;
using Volt.Cli.Sync;
using Xunit;
using static Volt.Cli.Tests.CommandHarness;

namespace Volt.Cli.Tests;

/// <summary>
/// The black-box CLI-entry contract: spawns the REAL `volt` binary against a live pipe host (connected FakeIde)
/// via VOLT_PIPE, driving arg parsing → dispatch → pipe client → the `Program.Cmd*` rendering + EXIT CODES —
/// the surface scripts and opencode's bash gate actually observe, which the `Commands.*` unit tests don't reach.
/// Covers each verb's success AND error exit code (0 / 1 / 2), the `--json`/`--porcelain` shapes, and usage.
/// </summary>
public class BlackBoxTests
{
    private static string VoltExe()
    {
        var d = new DirectoryInfo(AppContext.BaseDirectory); // .../test/Volt.Cli.Tests/bin/<cfg>/<tfm>/
        var tfm = d.Name;
        var cfg = d.Parent!.Name;
        DirectoryInfo? pkg = d;
        while (pkg is not null && !File.Exists(Path.Combine(pkg.FullName, "Volt.Cli.sln"))) pkg = pkg.Parent;
        Assert.NotNull(pkg);
        var exe = Path.Combine(pkg!.FullName, "src", "Volt.Cli", "bin", cfg, tfm, OperatingSystem.IsWindows() ? "volt.exe" : "volt");
        Assert.True(File.Exists(exe), $"volt binary not built at {exe}");
        return exe;
    }

    private static (int Code, string Out, string Err) RunVolt(string root, string pipe, params string[] args)
    {
        var psi = new ProcessStartInfo(VoltExe()) { RedirectStandardOutput = true, RedirectStandardError = true, UseShellExecute = false };
        foreach (var a in args) psi.ArgumentList.Add(a);
        psi.ArgumentList.Add("--workspace");
        psi.ArgumentList.Add(root);
        psi.Environment["VOLT_PIPE"] = pipe;
        using var p = Process.Start(psi)!;
        var so = p.StandardOutput.ReadToEndAsync();
        var se = p.StandardError.ReadToEndAsync();
        p.WaitForExit();
        return (p.ExitCode, so.GetAwaiter().GetResult(), se.GetAwaiter().GetResult());
    }

    /// <summary>A started pipe host over a connected FakeIde + a bound repo + the pipe name for VOLT_PIPE.</summary>
    private static (string root, BridgePipeHost host, string pipe) Boot(FakeIde ide)
    {
        var pipe = "volt.test." + Guid.NewGuid().ToString("N");
        var host = new BridgePipeHost(ide, pipe);
        host.Start();
        var root = TestUtil.NewRepo();
        Config.SaveConfig(root, new WorkspaceConfig { Bridge = new() { Vendor = "codesys" }, Project = new() { Platform = "codesys", ProjectName = "Demo" }, LinkedAt = "t" });
        return (root, host, pipe);
    }

    private static FakeIde.Item Prg(string impl = "x := 1;") =>
        FakeIde.Item.TextualPou("PLC_PRG", "PROGRAM PLC_PRG\nVAR\nEND_VAR", impl);
    private static void EditPrg(string root, string to) =>
        File.WriteAllText(Path.Combine(root, "src", "PLC_PRG.prg"), File.ReadAllText(Path.Combine(root, "src", "PLC_PRG.prg")).Replace("x := 1;", to));

    [Fact]
    public void Pull_then_status_json_exit_zero_with_the_wire_shape()
    {
        var (root, host, pipe) = Boot(ConnectedIde(Prg()));
        try
        {
            var pull = RunVolt(root, pipe, "pull", "--json");
            Assert.True(pull.Code == 0, $"pull exit {pull.Code}: {pull.Err}");
            using (var pj = JsonDocument.Parse(pull.Out.Trim()))
                Assert.Equal("ok", pj.RootElement.GetProperty("kind").GetString());
            Assert.True(File.Exists(Path.Combine(root, "src", "PLC_PRG.prg")));

            var st = RunVolt(root, pipe, "status", "--json");
            Assert.True(st.Code == 0, $"status exit {st.Code}: {st.Err}");
            using var sj = JsonDocument.Parse(st.Out.Trim());
            var r = sj.RootElement;
            Assert.Equal("in sync with the IDE", r.GetProperty("summary").GetString());
            Assert.Equal(0, r.GetProperty("incoming").GetProperty("added").GetArrayLength());
            Assert.True(r.TryGetProperty("merging", out var m) && m.ValueKind == JsonValueKind.Null); // null kept, not omitted
        }
        finally { host.Dispose(); TestUtil.ForceDelete(root); }
    }

    [Fact]
    public void Push_rejection_exits_2_under_json_and_1_pretty_with_the_reason()
    {
        var ide = ConnectedIde(Prg());
        var (root, host, pipe) = Boot(ide);
        try
        {
            RunVolt(root, pipe, "pull");               // seed the baseline
            ide.MutateImplementation("PLC_PRG", "x := 99;"); // the IDE diverges
            EditPrg(root, "x := 2;");                  // our conflicting edit

            var j = RunVolt(root, pipe, "push", "--json");
            Assert.Equal(2, j.Code);                   // --json: rejected ⇒ exit 2
            using (var doc = JsonDocument.Parse(j.Out.Trim()))
                Assert.Equal("rejected", doc.RootElement.GetProperty("kind").GetString());

            var pretty = RunVolt(root, pipe, "push");
            Assert.Equal(1, pretty.Code);              // pretty: rejected ⇒ exit 1, reason on stderr
            Assert.Contains("the IDE changed since your last sync", pretty.Err);
        }
        finally { host.Dispose(); TestUtil.ForceDelete(root); }
    }

    [Fact]
    public void Push_success_exits_zero_and_reports_the_count()
    {
        var (root, host, pipe) = Boot(ConnectedIde(Prg()));
        try
        {
            RunVolt(root, pipe, "pull");
            EditPrg(root, "x := 2;");
            var r = RunVolt(root, pipe, "push");
            Assert.Equal(0, r.Code);
            Assert.Contains("push", r.Out.ToLowerInvariant());
        }
        finally { host.Dispose(); TestUtil.ForceDelete(root); }
    }

    [Fact]
    public void Pull_conflict_exits_2_and_prints_the_conflict_list()
    {
        var ide = ConnectedIde(Prg());
        var (root, host, pipe) = Boot(ide);
        try
        {
            RunVolt(root, pipe, "pull");
            EditPrg(root, "x := 2;");                  // ours
            ide.MutateImplementation("PLC_PRG", "x := 99;"); // theirs

            var pretty = RunVolt(root, pipe, "pull");
            Assert.Equal(2, pretty.Code);
            Assert.Contains("CONFLICT", pretty.Out);
            Assert.Contains("PLC_PRG.prg", pretty.Out);
        }
        finally { host.Dispose(); TestUtil.ForceDelete(root); }
    }

    [Fact]
    public void Pull_project_mismatch_is_refused_exit_1()
    {
        var ide = new FakeIde(Prg()) { HealthConnected = true, HealthPlatform = "codesys", HealthProjectName = "SomethingElse" };
        var (root, host, pipe) = Boot(ide); // bound to "Demo"
        try
        {
            var r = RunVolt(root, pipe, "pull");
            Assert.Equal(1, r.Code);
            Assert.Contains("SomethingElse", r.Err);
        }
        finally { host.Dispose(); TestUtil.ForceDelete(root); }
    }

    [Fact]
    public void Build_failure_exits_2_json_and_pretty()
    {
        var ide = new FakeIde(Prg())
        {
            HealthConnected = true, HealthPlatform = "codesys", HealthProjectName = "Demo",
            BuildSucceeds = false,
            BuildDiagnostics = new[] { new BridgeDiagnostic { Severity = "error", Message = "undeclared identifier", Line = 3, Column = 5 } },
        };
        var (root, host, pipe) = Boot(ide);
        try
        {
            RunVolt(root, pipe, "pull");
            var j = RunVolt(root, pipe, "build", "--json");
            Assert.Equal(2, j.Code);
            var pretty = RunVolt(root, pipe, "build");
            Assert.Equal(2, pretty.Code);
            Assert.Contains("FAILED", pretty.Out);
        }
        finally { host.Dispose(); TestUtil.ForceDelete(root); }
    }

    [Fact]
    public void Show_success_zero_missing_one_and_usage_one()
    {
        var (root, host, pipe) = Boot(ConnectedIde(Prg()));
        try
        {
            RunVolt(root, pipe, "pull");
            Assert.Equal(0, RunVolt(root, pipe, "show", "WORKSPACE", "PLC_PRG.prg").Code);
            Assert.Equal(1, RunVolt(root, pipe, "show", "WORKSPACE", "Nope.prg").Code);   // missing file
            Assert.Equal(1, RunVolt(root, pipe, "show").Code);                            // usage
        }
        finally { host.Dispose(); TestUtil.ForceDelete(root); }
    }

    [Fact]
    public void Status_porcelain_lists_outgoing_with_prefixes()
    {
        var (root, host, pipe) = Boot(ConnectedIde(Prg()));
        try
        {
            RunVolt(root, pipe, "pull");
            EditPrg(root, "x := 2;");
            var r = RunVolt(root, pipe, "status", "--porcelain");
            Assert.Equal(0, r.Code);
            Assert.Contains("oM ", r.Out);                 // outgoing-Modified prefix
            Assert.Contains("PLC_PRG.prg", r.Out);
        }
        finally { host.Dispose(); TestUtil.ForceDelete(root); }
    }

    [Fact]
    public void Usage_help_and_unknown_verb_exit_codes()
    {
        var (root, host, pipe) = Boot(ConnectedIde(Prg()));
        try
        {
            Assert.Equal(0, RunVolt(root, pipe, "help").Code);          // help ⇒ 0
            Assert.Equal(1, RunVolt(root, pipe, "wat").Code);           // unknown verb ⇒ 1
            Assert.Equal(1, RunVolt(root, pipe, "merge").Code);         // merge with no flags ⇒ usage exit 1
        }
        finally { host.Dispose(); TestUtil.ForceDelete(root); }
    }
}
