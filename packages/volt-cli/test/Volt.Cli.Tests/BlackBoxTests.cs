using System;
using System.Diagnostics;
using System.IO;
using System.Text.Json;
using Volt.Cli.Host;
using Volt.Cli.Sync;
using Xunit;

namespace Volt.Cli.Tests;

/// <summary>
/// The black-box parity oracle (openspec unify-bridge-cli-language §3.2): spawns the REAL `volt` binary against a
/// live pipe host (connected FakeIde) via VOLT_PIPE, driving the full CLI — arg parsing, dispatch, the pipe
/// client, and the `--json` rendering — not just the command functions. This is the language-agnostic net the
/// eventual live-IDE smoke test reuses unchanged.
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

    [Fact]
    public void The_volt_binary_pulls_then_reports_status_over_the_pipe()
    {
        var ide = new FakeIde(FakeIde.Item.TextualPou("PLC_PRG", "PROGRAM PLC_PRG\nVAR\nEND_VAR", "x := 1;"))
        { HealthConnected = true, HealthPlatform = "codesys", HealthProjectName = "Demo" };
        var pipe = "volt.test." + Guid.NewGuid().ToString("N");
        var host = new BridgePipeHost(ide, pipe);
        host.Start();
        var root = TestUtil.NewRepo();
        Config.SaveConfig(root, new WorkspaceConfig { Bridge = new() { Port = 8556 }, Project = new() { Platform = "codesys", ProjectName = "Demo" }, LinkedAt = "t" });
        try
        {
            // pull, driven by the real binary over the pipe.
            var pull = RunVolt(root, pipe, "pull", "--json");
            Assert.True(pull.Code == 0, $"pull exit {pull.Code}: {pull.Err}");
            using (var pj = JsonDocument.Parse(pull.Out.Trim()))
                Assert.Equal("ok", pj.RootElement.GetProperty("kind").GetString());
            Assert.True(File.Exists(Path.Combine(root, "src", "PLC_PRG.prg")));

            // status --json — parse the wire shape the frontends consume.
            var st = RunVolt(root, pipe, "status", "--json");
            Assert.True(st.Code == 0, $"status exit {st.Code}: {st.Err}");
            using var sj = JsonDocument.Parse(st.Out.Trim());
            var r = sj.RootElement;
            Assert.Equal("in sync with the IDE", r.GetProperty("summary").GetString());
            Assert.Equal(0, r.GetProperty("incoming").GetProperty("added").GetArrayLength());
            // `merging` is present AND null (JS-parity: null kept, not omitted) — control depends on this.
            Assert.True(r.TryGetProperty("merging", out var m) && m.ValueKind == JsonValueKind.Null);
        }
        finally { host.Dispose(); TestUtil.ForceDelete(root); }
    }
}
