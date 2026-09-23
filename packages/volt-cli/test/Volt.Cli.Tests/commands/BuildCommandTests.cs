using Volt.Cli.Sync;
using Xunit;
using static Volt.Cli.Tests.CommandHarness;
using Volt.Contracts;

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
            var b = Commands.Build(root, client);
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
            var b = Commands.Build(root, client);
            Assert.False(b.Success);
            // The op RAN; the answer was no. That is `ok` + `success:false` — a REFUSAL is a different Kind, and
            // telling them apart is the whole point of the discriminator.
            Assert.Equal(ResultKinds.Ok, b.Kind);
            Assert.Null(b.Reason);
            Assert.Contains(b.Diagnostics, d => d.Severity == "error" && d.Message.Contains("undeclared"));
        }
        finally { host.Dispose(); TestUtil.ForceDelete(root); }
    }

    /// <summary>A REFUSAL IS DISTINGUISHABLE FROM A FAILED BUILD.
    ///
    /// <para>This used to assert the opposite — that the refusal arrives as an error-severity DIAGNOSTIC — which
    /// is what made "the wrong project is open" byte-for-byte identical to "your code does not compile": a
    /// severity, a message, `success:false`, exit 2, no code, no name. An agent reading `volt build --json` got a
    /// fabricated compiler diagnostic for a build that never ran.</para></summary>
    [Fact]
    public void Build_refuses_outside_a_workspace()
    {
        var root = TestUtil.NewRepo();
        try
        {
            var b = Commands.Build(root, new BridgeClient(Pipe()));

            Assert.Equal(ResultKinds.Refused, b.Kind);
            Assert.Contains("not a Volt workspace", b.Reason);
            Assert.Empty(b.Diagnostics);   // nothing compiled, so there is nothing to report about the code
        }
        finally { TestUtil.ForceDelete(root); }
    }
}
