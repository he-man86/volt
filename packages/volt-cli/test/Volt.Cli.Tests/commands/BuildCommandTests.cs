using Volt.Engine.Wire;
using Volt.Cli.Sync;
using Xunit;
using static Volt.Cli.Tests.CommandHarness;

namespace Volt.Cli.Tests;

/// <summary>`volt build` at the CLI layer — success, diagnostics, and the workspace refusal.</summary>
public class BuildCommandTests
{
    private static FakeIde.Item Prg() =>
        FakeIde.Item.TextualPou("PLC_PRG", "PROGRAM PLC_PRG\nVAR\nEND_VAR", "x := 1;");

    [Fact]
    public void Build_succeeds_with_no_diagnostics_on_a_clean_project()
    {
        var ide = ConnectedIde(Prg());
        var (root, host, client) = Bound(ide);
        try
        {
            Commands.Pull(root, client);
            var b = Commands.Build(root, client, full: false);
            Assert.True(b.Success);
            Assert.Empty(b.Diagnostics);
        }
        finally { host.Dispose(); TestUtil.ForceDelete(root); }
    }

    [Fact]
    public void Build_surfaces_diagnostics_on_a_failing_project()
    {
        var ide = new FakeIde(Prg())
        {
            HealthConnected = true, HealthPlatform = "codesys", HealthProjectName = "Demo",
            BuildSucceeds = false,
            BuildDiagnostics = new[] { new BridgeDiagnostic { Severity = "error", Message = "undeclared identifier 'x'", Line = 3, Column = 5 } },
        };
        var (root, host, client) = Bound(ide);
        try
        {
            Commands.Pull(root, client);
            var b = Commands.Build(root, client, full: false);
            Assert.False(b.Success);
            Assert.Contains(b.Diagnostics, d => d.Severity == "error" && d.Message.Contains("undeclared"));
        }
        finally { host.Dispose(); TestUtil.ForceDelete(root); }
    }

    [Fact]
    public void Build_refuses_outside_a_workspace()
    {
        var root = TestUtil.NewRepo();
        try
        {
            var b = Commands.Build(root, new BridgeClient(Pipe()), full: false);
            Assert.False(b.Success);
            Assert.Contains(b.Diagnostics, d => d.Message.Contains("not a Volt workspace"));
        }
        finally { TestUtil.ForceDelete(root); }
    }
}
