using System;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Text.Json;
using Volt.Cli.Sync;
using Xunit;
using static Volt.Cli.Tests.CommandHarness;
using Volt.Contracts;
using Volt.Engine.Host;

namespace Volt.Cli.Tests;

/// <summary>
/// The black-box CLI-entry contract: spawns the REAL `volt` binary against a live pipe host (connected FakeIde)
/// via VOLT_PIPE, driving arg parsing → dispatch → pipe client → the `Program.Cmd*` rendering + EXIT CODES —
/// the surface scripts and an agent's shell actually observe, which the `Commands.*` unit tests don't reach.
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
        while (pkg is not null && !File.Exists(Path.Combine(pkg.FullName, "Volt.sln"))) pkg = pkg.Parent;
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

    /// <summary>`volt rebind --project-name <name>` — the SEPARATE-token form, which is what the desktop's
    /// reconnect list sends (volt-control/src/bridge/actions.ts spawns
    /// <c>["rebind","--vendor",v,"--project-name",name,"--workspace",dir]</c>).
    /// <para>It shipped BROKEN and both suites were green over it. `--project-name` was missing from
    /// <c>Program.ValueFlags</c>, so the value became a stray operand and every rebind died on "rebind needs
    /// --project-name". Nothing caught it because the C# tests call <c>Commands.Rebind()</c> directly — past the
    /// parser — and the TS test asserts what volt-control SENDS, not what the CLI parses. This is the only test
    /// that spans the two, which is exactly where the defect lived.</para></summary>
    [Fact]
    public void Rebind_takes_its_project_name_as_a_separate_token()
    {
        var (root, host, pipe) = Boot(ConnectedIde(Prg()));
        try
        {
            var r = RunVolt(root, pipe, "rebind", "--vendor", "codesys", "--project-name", "Renamed");
            Assert.True(r.Code == 0, $"rebind exit {r.Code}: {r.Err}");
            Assert.Equal("Renamed", Config.LoadConfig(root).Project.ProjectName);
        }
        finally { host.Dispose(); }
    }

    /// <summary>Every flag READ as a value is declared as one. The set used to be checked in one direction only
    /// ("no entry without a reader"); this is the other, and it is the direction that shipped broken.</summary>
    [Fact]
    public void Every_value_flag_reader_is_declared_in_ValueFlags()
    {
        var (root, host, pipe) = Boot(ConnectedIde(Prg()));
        try
        {
            // `Args.Value` throws for an undeclared flag, so exercising the verbs that read one is the check:
            // an undeclared reader surfaces as a crash here rather than as a silent null in production.
            foreach (var argv in new[]
            {
                new[] { "rebind", "--vendor", "codesys", "--project-name", "X" },
                new[] { "status" },
                new[] { "pull" },
            })
            {
                var r = RunVolt(root, pipe, argv);
                Assert.DoesNotContain("is read as a value flag but is not in ValueFlags", r.Err);
            }
        }
        finally { host.Dispose(); }
    }

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

    /// <summary>An error inside a METHOD names the item's file AND the method (openspec
    /// <c>codesys-diagnostic-child-names</c>): `--json` carries <c>member</c>, and the printed location puts it between
    /// the file and the line, because the vendor counts that line inside the method (DIALECT D36).</summary>
    [Fact]
    public void Build_prints_and_emits_the_member_a_diagnostic_is_inside()
    {
        var ide = new FakeIde(Prg())
        {
            HealthConnected = true, HealthPlatform = "codesys", HealthProjectName = "Demo",
            BuildSucceeds = false,
            BuildDiagnostics = new[] { new BridgeDiagnostic { Name = "PLC_PRG", Member = "Step", Severity = "error", Code = "C0578", Message = "Unexpected statement", Line = 6 } },
        };
        var (root, host, pipe) = Boot(ide);
        try
        {
            RunVolt(root, pipe, "pull");
            var j = RunVolt(root, pipe, "build", "--json");
            using (var doc = JsonDocument.Parse(j.Out.Trim()))
            {
                var d = doc.RootElement.GetProperty("diagnostics")[0];
                Assert.Equal(("PLC_PRG.prg", "Step"), (d.GetProperty("name").GetString(), d.GetProperty("member").GetString()));
            }
            Assert.Contains("PLC_PRG.prg(Step):6 C0578: Unexpected statement", RunVolt(root, pipe, "build").Out);
        }
        finally { host.Dispose(); TestUtil.ForceDelete(root); }
    }

    // ── a DUT's file name is its wire name (openspec dut-subtype-on-the-wire) ───────────────────────

    private const string DutStruct =
        "TYPE X :\nSTRUCT\n\talpha : INT;\n\tbeta : BOOL;\n\tgamma : REAL;\n\tdelta : STRING(80);\n\tepsilon : TIME;\nEND_STRUCT\nEND_TYPE";

    /// <summary>`volt status --json` names the REAL file for an IDE-side DUT edit, and `volt show BRIDGE` on that
    /// path answers with the IDE's text. With `.dut` on the wire `pathByName` said `DUTs/X.dut` — a file that does
    /// not exist, so the extension's drift colouring and the diff pane both missed the real `X.struct`.</summary>
    [Fact]
    public void Status_json_and_show_BRIDGE_name_a_duts_real_file()
    {
        var ide = ConnectedIde(FakeIde.Item.TextualPou("X", DutStruct, "", "DUTs"));
        var (root, host, pipe) = Boot(ide);
        try
        {
            Assert.Equal(0, RunVolt(root, pipe, "pull").Code);
            ide.RemoveItem("X");
            ide.AddItem(FakeIde.Item.TextualPou("X", DutStruct.Replace("alpha : INT;", "alpha : DINT;"), "", "DUTs"));

            var st = RunVolt(root, pipe, "status", "--json");
            Assert.True(st.Code == 0, $"status exit {st.Code}: {st.Err}");
            using (var sj = JsonDocument.Parse(st.Out.Trim()))
                Assert.Equal("DUTs/X.struct", sj.RootElement.GetProperty("pathByName").GetProperty("X.struct").GetString());

            var show = RunVolt(root, pipe, "show", "BRIDGE", "DUTs/X.struct");
            Assert.True(show.Code == 0, $"show exit {show.Code}: {show.Err}");
            Assert.Contains("alpha : DINT;", show.Out);
        }
        finally { host.Dispose(); TestUtil.ForceDelete(root); }
    }

    /// <summary>THE 1.1 FORCE CASE, through the real binary. `git rm X.struct` + a new `X.{enum|union}` is a
    /// delete plus an add; `volt push --force` in either git path order (`X.enum` sorts before `X.struct`,
    /// `X.union` after) must land as one update of the same DUT. Measured before the change: one order was
    /// ACCEPTED with the DUT deleted from the IDE (and status then read in sync over the loss), the other deleted
    /// it and failed.</summary>
    [Theory]
    [InlineData("enum", "TYPE X :\n(\n\tRed := 0,\n\tGreen := 1,\n\tBlue := 2,\n\tCyan := 3,\n\tMagenta := 4\n);\nEND_TYPE")]
    [InlineData("union", "TYPE X :\nUNION\n\tasWord : WORD;\n\tasBytes : ARRAY[0..1] OF BYTE;\n\tasInt : INT;\nEND_UNION\nEND_TYPE")]
    public void Push_force_of_a_dut_subtype_rewrite_keeps_the_dut(string subtype, string text)
    {
        var ide = ConnectedIde(FakeIde.Item.TextualPou("X", DutStruct, "", "DUTs"));
        var (root, host, pipe) = Boot(ide);
        try
        {
            Assert.Equal(0, RunVolt(root, pipe, "pull").Code);
            var dir = Path.Combine(root, "src", "DUTs");
            File.Delete(Path.Combine(dir, "X.struct"));
            File.WriteAllText(Path.Combine(dir, $"X.{subtype}"), text + "\n");

            var push = RunVolt(root, pipe, "push", "--force");
            Assert.True(push.Code == 0, $"push --force exit {push.Code}: {push.Err}");

            Assert.True(ide.Exists("X"), "push --force deleted the DUT from the IDE");
            var refs = Volt.Engine.Sync.RefsService.Handle(ide);
            Assert.Equal(new[] { $"X.{subtype}" }, refs.Items.Keys.ToArray());
            Assert.Equal("DUTs", refs.Folders[$"X.{subtype}"]);

            var st = RunVolt(root, pipe, "status", "--json");
            using var sj = JsonDocument.Parse(st.Out.Trim());
            Assert.Equal("in sync with the IDE", sj.RootElement.GetProperty("summary").GetString());
        }
        finally { host.Dispose(); TestUtil.ForceDelete(root); }
    }

    /// <summary>THE UNREADABLE WARNING DOES NOT SAY A HELD ITEM HAS NO FILE. A DUT caught mid-retype (its text
    /// states no subtype) is unreadable, yet the pull keeps its last-read file and its baseline entry — it is
    /// HELD. `volt status` said every unreadable item has "NO file here" while `src/DUTs/X.struct` sat on disk,
    /// sending the engineer after a missing file instead of telling them the one there is stale and unpushable.</summary>
    [Fact]
    public void Status_warning_does_not_deny_a_held_unreadable_items_file()
    {
        var ide = ConnectedIde(FakeIde.Item.TextualPou("X", DutStruct, "", "DUTs"));
        var (root, host, pipe) = Boot(ide);
        try
        {
            Assert.Equal(0, RunVolt(root, pipe, "pull").Code);
            ide.RemoveItem("X");
            ide.AddItem(FakeIde.Item.TextualPou("X", "TYPE X :\nEND_TYPE", "", "DUTs"));
            Assert.Equal(0, RunVolt(root, pipe, "pull").Code);
            Assert.True(File.Exists(Path.Combine(root, "src", "DUTs", "X.struct")), "fixture: the pull holds X.struct");

            var st = RunVolt(root, pipe, "status");
            Assert.True(st.Code == 0, $"status exit {st.Code}: {st.Err}");
            Assert.Contains("  ? X", st.Err);
            Assert.DoesNotContain("no file", st.Err, StringComparison.OrdinalIgnoreCase);
        }
        finally { host.Dispose(); TestUtil.ForceDelete(root); }
    }

    [Fact]
    public void Show_exit_codes_success_zero_absent_two_and_usage_one()
    {
        var (root, host, pipe) = Boot(ConnectedIde(Prg()));
        try
        {
            RunVolt(root, pipe, "pull");
            Assert.Equal(0, RunVolt(root, pipe, "show", "WORKSPACE", "PLC_PRG.prg").Code);
            Assert.Equal(2, RunVolt(root, pipe, "show", "WORKSPACE", "Nope.prg").Code);   // absent item → empty diff pane (not an error)
            Assert.Equal(1, RunVolt(root, pipe, "show").Code);                            // usage error
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

    /// <summary>THE PARSER REFUSES WHAT IT CANNOT HONOUR, because every boolean flag here fails toward the
    /// DANGEROUS side when it is dropped.
    ///
    /// <para>`ParseArgs` had three arms and no fourth that rejected. `--dry-run=true` took the `=` arm into
    /// `Values`, so `Has("--dry-run")` was false and a push meant as a preview wrote every changed item into the
    /// live PLC and printed `pushed N item(s)`, exit 0. `--dryrun` took the catch-all arm into a set nothing
    /// reads, with the same outcome. A value flag at the end of the line became `""`, and
    /// `volt merge --resolve "$F" --use-theirs` with `$F` unset built the pathspec `src/` — resolving EVERY
    /// conflicted file to the IDE's side.</para>
    ///
    /// <para>Each is asserted by EXIT CODE and by the absence of the side effect, not by the message.</para></summary>
    [Theory]
    [InlineData("--dryrun")]                       // misspelled: was swallowed
    [InlineData("--dry-run=true")]                 // attached value on a boolean: went to Values
    [InlineData("--force=true")]                   // same shape, worse verb
    [InlineData("--nonsense")]
    public void A_flag_the_cli_cannot_honour_is_refused_not_ignored(string flag)
    {
        var (root, host, pipe) = Boot(ConnectedIde(Prg()));
        try
        {
            var r = RunVolt(root, pipe, "push", flag);

            Assert.Equal(1, r.Code);
            Assert.Contains("--", r.Err);                       // it names the flag
            Assert.DoesNotContain("pushed", r.Out);             // and nothing was pushed
        }
        finally { host.Dispose(); }
    }

    /// <summary>A value flag with nothing after it is a TYPO, not an empty string. `--resolve` is the one that
    /// cost most: `""` built the pathspec `src/`, which git resolves wholesale.</summary>
    [Fact]
    public void A_value_flag_with_no_value_is_refused()
    {
        var (root, host, pipe) = Boot(ConnectedIde(Prg()));
        try
        {
            var r = RunVolt(root, pipe, "merge", "--use-theirs", "--resolve");

            Assert.Equal(1, r.Code);
            Assert.Contains("--resolve", r.Err);
        }
        finally { host.Dispose(); }
    }

    /// <summary>And the flags that DO exist still work — the refusal must not become a wall. One real flag per
    /// verb that takes one, asserted by the fact that the verb ran at all.</summary>
    [Theory]
    [InlineData("status", "--json")]
    [InlineData("status", "--porcelain")]
    [InlineData("status", "--local")]
    [InlineData("push", "--dry-run")]
    [InlineData("pull", "--dry-run")]
    public void Every_declared_flag_is_still_accepted(string verb, string flag)
    {
        var (root, host, pipe) = Boot(ConnectedIde(Prg()));
        try
        {
            var r = RunVolt(root, pipe, verb, flag);

            Assert.DoesNotContain("unknown flag", r.Err);
            Assert.DoesNotContain("does not take a value", r.Err);
        }
        finally { host.Dispose(); }
    }
}
