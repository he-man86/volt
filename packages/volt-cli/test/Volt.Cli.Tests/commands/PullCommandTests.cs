using System.Linq;
using System.IO;
using Volt.Cli.Sync;
using Volt.Engine.Format.Network;
using Volt.Engine.Item;
using Xunit;
using static Volt.Cli.Tests.CommandHarness;

namespace Volt.Cli.Tests;

/// <summary>`volt pull` at the CLI layer — seed, incremental, conflict, dry-run, and the refusals.</summary>
public class PullCommandTests
{
    private static FakeIde.Item Prg(string impl = "x := 1;") =>
        FakeIde.Item.TextualPou("PLC_PRG", "PROGRAM PLC_PRG\nVAR\nEND_VAR", impl);

    private static string PrgPath(string root) => Path.Combine(root, "src", "PLC_PRG.prg");

    [Fact]
    public void Pull_seeds_the_workspace_then_reports_in_sync_and_is_idempotent()
    {
        var ide = ConnectedIde(Prg(),
            FakeIde.Item.TextualPou("FB_Motor", "FUNCTION_BLOCK FB_Motor\nVAR\nEND_VAR", "y := 2;", "POUs"));
        var (root, host, client) = Bound(ide);
        try
        {
            var r = Commands.Pull(root, client);
            Assert.Equal("ok", r.Kind);
            Assert.Contains("PLC_PRG.prg", r.Synced!);
            Assert.Contains("FB_Motor.fb", r.Synced!);

            Assert.True(File.Exists(PrgPath(root)));
            Assert.True(File.Exists(Path.Combine(root, "src", "POUs", "FB_Motor.fb")));
            Assert.Contains("PROGRAM PLC_PRG", File.ReadAllText(PrgPath(root)));

            var s = Commands.Status(root, client);
            Assert.Equal(0, s.Incoming.Count);
            Assert.Equal(0, s.Outgoing.Count);
            Assert.Equal("in sync with the IDE", s.Summary);

            var r2 = Commands.Pull(root, client);
            Assert.Equal("ok", r2.Kind);
            Assert.Empty(r2.Synced!);
            Assert.Equal("already up to date with the IDE", r2.Message);
        }
        finally { host.Dispose(); TestUtil.ForceDelete(root); }
    }

    [Fact]
    public void Pull_brings_in_an_IDE_side_edit()
    {
        var ide = ConnectedIde(Prg());
        var (root, host, client) = Bound(ide);
        try
        {
            Commands.Pull(root, client);
            ide.MutateImplementation("PLC_PRG", "x := 99;"); // the engineer edits it in the IDE

            var r = Commands.Pull(root, client);
            Assert.Equal("ok", r.Kind);
            Assert.Contains("PLC_PRG.prg", r.Synced!);
            Assert.Contains("x := 99;", File.ReadAllText(PrgPath(root)));
        }
        finally { host.Dispose(); TestUtil.ForceDelete(root); }
    }

    /// <summary>A pull after the engineer moved an item to another folder in the IDE leaves ONE file, in the new
    /// folder — through the commands, the shape `IdeTreeTests.An_item_the_ide_moved_…` pins at the tree.</summary>
    [Fact]
    public void Pull_after_an_IDE_side_move_leaves_one_file_in_the_new_folder()
    {
        const string fb = "FUNCTION_BLOCK FB_Axis\nVAR\nEND_VAR";
        var ide = ConnectedIde(FakeIde.Item.TextualPou("FB_Axis", fb, "", "POUs"));
        var (root, host, client) = Bound(ide);
        try
        {
            Assert.Equal("ok", Commands.Pull(root, client).Kind);
            Assert.True(File.Exists(Path.Combine(root, "src", "POUs", "FB_Axis.fb")));

            ide.RemoveItem("FB_Axis");
            ide.AddItem(FakeIde.Item.TextualPou("FB_Axis", fb, "", "Motion"));

            Assert.Equal("ok", Commands.Pull(root, client).Kind);
            Assert.True(File.Exists(Path.Combine(root, "src", "Motion", "FB_Axis.fb")), "the moved item was not written");
            Assert.False(File.Exists(Path.Combine(root, "src", "POUs", "FB_Axis.fb")),
                         "the old path survived — two files for one item");
            Assert.Equal("in sync with the IDE", Commands.Status(root, client).Summary);
        }
        finally { host.Dispose(); TestUtil.ForceDelete(root); }
    }

    [Fact]
    public void Pull_reports_a_conflict_when_both_sides_edited_the_same_item()
    {
        var ide = ConnectedIde(Prg());
        var (root, host, client) = Bound(ide);
        try
        {
            Commands.Pull(root, client); // base: x := 1
            File.WriteAllText(PrgPath(root), File.ReadAllText(PrgPath(root)).Replace("x := 1;", "x := 2;")); // ours
            ide.MutateImplementation("PLC_PRG", "x := 99;"); // theirs

            var r = Commands.Pull(root, client);
            Assert.Equal("conflict", r.Kind);
            Assert.Contains("PLC_PRG.prg", r.Paths!);
            Assert.True(Git.IsMerging(root)); // left mid-merge for the user to resolve
        }
        finally { host.Dispose(); TestUtil.ForceDelete(root); }
    }

    /// <summary>The upgrade to MATERIALIZATION 3 (network text v2) re-materializes every graphical body, so an
    /// engineer's un-pushed v1 edit can meet it as a conflict — and v1 can never be pushed again (refused, "re-pull").
    /// Resolving it by keeping OUR side would keep text no Volt reads, so the conflict names those files and the one
    /// resolution that works (openspec network-text-literal-nwl 6.4). It can also merge CLEANLY, see below. The body
    /// states LD on both sides: network text is only ever read under IMPLEMENTATION LD|FBD, so that is where v1 text a
    /// merge keeps can stand (under IMPLEMENTATION ST it is a contradiction, refused before the v1 question).</summary>
    [Fact]
    public void A_conflict_over_network_text_v1_names_the_files_and_the_resolution()
    {
        var ide = ConnectedIde(FakeIde.Item.TextualPou("PLC_PRG", "PROGRAM PLC_PRG\nVAR\nEND_VAR",
            "IMPLEMENTATION LD\nNETWORK 0 LD\n  out := a;\nEND_NETWORK"));   // pulled by the previous Volt: v1 text
        var (root, host, client) = Bound(ide);
        try
        {
            Commands.Pull(root, client);
            File.WriteAllText(PrgPath(root), File.ReadAllText(PrgPath(root)).Replace("out := a;", "out := b;")); // ours, v1
            ide.MutateImplementation("PLC_PRG", "IMPLEMENTATION LD\nNETWORK\n  out := c;\nEND_NETWORK"); // the upgrade's re-materialization

            var r = Commands.Pull(root, client);
            Assert.Equal("conflict", r.Kind);
            Assert.NotNull(r.Message);
            Assert.Contains("PLC_PRG.prg", r.Message);
            Assert.Contains("network text v1", r.Message);
            Assert.Contains("--theirs", r.Message);
        }
        finally { host.Dispose(); TestUtil.ForceDelete(root); }
    }

    /// <summary>The hunk need not hold the v1 header. A v1 network whose header is followed by `//` comment lines
    /// merges its header cleanly onto the IDE's bare `NETWORK`, and the conflict hunk holds only v1 `LET` statements —
    /// the file still holds v1 text the push refuses, so the note must still name it.</summary>
    [Fact]
    public void A_conflict_whose_hunk_holds_only_v1_statements_still_names_the_file()
    {
        var ide = ConnectedIde(FakeIde.Item.TextualPou("PLC_PRG", "PROGRAM PLC_PRG\nVAR\nEND_VAR",
            "NETWORK 14 LD TITLE: \"Digital inputs\"\n// read the inputs\n// once per cycle\n" +
            "LET en1 := TRUE;\nIF en1 THEN mydword := MOVE(%ID79); END_IF\nLET g8 := en1;\nEND_NETWORK"));
        var (root, host, client) = Bound(ide);
        try
        {
            Commands.Pull(root, client);
            File.WriteAllText(PrgPath(root), File.ReadAllText(PrgPath(root)).Replace("%ID79", "%ID80")); // ours, v1
            ide.MutateImplementation("PLC_PRG",                                                          // the re-materialization
                "IMPLEMENTATION LD\nNETWORK TITLE: \"Digital inputs\"\n// read the inputs\n// once per cycle\n" +
                "mydword := MOVE(%ID79);\nEND_NETWORK");

            var r = Commands.Pull(root, client);
            Assert.Equal("conflict", r.Kind);
            // The premise: git merged the header, so no line of the file is a v1 header any more.
            Assert.DoesNotMatch(@"(?m)^\s*NETWORK\s+\d+", File.ReadAllText(PrgPath(root)));
            Assert.NotNull(r.Message);
            Assert.Contains("PLC_PRG.prg", r.Message);
            Assert.Contains("network text v1", r.Message);
        }
        finally { host.Dispose(); TestUtil.ForceDelete(root); }
    }

    /// <summary>A line spelled like a v1 header outside any graphical body — here in a comment in the declaration of
    /// a pure-ST program — is no v1 text, and a note telling the engineer to throw their side away would lose a
    /// pushable edit.</summary>
    [Fact]
    public void A_v1_header_spelling_in_a_declaration_comment_is_no_v1_text()
    {
        var ide = ConnectedIde(FakeIde.Item.TextualPou("PLC_PRG",
            "PROGRAM PLC_PRG\n(*\n  the tray infeed:\nNETWORK 2 drives the conveyor\n*)\nVAR\nEND_VAR", "x := 1;"));
        var (root, host, client) = Bound(ide);
        try
        {
            Commands.Pull(root, client);
            File.WriteAllText(PrgPath(root), File.ReadAllText(PrgPath(root)).Replace("x := 1;", "x := 2;"));
            ide.MutateImplementation("PLC_PRG", "x := 99;");

            var r = Commands.Pull(root, client);
            Assert.Equal("conflict", r.Kind);
            Assert.Null(r.Message);
        }
        finally { host.Dispose(); TestUtil.ForceDelete(root); }
    }

    private const string V1Body =
        "NETWORK 0 LD\n  LET g0 := (a AND b);\n  p := g0;\n  q := g0;\nEND_NETWORK\n" +
        "NETWORK 1 LD\n  LET g1 := (a OR b);\n  r := g1;\n  s := g1;\nEND_NETWORK\n" +
        "NETWORK 2 LD\n  out := (a AND b);\n  out2 := x;\nEND_NETWORK";

    private const string V2Body =
        "IMPLEMENTATION LD\n" +
        "NETWORK\n  VAR_TEMP g0 : BOOL; END_VAR\n  g0 := (a AND b);\n  p := g0;\n  q := g0;\nEND_NETWORK\n" +
        "NETWORK\n  VAR_TEMP g1 : BOOL; END_VAR\n  g1 := (a OR b);\n  r := g1;\n  s := g1;\nEND_NETWORK\n" +
        "NETWORK\n  out := (a AND b);\n  out2 := x;\nEND_NETWORK";

    /// <summary>An un-pushed v1 edit does NOT always meet the re-materialization as a conflict: next to lines the IDE
    /// left alone, git merges it cleanly — and when the edit adds v1 constructs (a whole `NETWORK 3 LD` with a `LET`)
    /// the clean result is a hybrid v1/v2 body the push refuses. The pull is the moment the engineer can still act on
    /// it (a re-pull later changes nothing), so a clean pull names it too.</summary>
    [Fact]
    public void A_clean_merge_that_leaves_v1_text_in_a_body_names_the_file()
    {
        var ide = ConnectedIde(FakeIde.Item.TextualPou("PLC_PRG", "PROGRAM PLC_PRG\nVAR\nEND_VAR", V1Body));
        var (root, host, client) = Bound(ide);
        try
        {
            Commands.Pull(root, client);
            File.WriteAllText(PrgPath(root), File.ReadAllText(PrgPath(root)).Replace("  out2 := x;\nEND_NETWORK",
                "  out2 := x;\nEND_NETWORK\nNETWORK 3 LD\n  LET g3 := (c AND d);\n  y := g3;\n  z := g3;\nEND_NETWORK")); // ours: a v1 network added
            ide.MutateImplementation("PLC_PRG", V2Body);

            var r = Commands.Pull(root, client);
            Assert.Equal("ok", r.Kind);
            Assert.Contains("LET g3", File.ReadAllText(PrgPath(root)));      // the premise: a clean, hybrid merge
            Assert.NotNull(r.Message);
            Assert.Contains("PLC_PRG.prg", r.Message);
            Assert.Contains("network text v1", r.Message);
        }
        finally { host.Dispose(); TestUtil.ForceDelete(root); }
    }

    /// <summary>Which files the note judges is the ENGINE's answer, asked by the file name — every other v1 test here
    /// uses a `.prg`, so a CLI that swapped the engine call for its own extension check (`EndsWith(".prg")`) passed
    /// them all while an FB's or a function's v1 body went un-noted. The same clean hybrid merge, per kind that can
    /// hold network text.</summary>
    [Theory]
    [InlineData("FB_Conv", "FUNCTION_BLOCK FB_Conv\nVAR\nEND_VAR", "FB_Conv.fb")]
    [InlineData("F_Gate", "FUNCTION F_Gate : BOOL\nVAR\nEND_VAR", "F_Gate.fun")]
    public void A_clean_merge_that_leaves_v1_text_names_the_file_for_every_kind_with_a_body(
        string name, string decl, string file)
    {
        var ide = ConnectedIde(FakeIde.Item.TextualPou(name, decl, V1Body));
        var (root, host, client) = Bound(ide);
        var path = Path.Combine(root, "src", file);
        try
        {
            Commands.Pull(root, client);
            File.WriteAllText(path, File.ReadAllText(path).Replace("  out2 := x;\nEND_NETWORK",
                "  out2 := x;\nEND_NETWORK\nNETWORK 3 LD\n  LET g3 := (c AND d);\n  y := g3;\n  z := g3;\nEND_NETWORK"));
            ide.MutateImplementation(name, V2Body);

            var r = Commands.Pull(root, client);
            Assert.Equal("ok", r.Kind);
            Assert.Contains("LET g3", File.ReadAllText(path));               // the premise: a clean, hybrid merge
            Assert.NotNull(r.Message);
            Assert.Contains(file, r.Message);
            Assert.Contains("network text v1", r.Message);
        }
        finally { host.Dispose(); TestUtil.ForceDelete(root); }
    }

    /// <summary>…and a kind that holds no body — a GVL, a DUT under its subtype name — is not judged at all, even when
    /// its declaration carries v1-looking text an IDE-side change brought in: no note, and no "does not split"
    /// unreadable entry either (it was never parsed as a POU).
    ///
    /// <para>What this pins of the CLI: that it adds no judgement of its OWN to the engine's — a text scan for v1
    /// spellings would flag the header this declaration's comment carries. It cannot tell the CLI's `CanHold` skip
    /// from its absence, and need not: `NetworkText.FileHoldsV1` asks `CanHold` itself, so the skip only saves a
    /// read and changes no answer.</para></summary>
    [Theory]
    [InlineData("GVL_Io", "VAR_GLOBAL\n  a : BOOL;\nEND_VAR", "GVL_Io.gvl")]
    [InlineData("ST_Io", "TYPE ST_Io :\nSTRUCT\n  a : BOOL;\nEND_STRUCT\nEND_TYPE", "ST_Io.struct")]
    [InlineData("E_Io", "TYPE E_Io :\n(\n  a := 0\n);\nEND_TYPE", "E_Io.enum")]
    public void A_pull_judges_no_v1_in_a_kind_without_a_body(string name, string decl, string file)
    {
        var ide = ConnectedIde(FakeIde.Item.TextualPou(name, decl, ""));
        var (root, host, client) = Bound(ide);
        try
        {
            Assert.Equal("ok", Commands.Pull(root, client).Kind);
            Assert.True(File.Exists(Path.Combine(root, "src", file)), $"the premise: {file} was materialized");
            ide.RemoveItem(name);
            ide.AddItem(FakeIde.Item.TextualPou(name,
                decl.Replace("  a", "  (* NETWORK 0 LD\n  LET g0 := TRUE; *)\n  a"), ""));

            var r = Commands.Pull(root, client);
            Assert.Equal("ok", r.Kind);
            Assert.Contains(file, r.Synced!);                                  // the premise: the IDE side changed it
            Assert.Null(r.Message);
        }
        finally { host.Dispose(); TestUtil.ForceDelete(root); }
    }

    /// <summary>…while a v1 edit git merges cleanly INTO v2 text (a statement both forms spell alike) leaves nothing
    /// v1 behind, and the pull says nothing about v1.</summary>
    [Fact]
    public void A_clean_merge_that_leaves_only_v2_text_carries_no_v1_note()
    {
        var ide = ConnectedIde(FakeIde.Item.TextualPou("PLC_PRG", "PROGRAM PLC_PRG\nVAR\nEND_VAR", V1Body));
        var (root, host, client) = Bound(ide);
        try
        {
            Commands.Pull(root, client);
            File.WriteAllText(PrgPath(root), File.ReadAllText(PrgPath(root)).Replace("out2 := x;", "out2 := y;"));
            ide.MutateImplementation("PLC_PRG", V2Body);

            var r = Commands.Pull(root, client);
            Assert.Equal("ok", r.Kind);
            Assert.Contains("out2 := y;", File.ReadAllText(PrgPath(root)));   // the premise: the edit merged in
            Assert.Null(r.Message);
        }
        finally { host.Dispose(); TestUtil.ForceDelete(root); }
    }

    /// <summary>A modify/delete conflict is a conflict the IDE side materialized nothing for: the engineer edited a v1
    /// body and the IDE deleted the item. Keeping our side re-creates the POU with v1 text the push refuses, so the
    /// note must judge every CONFLICTED file, not only the ones the IDE changed.</summary>
    [Fact]
    public void A_modify_delete_conflict_over_network_text_v1_names_the_file()
    {
        var ide = ConnectedIde(FakeIde.Item.TextualPou("PLC_PRG", "PROGRAM PLC_PRG\nVAR\nEND_VAR",
            "NETWORK 0 LD\n  LET g0 := TRUE;\n  out := g0;\nEND_NETWORK"));
        var (root, host, client) = Bound(ide);
        try
        {
            Commands.Pull(root, client);
            File.WriteAllText(PrgPath(root), File.ReadAllText(PrgPath(root)).Replace("out := g0;", "out2 := g0;")); // ours, v1
            ide.RemoveItem("PLC_PRG");                                                                          // theirs: deleted

            var r = Commands.Pull(root, client);
            Assert.Equal("conflict", r.Kind);
            Assert.Contains("PLC_PRG.prg", r.Paths!);
            Assert.NotNull(r.Message);
            Assert.Contains("PLC_PRG.prg", r.Message);
            Assert.Contains("network text v1", r.Message);
        }
        finally { host.Dispose(); TestUtil.ForceDelete(root); }
    }

    /// <summary>A file the merge left too malformed to split into declaration and bodies cannot be judged — and
    /// dropping it from the note is the silence the note exists to break: the engineer fixes the declaration, the
    /// push then refuses the v1 body ("re-pull"), and by then a re-pull changes nothing. So the note names it as
    /// unchecked.</summary>
    [Fact]
    public void A_file_the_merge_left_unreadable_is_named_as_unchecked()
    {
        var ide = ConnectedIde(FakeIde.Item.TextualPou("PLC_PRG", "PROGRAM PLC_PRG\nVAR\nEND_VAR", V1Body));
        var (root, host, client) = Bound(ide);
        try
        {
            Commands.Pull(root, client);
            File.WriteAllText(PrgPath(root), File.ReadAllText(PrgPath(root))
                .Replace("PROGRAM PLC_PRG", "FUNCTION_BLOCK PLC_PRG")                  // ours: a header the .prg refuses
                .Replace("  out2 := x;\nEND_NETWORK",
                    "  out2 := x;\nEND_NETWORK\nNETWORK 3 LD\n  LET g3 := (c AND d);\n  y := g3;\n  z := g3;\nEND_NETWORK"));
            ide.MutateImplementation("PLC_PRG", V2Body);

            var r = Commands.Pull(root, client);
            Assert.Equal("ok", r.Kind);
            var merged = File.ReadAllText(PrgPath(root));
            Assert.Contains("FUNCTION_BLOCK PLC_PRG", merged);   // the premise: a clean merge that no longer splits
            Assert.Contains("LET g3", merged);
            Assert.NotNull(r.Message);
            Assert.Contains("PLC_PRG.prg", r.Message);
        }
        finally { host.Dispose(); TestUtil.ForceDelete(root); }
    }

    /// <summary>…and an ordinary conflict says nothing about v1.</summary>
    [Fact]
    public void An_ordinary_conflict_carries_no_v1_note()
    {
        var ide = ConnectedIde(Prg());
        var (root, host, client) = Bound(ide);
        try
        {
            Commands.Pull(root, client);
            File.WriteAllText(PrgPath(root), File.ReadAllText(PrgPath(root)).Replace("x := 1;", "x := 2;"));
            ide.MutateImplementation("PLC_PRG", "x := 99;");

            var r = Commands.Pull(root, client);
            Assert.Equal("conflict", r.Kind);
            Assert.Null(r.Message);
        }
        finally { host.Dispose(); TestUtil.ForceDelete(root); }
    }

    /// <summary>THE bug this was added for. Both frontends have shown a "Force Pull" button with a "this cannot be
    /// undone, your local edits are discarded" confirm since long before the CLI could do it: volt-control passed
    /// `--force`, `Commands.Pull` had no such parameter, and the unknown flag was silently ignored — so the user
    /// clicked through a destructive warning and got a plain pull that changed nothing.
    /// <para>The IDE is deliberately UNCHANGED here, because that is the state a user is actually in when they
    /// reach for it: they edited locally, want it thrown away, and there is nothing incoming. The non-force path
    /// short-circuits on "already up to date" — force must not.</para></summary>
    [Fact]
    public void Force_pull_discards_local_edits_even_when_the_IDE_has_not_changed()
    {
        var ide = ConnectedIde(Prg());
        var (root, host, client) = Bound(ide);
        try
        {
            Commands.Pull(root, client);                        // base: x := 1
            var pristine = File.ReadAllText(PrgPath(root));
            File.WriteAllText(PrgPath(root), pristine.Replace("x := 1;", "x := 999;"));
            var stray = Path.Combine(root, "src", "Scratch.prg"); // an untracked file is local work too
            File.WriteAllText(stray, "PROGRAM Scratch\nIMPLEMENTATION ST\nEND_PROGRAM");

            var plain = Commands.Pull(root, client);            // a NORMAL pull preserves local work...
            Assert.Equal("ok", plain.Kind);
            Assert.Contains("x := 999;", File.ReadAllText(PrgPath(root)));

            var forced = Commands.Pull(root, client, force: true);

            Assert.Equal("ok", forced.Kind);
            Assert.Equal(pristine, File.ReadAllText(PrgPath(root))); // ...force takes the IDE's state
            Assert.False(File.Exists(stray));                        // including dropping untracked files
            Assert.Contains("discarded", forced.Message);            // and SAYS so — a silent force is the bug
        }
        finally { host.Dispose(); TestUtil.ForceDelete(root); }
    }

    /// <summary>Force pull must not destroy anything outside src/ — the README, .vscode, and whatever else the
    /// engineer keeps beside the code are not Volt's to discard.</summary>
    [Fact]
    public void Force_pull_leaves_everything_outside_src_alone()
    {
        var ide = ConnectedIde(Prg());
        var (root, host, client) = Bound(ide);
        try
        {
            Commands.Pull(root, client);
            var notes = Path.Combine(root, "NOTES.md");
            File.WriteAllText(notes, "my working notes");
            File.WriteAllText(PrgPath(root), "corrupted");

            Commands.Pull(root, client, force: true);

            Assert.True(File.Exists(notes));
            Assert.Equal("my working notes", File.ReadAllText(notes));
        }
        finally { host.Dispose(); TestUtil.ForceDelete(root); }
    }

    [Fact]
    public void Pull_refuses_while_a_merge_is_already_in_progress()
    {
        var ide = ConnectedIde(Prg());
        var (root, host, client) = Bound(ide);
        try
        {
            Commands.Pull(root, client);
            File.WriteAllText(PrgPath(root), File.ReadAllText(PrgPath(root)).Replace("x := 1;", "x := 2;"));
            ide.MutateImplementation("PLC_PRG", "x := 99;");
            Commands.Pull(root, client); // → conflict, leaves a merge in progress

            var r = Commands.Pull(root, client);
            Assert.Equal("refused", r.Kind);
            Assert.Contains("a merge is already in progress", r.Reason);
        }
        finally { host.Dispose(); TestUtil.ForceDelete(root); }
    }

    [Fact]
    public void Pull_dry_run_previews_without_merging()
    {
        var ide = ConnectedIde(Prg());
        var (root, host, client) = Bound(ide);
        try
        {
            Commands.Pull(root, client);
            ide.MutateImplementation("PLC_PRG", "x := 99;");

            var r = Commands.Pull(root, client, dryRun: true);
            Assert.Equal("ok", r.Kind);
            Assert.Contains("PLC_PRG.prg", r.Synced!);
            Assert.Equal("dry run — these IDE items would be merged in", r.Message);
            Assert.Contains("x := 1;", File.ReadAllText(PrgPath(root))); // workspace untouched
        }
        finally { host.Dispose(); TestUtil.ForceDelete(root); }
    }

    [Fact]
    public void Pull_refuses_a_project_mismatch()
    {
        var ide = new FakeIde(FakeIde.Item.TextualPou("P", "PROGRAM P\nVAR\nEND_VAR", "x := 1;"))
        { HealthConnected = true, HealthPlatform = "codesys", HealthProjectName = "SomethingElse" };
        var (root, host, client) = Bound(ide); // bound to "Demo"
        try
        {
            var r = Commands.Pull(root, client);
            Assert.Equal("refused", r.Kind);
            Assert.Contains("SomethingElse", r.Reason);
        }
        finally { host.Dispose(); TestUtil.ForceDelete(root); }
    }

    /// <summary>A PULL OVER A PARTIAL WALK KEEPS THE FILES AND SAYS THE VIEW IS SHORT.
    ///
    /// <para>Two halves, in two places, and it is worth being exact about which does what. The FILES survive
    /// because `FetchService` names nothing under an unwalked folder in its `removed` list — the destructive
    /// path reads `fetched.Removed`, so that is the half that prevents data loss. The client half is what the
    /// USER is told: `PostStatus` carries the incompleteness and the bridge's own `removed`, so the status the
    /// pull returns derives no deletion from absence and names the folder it could not read. Without it a pull that changed nothing
    /// on disk still reported the engineer's POUs as incoming-REMOVED.</para>
    ///
    /// <para>This is also the hazard `BridgeClient.GuardEmptyItems` was standing in for, and it stood in the
    /// wrong place: it re-probed the CACHED health snapshot after a successful fetch and refused when it showed
    /// nothing serving — using the staler of two signals to override the op's own LIVE guard, which had already
    /// passed — and it could not tell an empty project from an unread one either way.</para></summary>
    [Fact]
    public void A_pull_over_an_unreadable_folder_keeps_the_files_under_it()
    {
        var ide = ConnectedIde(FakeIde.Item.TextualPou("A", "PROGRAM A\nVAR\nEND_VAR", "x := 1;"),
                               FakeIde.Item.TextualPou("Deep", "PROGRAM Deep\nVAR\nEND_VAR", "y := 2;", "Machine"));
        var (root, host, client) = Bound(ide);
        try
        {
            Assert.Equal("ok", Commands.Pull(root, client).Kind);
            var deep = Path.Combine(root, "src", "Machine", "Deep.prg");
            Assert.True(File.Exists(deep), "the first pull did not write the item this test is about");

            // The engineer's IDE now refuses to enumerate that folder.
            ide.UnwalkableFolders = new[] { "Machine" };

            var again = Commands.Pull(root, client);

            Assert.Equal("ok", again.Kind);
            Assert.True(File.Exists(deep), "the pull DELETED an item it merely could not see");
            Assert.Empty(again.Status!.Incoming.Removed);
            Assert.Equal(new[] { "Machine" }, again.Status!.UnwalkedFolders);
        }
        finally { host.Dispose(); TestUtil.ForceDelete(root); }
    }

    /// <summary>And a genuinely EMPTY project still pulls. The old guard refused this outright — "refusing to
    /// treat an empty project as truth" — which is the right instinct applied to a signal that could not tell
    /// the two cases apart.</summary>
    [Fact]
    public void A_pull_from_an_empty_project_succeeds()
    {
        var (root, host, client) = Bound(ConnectedIde());
        try
        {
            var r = Commands.Pull(root, client);

            Assert.Equal("ok", r.Kind);
            Assert.Empty(r.Status!.UnwalkedFolders);
        }
        finally { host.Dispose(); TestUtil.ForceDelete(root); }
    }

    [Fact]
    public void Pull_refuses_outside_a_workspace()
    {
        var root = TestUtil.NewRepo();
        try
        {
            var r = Commands.Pull(root, new BridgeClient(Pipe()));
            Assert.Equal("refused", r.Kind);
            Assert.Contains("not a Volt workspace", r.Reason);
        }
        finally { TestUtil.ForceDelete(root); }
    }

    /// <summary>A PARTIAL PULL DOES NOT SHRINK THE SIDECAR.
    ///
    /// <para>`ReadResponse.UnwalkedFolders` says a client seeing it non-empty must conclude nothing from
    /// absence. Replacing the sidecar's item map with the partial one is exactly that conclusion, a layer past
    /// the `removed` list the bridge already suppressed — and the damage lands on the next PUSH, not here. With
    /// `Deep.prg` gone from the baseline, an edit to it has no known version and goes up as a CREATE, refused
    /// ITEM_EXISTS; a local delete is skipped by the guard lookup and reported as "nothing to push"; a rename
    /// throws "has no known IDE version" straight past `Commands.Push` to the top-level handler.</para></summary>
    [Fact]
    public void A_pull_over_an_unreadable_folder_keeps_the_baseline_entries_under_it()
    {
        var ide = ConnectedIde(FakeIde.Item.TextualPou("A", "PROGRAM A\nVAR\nEND_VAR", "x := 1;"),
                               FakeIde.Item.TextualPou("Deep", "PROGRAM Deep\nVAR\nEND_VAR", "y := 2;", "Machine"));
        var (root, host, client) = Bound(ide);
        try
        {
            Assert.Equal("ok", Commands.Pull(root, client).Kind);
            var before = Sidecar.LoadIdeRefs(root)!.Items;
            Assert.Contains("Deep.prg", before.Keys);

            ide.UnwalkableFolders = new[] { "Machine" };
            Assert.Equal("ok", Commands.Pull(root, client).Kind);

            var after = Sidecar.LoadIdeRefs(root)!.Items;
            Assert.Contains("Deep.prg", after.Keys);
            Assert.Equal(before["Deep.prg"], after["Deep.prg"]);   // at the version the last COMPLETE walk gave it

            // …and the push that would have broken now refuses for the RIGHT reason. With the baseline entry
            // dropped, the edit went up as a CREATE and collided (ITEM_EXISTS) — or, with the folder readable
            // again, silently relocated the item. Keeping the entry means the push quotes the real version,
            // the bridge finds the item absent from its own PARTIAL walk, and says so: the item is not gone,
            // the walk could not see it. Refusing is the right outcome; what changed is that it is legible.
            var file = Path.Combine(root, "src", "Machine", "Deep.prg");
            File.WriteAllText(file, File.ReadAllText(file).Replace("y := 2;", "y := 7;"));
            Git.CommitAll(root, "edit under the unreadable folder");

            var pushed = Commands.Push(root, client);
            Assert.Equal("rejected", pushed.Kind);
            Assert.Contains("ITEM_UNVERIFIED", pushed.Reason);

            // And once the folder reads again, the same push lands — nothing was poisoned.
            ide.UnwalkableFolders = new string[0];
            Assert.Equal("ok", Commands.Pull(root, client).Kind);
            Assert.Equal("ok", Commands.Push(root, client).Kind);
        }
        finally { host.Dispose(); TestUtil.ForceDelete(root); }
    }

    /// <summary>…BUT A PARTIAL PULL STILL RETIRES WHAT IT SAW GONE FROM A FOLDER IT READ — in the files AND the
    /// baseline, together.
    ///
    /// <para>The overlay above once dropped a baseline name absent from a folder the walk DID read while the
    /// bridge's `removed` was empty for any partial walk. The two disagreed: the name left `ide-refs.json` while
    /// its file was carried forward in `volt/ide`. No later pull could ever report it removed — a complete walk
    /// is only asked about names the baseline still holds — so the file stayed for good, status read in sync,
    /// and its next edit went up as a create of an item the IDE had deleted.</para></summary>
    [Fact]
    public void A_pull_over_an_unreadable_folder_retires_an_item_deleted_from_a_folder_it_read()
    {
        var ide = ConnectedIde(FakeIde.Item.TextualPou("A", "PROGRAM A\nVAR\nEND_VAR", "x := 1;"),
                               FakeIde.Item.TextualPou("FB_Gone", "FUNCTION_BLOCK FB_Gone\nVAR\nEND_VAR", "", "POUs"),
                               FakeIde.Item.TextualPou("Deep", "PROGRAM Deep\nVAR\nEND_VAR", "y := 2;", "Machine"));
        var (root, host, client) = Bound(ide);
        try
        {
            Assert.Equal("ok", Commands.Pull(root, client).Kind);
            var gone = Path.Combine(root, "src", "POUs", "FB_Gone.fb");
            var deep = Path.Combine(root, "src", "Machine", "Deep.prg");
            Assert.True(File.Exists(gone), "the first pull did not write the item this test is about");

            ide.RemoveItem("FB_Gone");
            ide.UnwalkableFolders = new[] { "Machine" };
            var partial = Commands.Pull(root, client);

            Assert.Equal("ok", partial.Kind);
            Assert.False(File.Exists(gone), "a partial pull kept the file of an item deleted from a folder it read");
            Assert.DoesNotContain("FB_Gone.fb", Sidecar.LoadIdeRefs(root)!.Items.Keys);
            Assert.True(File.Exists(deep), "the pull DELETED an item it merely could not see");
            Assert.Contains("FB_Gone.fb", partial.Synced!);

            ide.UnwalkableFolders = new string[0];
            Assert.Equal("ok", Commands.Pull(root, client).Kind);
            Assert.False(File.Exists(gone));
            Assert.True(File.Exists(deep));
            Assert.Equal("in sync with the IDE", Commands.Status(root, client).Summary);
        }
        finally { host.Dispose(); TestUtil.ForceDelete(root); }
    }

    /// <summary>The same hole, reached by a DUT whose subtype the IDE changed during a partial walk: the IDE now
    /// publishes `X.enum`, and `X.struct` is a removed name like any other. Its file must go with it — left
    /// behind, an edit to it was refused ITEM_EXISTS forever and `volt push --force` wrote the stale STRUCT over
    /// the IDE's live ENUM.</summary>
    [Fact]
    public void A_pull_over_an_unreadable_folder_retires_the_old_name_of_a_dut_whose_subtype_changed()
    {
        var ide = ConnectedIde(Prg(),
            FakeIde.Item.TextualPou("X", "TYPE X :\nSTRUCT\n\ta : INT;\nEND_STRUCT\nEND_TYPE", "", "DUTs"),
            FakeIde.Item.TextualPou("Deep", "PROGRAM Deep\nVAR\nEND_VAR", "y := 2;", "Machine"));
        var (root, host, client) = Bound(ide);
        try
        {
            Assert.Equal("ok", Commands.Pull(root, client).Kind);
            var structFile = Path.Combine(root, "src", "DUTs", "X.struct");
            var enumFile = Path.Combine(root, "src", "DUTs", "X.enum");
            Assert.True(File.Exists(structFile));

            ide.RemoveItem("X");
            ide.AddItem(FakeIde.Item.TextualPou("X", "TYPE X :\n(\n\tA := 0,\n\tB\n);\nEND_TYPE", "", "DUTs"));
            ide.UnwalkableFolders = new[] { "Machine" };
            Assert.Equal("ok", Commands.Pull(root, client).Kind);

            Assert.True(File.Exists(enumFile));
            Assert.False(File.Exists(structFile), "the DUT's old subtype file survived beside its new one");

            ide.UnwalkableFolders = new string[0];
            Assert.Equal("ok", Commands.Pull(root, client).Kind);
            Assert.False(File.Exists(structFile));
            Assert.Equal("in sync with the IDE", Commands.Status(root, client).Summary);
        }
        finally { host.Dispose(); TestUtil.ForceDelete(root); }
    }

    /// <summary>…and when the unread folder is the one the OLD name last sat in. The IDE retyped `X` and moved it
    /// out of `Old`, and `Old` now faults. Absence under an unread folder proves nothing — but this walk did not
    /// merely miss `X`: it found the one object under its new name, `X.enum`. Two files for one IDE object is what
    /// the spec forbids, and the stale `X.struct` could be force-pushed over the live enum.</summary>
    [Fact]
    public void A_pull_retires_the_old_subtype_name_even_when_its_own_folder_went_unread()
    {
        var ide = ConnectedIde(Prg(),
            FakeIde.Item.TextualPou("X", "TYPE X :\nSTRUCT\n\ta : INT;\nEND_STRUCT\nEND_TYPE", "", "Old"));
        var (root, host, client) = Bound(ide);
        try
        {
            Assert.Equal("ok", Commands.Pull(root, client).Kind);
            var structFile = Path.Combine(root, "src", "Old", "X.struct");
            var enumFile = Path.Combine(root, "src", "DUTs", "X.enum");
            Assert.True(File.Exists(structFile));

            ide.RemoveItem("X");
            ide.AddItem(FakeIde.Item.TextualPou("X", "TYPE X :\n(\n\tA := 0,\n\tB\n);\nEND_TYPE", "", "DUTs"));
            ide.UnwalkableFolders = new[] { "Old" };
            Assert.Equal("ok", Commands.Pull(root, client).Kind);

            Assert.True(File.Exists(enumFile));
            Assert.False(File.Exists(structFile), "the DUT's old subtype file survived beside its new one");
            Assert.DoesNotContain("X.struct", Sidecar.LoadIdeRefs(root)!.Items.Keys);
        }
        finally { host.Dispose(); TestUtil.ForceDelete(root); }
    }

    /// <summary>STATUS AND PULL GIVE ONE ANSWER over a partial walk. `volt status` said nothing was removed while
    /// `volt pull` retired the item — and `volt pull --dry-run` listed it in `synced` beside a post-status that
    /// did not. What pull would bring in and what status reports incoming are the same set.</summary>
    [Fact]
    public void Status_over_a_partial_walk_reports_the_removal_pull_makes()
    {
        var ide = ConnectedIde(FakeIde.Item.TextualPou("A", "PROGRAM A\nVAR\nEND_VAR", "x := 1;"),
                               FakeIde.Item.TextualPou("FB_Gone", "FUNCTION_BLOCK FB_Gone\nVAR\nEND_VAR", "", "POUs"),
                               FakeIde.Item.TextualPou("Deep", "PROGRAM Deep\nVAR\nEND_VAR", "y := 2;", "Machine"));
        var (root, host, client) = Bound(ide);
        try
        {
            Assert.Equal("ok", Commands.Pull(root, client).Kind);
            ide.RemoveItem("FB_Gone");
            ide.UnwalkableFolders = new[] { "Machine" };

            var status = Commands.Status(root, client).Incoming;
            var dry = Commands.Pull(root, client, dryRun: true);

            Assert.Equal(new[] { "FB_Gone.fb" }, status.Removed);
            Assert.Equal(dry.Synced, status.Added.Concat(status.Modified).Concat(status.Removed).OrderBy(x => x, System.StringComparer.Ordinal));
            Assert.Equal(new[] { "FB_Gone.fb" }, dry.Status!.Incoming.Removed);
        }
        finally { host.Dispose(); TestUtil.ForceDelete(root); }
    }

    /// <summary>ONE KIND-AWARE RULE decides removal on a partial walk too. The IDE deleted the DUT `X` and now
    /// holds an unreadable PROGRAM `X` — another item of the same bare name. A rule keyed by bare name kept the
    /// DUT's file (and its baseline entry) for as long as a folder kept faulting: the same shielding the complete
    /// walk's kind check already refuses. (FakeIde resolves a read by bare name, so it cannot hold both at once;
    /// the program arriving as the DUT leaves is the same wire answer — `unreadable: [X]`, no `X.struct`.)</summary>
    [Fact]
    public void A_partial_pull_retires_a_deleted_dut_beside_an_unreadable_item_of_its_name()
    {
        var ide = ConnectedIde(Prg(),
            FakeIde.Item.TextualPou("X", "TYPE X :\nSTRUCT\n\ta : INT;\nEND_STRUCT\nEND_TYPE", "", "DUTs"),
            FakeIde.Item.TextualPou("Deep", "PROGRAM Deep\nVAR\nEND_VAR", "y := 2;", "Machine"));
        var (root, host, client) = Bound(ide);
        try
        {
            Assert.Equal("ok", Commands.Pull(root, client).Kind);
            var dut = Path.Combine(root, "src", "DUTs", "X.struct");
            Assert.True(File.Exists(dut), "fixture: the first pull wrote the DUT");

            ide.RemoveItem("X");
            ide.AddItem(FakeIde.Item.MalformedGraphical("X", "POUs"));
            ide.UnwalkableFolders = new[] { "Machine" };
            Assert.Equal("ok", Commands.Pull(root, client).Kind);

            Assert.False(File.Exists(dut), "the deleted DUT survived, shielded by the unreadable item's bare name");
            Assert.DoesNotContain("X.struct", Sidecar.LoadIdeRefs(root)!.Items.Keys);
            Assert.True(File.Exists(Path.Combine(root, "src", "Machine", "Deep.prg")), "the pull deleted an unseen item");
        }
        finally { host.Dispose(); TestUtil.ForceDelete(root); }
    }

    /// <summary>…and an item the partial walk FOUND but could not read is not gone: its file stays, exactly as a
    /// complete walk leaves it (the bridge exempts it from `removed`).</summary>
    [Fact]
    public void A_pull_over_an_unreadable_folder_keeps_an_item_it_found_and_could_not_read()
    {
        var ide = ConnectedIde(FakeIde.Item.TextualPou("A", "PROGRAM A\nVAR\nEND_VAR", "x := 1;"),
                               FakeIde.Item.TextualPou("Y", "PROGRAM Y\nVAR\nEND_VAR", "z := 3;", "POUs"),
                               FakeIde.Item.TextualPou("Deep", "PROGRAM Deep\nVAR\nEND_VAR", "y := 2;", "Machine"));
        var (root, host, client) = Bound(ide);
        try
        {
            Assert.Equal("ok", Commands.Pull(root, client).Kind);
            var y = Path.Combine(root, "src", "POUs", "Y.prg");
            Assert.True(File.Exists(y));

            ide.RemoveItem("Y");
            ide.AddItem(FakeIde.Item.MalformedGraphical("Y", "POUs"));
            ide.UnwalkableFolders = new[] { "Machine" };
            Assert.Equal("ok", Commands.Pull(root, client).Kind);

            Assert.True(File.Exists(y), "the pull DELETED an item it found and could not read");
        }
        finally { host.Dispose(); TestUtil.ForceDelete(root); }
    }

    /// <summary>A PULL REPAIRS A MISSING `volt/ide`, rather than declaring victory over it.
    ///
    /// <para>The up-to-date short-circuit is keyed on the SIDECAR alone, and the two halves of the baseline are
    /// written as two separate operations with no recovery between them. A workspace whose ref never landed — a
    /// crash in that gap, a `.git` restored without it — has a current sidecar and no ref, so every pull said
    /// "already up to date with the IDE" and returned, while `Outgoing` is diffed against the ref that is not
    /// there. Nothing ever rebuilt it.</para></summary>
    /// <summary>A body network text cannot represent pulls as <c>IMPLEMENTATION LD|FBD UNSUPPORTED</c>, and the file says
    /// no more than that (openspec <c>implementation-keyword</c> 2b). The REASON left the file with the old
    /// <c>(* @volt-graphical: … *)</c> comment, so the pull message is where the engineer learns it: every such body the
    /// pull brought in, by file and member, with what network text has no spelling for.</summary>
    [Fact]
    public void A_pull_names_every_UNSUPPORTED_body_and_its_reason()
    {
        var ide = ConnectedIde(
            new FakeIde.Item("FB_Motor", ItemKind.PlcPouFb, "POUs", true, "FUNCTION_BLOCK FB_Motor\nVAR\nEND_VAR", "",
                             "LD", null, new[] { "Reset", "Chart" }, Unsupported: "a vendor split point"),
            new FakeIde.Item("Reset", ItemKind.PlcMethod, "", false, "METHOD Reset : BOOL", "", "FBD", null,
                             Unsupported: "an ENO output wired to a variable"),
            new FakeIde.Item("Chart", ItemKind.PlcMethod, "", false, "METHOD Chart : BOOL", "", "CFC", null),
            Prg());
        var (root, host, client) = Bound(ide);
        try
        {
            var r = Commands.Pull(root, client);

            Assert.Equal("ok", r.Kind);
            var message = r.Message ?? "";
            Assert.Contains("POUs/FB_Motor.fb", message);
            Assert.Contains("a vendor split point", message);
            Assert.Contains("'Reset'", message);
            Assert.Contains("an ENO output wired to a variable", message);
            Assert.DoesNotContain("'Chart'", message);          // CFC is a language Volt does not read, not a shape
            Assert.DoesNotContain("PLC_PRG", message);

            var file = File.ReadAllText(Path.Combine(root, "src", "POUs", "FB_Motor.fb"));
            Assert.Contains("IMPLEMENTATION LD UNSUPPORTED", file);
            Assert.DoesNotContain("a vendor split point", file);
        }
        finally { host.Dispose(); TestUtil.ForceDelete(root); }
    }

    /// <summary>The message states each body's OWN reason and asserts no other. Found by a live pull of pro2193 through a
    /// bridge without <c>VOLT_GRAPHICAL=1</c>: every LD/FBD body came back hidden for the switch's reason, and the note
    /// told the engineer it was "because network text has no spelling for what they hold yet" — a claim about the bodies
    /// that was false for every one of them.</summary>
    [Fact]
    public void A_pull_with_network_text_off_names_the_switch_and_claims_no_unspellable_shape()
    {
        var ide = ConnectedIde(
            new FakeIde.Item("FB_Motor", ItemKind.PlcPouFb, "POUs", true, "FUNCTION_BLOCK FB_Motor\nVAR\nEND_VAR", "",
                             "LD", null, Unsupported: NetworkTextSwitch.DisabledReason),
            Prg());
        var (root, host, client) = Bound(ide);
        try
        {
            var r = Commands.Pull(root, client);

            Assert.Equal("ok", r.Kind);
            var message = r.Message ?? "";
            Assert.Contains($"POUs/FB_Motor.fb (LD): {NetworkTextSwitch.DisabledReason}", message);
            Assert.DoesNotContain("no spelling", message);
        }
        finally { host.Dispose(); TestUtil.ForceDelete(root); }
    }

    [Fact]
    public void A_pull_with_no_UNSUPPORTED_body_says_nothing_about_one()
    {
        var ide = ConnectedIde(Prg());
        var (root, host, client) = Bound(ide);
        try
        {
            var r = Commands.Pull(root, client);

            Assert.Equal("ok", r.Kind);
            Assert.Null(r.Message);                             // the plain "pulled N file(s)" line
        }
        finally { host.Dispose(); TestUtil.ForceDelete(root); }
    }

    [Fact]
    public void A_pull_rebuilds_the_ide_ref_when_it_is_missing()
    {
        var ide = ConnectedIde(FakeIde.Item.TextualPou("A", "PROGRAM A\nVAR\nEND_VAR", "x := 1;"));
        var (root, host, client) = Bound(ide);
        try
        {
            Assert.Equal("ok", Commands.Pull(root, client).Kind);
            var gitDir = Git.ResolveGitDir(root);
            Assert.NotNull(IdeTree.VoltIdeHead(gitDir));

            // The ref is lost; the sidecar still says the workspace matches the IDE. Deleted through the
            // filesystem rather than a `Git.DeleteRef` helper — nothing in the product deletes this ref, and
            // adding a production method for one test is what `NoTestOnlyCodeInSrcTests` exists to catch.
            var loose = Path.Combine(gitDir, IdeTree.Range.Replace('/', Path.DirectorySeparatorChar));
            if (File.Exists(loose)) File.Delete(loose);
            var packed = Path.Combine(gitDir, "packed-refs");
            if (File.Exists(packed))
                File.WriteAllLines(packed, File.ReadAllLines(packed).Where(l => !l.Contains(IdeTree.Range)));
            Assert.Null(IdeTree.VoltIdeHead(gitDir));

            Assert.Equal("ok", Commands.Pull(root, client).Kind);

            Assert.NotNull(IdeTree.VoltIdeHead(gitDir));
        }
        finally { host.Dispose(); TestUtil.ForceDelete(root); }
    }
}
