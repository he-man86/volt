using System.Collections.Generic;
using System.Linq;
using Xunit;
using Volt.Contracts;
using Volt.Engine;
using Volt.Engine.Sync;

namespace Volt.Engine.Tests;

/// <summary>
/// THE BUILD OP — its two orderings, and the line between a failed build and a broken bridge.
///
/// <para><c>BuildService</c> had no test at all. Both of the things its own comments call out as load-bearing
/// are invisible without one: the guard sits OUTSIDE the try/catch, and the flush runs BEFORE the build.</para>
/// </summary>
public class BuildServiceTests
{
    private static FakeIde Ide(bool succeeds = true, bool throws = false,
                               params BridgeDiagnostic[] diagnostics) =>
        new(FakeIde.Item.TextualPou("P", "PROGRAM P\nVAR\nEND_VAR", "x := 1;"))
        {
            HealthPlatform = "codesys",
            HealthProjectName = "Demo",
            BuildSucceeds = succeeds,
            BuildThrows = throws,
            BuildDiagnostics = diagnostics.ToList(),
        };

    private static BuildRequest Bound(string platform = "codesys", string project = "Demo") =>
        new() { ExpectedPlatform = platform, ExpectedProjectName = project };

    private static BridgeDiagnostic Error(string message) =>
        new() { Severity = Severity.Error, Message = message };

    /// <summary>A BUILD IS ONE COMPILE OF WHAT THE IDE HOLDS, and nothing else: Volt never saves the engineer's project
    /// (DIALECT D45 — TwinCAT compiles its in-memory project, as CODESYS does).</summary>
    [Fact]
    public void A_build_is_one_compile_and_nothing_else()
    {
        var ide = Ide();

        BuildService.Handle(ide, Bound());

        Assert.Equal(new[] { "build" }, ide.BuildSequence);
    }

    /// <summary>A FAILED BUILD IS success:false PLUS DIAGNOSTICS, never an error frame. The client wants the
    /// diagnostics — that IS the answer to "build" — so a compile failure is a successful op reporting a failed
    /// build, not a failed op.</summary>
    [Fact]
    public void A_failed_build_returns_its_diagnostics_rather_than_throwing()
    {
        var resp = BuildService.Handle(
            Ide(succeeds: false, diagnostics: new[] { Error("C0032: cannot convert INT to BOOL") }), Bound());

        Assert.False(resp.Success);
        Assert.Equal("C0032: cannot convert INT to BOOL", Assert.Single(resp.Diagnostics!).Message);
    }

    /// <summary>AND A CLEAN BUILD REPORTS CLEAN, carrying whatever warnings the IDE produced.</summary>
    [Fact]
    public void A_clean_build_still_carries_its_warnings()
    {
        var warning = new BridgeDiagnostic { Severity = Severity.Warning, Message = "C0195: implicit conversion" };

        var resp = BuildService.Handle(Ide(diagnostics: warning), Bound());

        Assert.True(resp.Success);
        Assert.Equal(Severity.Warning, Assert.Single(resp.Diagnostics!).Severity);
    }

    /// <summary>A BUILD'S END IS AN INFO LINE (openspec relay-outcome-ledger 2.1): verdict, error and warning counts,
    /// duration. It was Debug, so a default bridge log held no record that a CLI build ran or what it found.</summary>
    [Fact]
    public void A_build_logs_its_verdict_counts_and_duration_at_info()
    {
        var warning = new BridgeDiagnostic { Severity = Severity.Warning, Message = "C0195: implicit conversion" };
        string log;
        using (var capture = new LogCapture(VoltLogLevel.Info))
        {
            BuildService.Handle(Ide(diagnostics: new[] { warning, warning }), Bound());
            log = capture.Read();
        }

        Assert.Matches(@"\[info\] build succeeded \(\d+ms\) — 0 errors, 2 warnings", log);
    }

    /// <summary>THE GUARD IS OUTSIDE THE TRY/CATCH — a wrong project SURFACES, it does not become a diagnostic.
    ///
    /// <para>This is the one its own comment names. The catch turns any exception into
    /// <c>success:false</c> + a single "Build failed: …" diagnostic. If the guard ran inside it, a client bound
    /// to the wrong project would be told its CODE does not compile — sending an engineer to read source that is
    /// fine, when the real answer is that the bridge is serving something else entirely.</para></summary>
    [Fact]
    public void A_wrong_project_surfaces_as_an_error_not_as_a_build_diagnostic()
    {
        var ex = Assert.Throws<BridgeException>(() =>
            BuildService.Handle(Ide(), Bound(project: "SomethingElse")));

        Assert.Equal(BridgeErrorCodes.WrongProject, ex.ErrorCode);
    }

    /// <summary>Same for a disconnected bridge, and for the same reason.</summary>
    [Fact]
    public void A_disconnected_bridge_surfaces_as_an_error_not_as_a_build_diagnostic()
    {
        var ide = new FakeIde(FakeIde.Item.TextualPou("P", "PROGRAM P\nVAR\nEND_VAR", "x := 1;"))
        { HealthConnected = false, HealthPlatform = "codesys", HealthProjectName = "Demo" };

        var ex = Assert.Throws<BridgeException>(() => BuildService.Handle(ide, Bound()));

        Assert.Equal(BridgeErrorCodes.PlcDisconnected, ex.ErrorCode);
    }

    /// <summary>BUT AN IDE THAT FAULTS MID-COMPILE IS caught, and reported as a failed build that SAYS SO.
    ///
    /// <para>The inside of the try is the one place a "Build failed: …" diagnostic is honest: the compiler
    /// itself threw, there are no real diagnostics to return, and the engineer needs the reason rather than an
    /// empty success:false.</para></summary>
    [Fact]
    public void An_ide_that_faults_mid_compile_is_reported_as_a_failed_build_with_the_reason()
    {
        var resp = BuildService.Handle(Ide(throws: true), Bound());

        Assert.False(resp.Success);
        var only = Assert.Single(resp.Diagnostics!);
        Assert.Equal(Severity.Error, only.Severity);
        Assert.Contains("the IDE's compiler faulted", only.Message);
        Assert.Null(only.Line);
    }

    /// <summary>A FAILED BUILD ALWAYS NAMES AN ERROR (wire-final-shape 3.6, owner: zero fallback). TwinCAT's
    /// <c>LastBuildInfo</c> can count a failed project while no line of its Output pane is an error Volt can read (its
    /// compiler crashing, task 2.6): that answer was <c>success:false</c> with an EMPTY list. The bridge now says so
    /// in the list, as an error with no position — never an empty answer to a failed build.</summary>
    [Fact]
    public void A_failed_build_with_no_error_diagnostic_names_that_the_IDE_stated_none()
    {
        var warning = new BridgeDiagnostic { Severity = Severity.Warning, Message = "C0195: implicit conversion" };

        var resp = BuildService.Handle(Ide(succeeds: false, diagnostics: warning), Bound());

        Assert.False(resp.Success);
        Assert.Equal(2, resp.Diagnostics.Count);
        var error = Assert.Single(resp.Diagnostics, d => d.Severity == Severity.Error);
        Assert.Contains("stated no error", error.Message);
        Assert.Equal(((string?)null, (int?)null, (int?)null), (error.Name, error.Line, error.Column));
    }

    /// <summary>The duration is milliseconds and says so (<c>durationMs</c>).</summary>
    [Fact]
    public void A_build_states_its_duration_in_milliseconds()
    {
        var resp = BuildService.Handle(Ide(), Bound());

        Assert.InRange(resp.DurationMs, 0, 60_000);
    }
}
