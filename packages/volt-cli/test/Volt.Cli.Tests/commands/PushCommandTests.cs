using System.IO;
using System.Linq;
using Volt.Cli.Sync;
using Xunit;
using static Volt.Cli.Tests.CommandHarness;

namespace Volt.Cli.Tests;

/// <summary>`volt push` at the CLI layer — every situation a user can hit, asserting the Kind + the exact
/// user-facing Message/Reason. The transport layer (PushServiceTests / push.test.ts) proves the conflict
/// MECHANISM; this file proves what the CLI reports when it fires.</summary>
public class PushCommandTests
{
    private static FakeIde.Item Prg(string impl = "x := 1;") =>
        FakeIde.Item.TextualPou("PLC_PRG", "PROGRAM PLC_PRG\nVAR\nEND_VAR", impl);

    private static void EditPrg(string root, string from, string to)
    {
        var path = Path.Combine(root, "src", "PLC_PRG.pou");
        File.WriteAllText(path, File.ReadAllText(path).Replace(from, to));
    }

    [Fact]
    public void Push_sends_a_local_edit_then_reports_nothing_to_push()
    {
        var ide = ConnectedIde(Prg());
        var (root, host, client) = Bound(ide);
        try
        {
            Commands.Pull(root, client); // seed the baseline
            EditPrg(root, "x := 1;", "x := 2;"); // a VALID ST edit — the bridge parses on apply

            var r = Commands.Push(root, client);
            Assert.True(r.Kind == "ok", $"push rejected: {r.Reason}");
            Assert.Contains("PLC_PRG.pou", r.Items!);
            Assert.Contains(ide.Recorded, x => x.StartsWith("writecontent:PLC_PRG"));

            Assert.Equal(0, Commands.Status(root, client).Outgoing.Count);
            // Nothing left to push — the ok/empty path with its own message (what volt-control now surfaces).
            Assert.Equal("nothing to push — the IDE already matches your workspace", Commands.Push(root, client).Message);
        }
        finally { host.Dispose(); TestUtil.ForceDelete(root); }
    }

    /// <summary>Spec (implementation-keyword 3b), "the declaration of a hidden body is edited" and "nothing in the IDE is
    /// overwritten", end to end through the CLI: a project holding a CFC POU and a POU whose method is an LD body network
    /// text cannot represent pulls with both as <c>IMPLEMENTATION … UNSUPPORTED</c>; each gains a <c>VAR_INPUT</c>; the
    /// push is NOT blocked, both declarations land, the bodies the IDE holds are untouched, and the workspace is in sync
    /// afterwards.</summary>
    [Fact]
    public void Editing_the_declarations_of_hidden_bodies_pushes_them_and_never_writes_a_body()
    {
        const string chart = "<the IDE's own CFC chart>";
        const string ladder = "<the IDE's own ladder>";
        var ide = ConnectedIde(
            new FakeIde.Item("FB_Chart", Volt.Engine.Item.ItemKind.PlcPou, "", true,
                             "FUNCTION_BLOCK FB_Chart\nVAR\nEND_VAR", chart, "CFC", null),
            new FakeIde.Item("FB_Motor", Volt.Engine.Item.ItemKind.PlcPou, "", true,
                             "FUNCTION_BLOCK FB_Motor\nVAR\nEND_VAR", "", null, null, new[] { "Reset" }),
            new FakeIde.Item("Reset", Volt.Engine.Item.ItemKind.PlcMethod, "", false, "METHOD Reset : BOOL", ladder, "LD",
                             null, Unsupported: "a vendor split point"),
            Prg());
        var (root, host, client) = Bound(ide);
        try
        {
            Assert.Equal("ok", Commands.Pull(root, client).Kind);
            var chartFile = Path.Combine(root, "src", "FB_Chart.pou");
            var motorFile = Path.Combine(root, "src", "FB_Motor.pou");
            Assert.Contains("IMPLEMENTATION CFC UNSUPPORTED", File.ReadAllText(chartFile));
            Assert.Contains("IMPLEMENTATION LD UNSUPPORTED", File.ReadAllText(motorFile));
            File.WriteAllText(chartFile, File.ReadAllText(chartFile)
                .Replace("FUNCTION_BLOCK FB_Chart\n", "FUNCTION_BLOCK FB_Chart\nVAR_INPUT\n\tbStart : BOOL;\nEND_VAR\n"));
            File.WriteAllText(motorFile, File.ReadAllText(motorFile)
                .Replace("METHOD Reset : BOOL\n", "METHOD Reset : BOOL\nVAR_INPUT\n\tbForce : BOOL;\nEND_VAR\n"));

            var r = Commands.Push(root, client);

            Assert.True(r.Kind == "ok", $"push rejected: {r.Reason}");
            Assert.Contains("bStart : BOOL;", ide.ReadContent(new Volt.Engine.Item.ItemRef("FB_Chart")).Declaration);
            Assert.Contains("bForce : BOOL;", ide.ReadContent(new Volt.Engine.Item.ItemRef("FB_Motor")).Members.Single().Declaration);
            Assert.Equal(chart, ide.StoredImplementation("FB_Chart"));
            Assert.Equal(ladder, ide.StoredImplementation("Reset"));
            Assert.Equal(0, Commands.Status(root, client).Outgoing.Count);
            Assert.Equal("ok", Commands.Pull(root, client).Kind);   // and the next pull is not blocked either
        }
        finally { host.Dispose(); TestUtil.ForceDelete(root); }
    }

    /// <summary>Spec, "a hand layout does not come back as an IDE change" (task 3.8). Network text is compared by
    /// TOKENS, so an engineer may lay out a call one pin per line and the push is accepted; the IDE then holds the
    /// MODEL and materializes it in the canonical layout. The CLI records that text as <c>volt/ide</c> and brings the
    /// working tree to it — so the next pull reports nothing, the workspace holds the canonical layout, and nothing
    /// is outgoing.</summary>
    [Fact]
    public void A_hand_wrapped_graphical_call_is_adopted_in_the_IDEs_layout_after_the_push()
    {
        const string canonical = "IMPLEMENTATION LD\nNETWORK\n  t1(IN := a, PT := pt);\nEND_NETWORK";
        var ide = ConnectedIde(new FakeIde.Item("PLC_PRG", Volt.Engine.Item.ItemKind.PlcPou, "", true,
            "PROGRAM PLC_PRG\nVAR\n  t1 : TON;\n  a : BOOL;\n  pt : TIME;\nEND_VAR", canonical, "LD", null));
        var (root, host, client) = Bound(ide);
        try
        {
            Commands.Pull(root, client);
            var path = Path.Combine(root, "src", "PLC_PRG.pou");
            var pulled = File.ReadAllText(path).Replace("\r\n", "\n");
            Assert.Contains(canonical, pulled);

            // The same call, one pin per line: token-identical, so the gate accepts it.
            File.WriteAllText(path, pulled.Replace("  t1(IN := a, PT := pt);", "  t1(\n    IN := a,\n    PT := pt\n  );"));
            var r = Commands.Push(root, client);
            Assert.True(r.Kind == "ok", $"push rejected: {r.Reason}");

            // The working tree holds the IDE's layout, the next pull brings nothing, and nothing is outgoing.
            Assert.Equal(pulled, File.ReadAllText(path).Replace("\r\n", "\n"));
            var again = Commands.Pull(root, client);
            Assert.Equal("ok", again.Kind);
            Assert.Empty(again.Synced!);
            Assert.Equal("already up to date with the IDE", again.Message);
            Assert.Equal(0, Commands.Status(root, client).Outgoing.Count);
            Assert.Equal("nothing to push — the IDE already matches your workspace", Commands.Push(root, client).Message);
        }
        finally { host.Dispose(); TestUtil.ForceDelete(root); }
    }

    /// <summary>…and ONLY a layout is adopted. An IDE that holds the pushed body as other TOKENS (here it dropped the
    /// <c>PT</c> pin) changed the program, and that is an IDE-side change the engineer must see: the working tree keeps
    /// what was pushed, the push says which item the IDE holds otherwise, and the next pull brings the IDE's text in as
    /// the change it is. Adopting it merged a semantic difference into the working tree under a layout commit, and
    /// the next pull said "already up to date".</summary>
    [Fact]
    public void A_pushed_body_the_IDE_holds_as_other_tokens_is_not_adopted_as_a_layout()
    {
        const string canonical = "IMPLEMENTATION LD\nNETWORK\n  t1(IN := a, PT := pt);\nEND_NETWORK";
        var ide = new FakeIde(new FakeIde.Item("PLC_PRG", Volt.Engine.Item.ItemKind.PlcPou, "", true,
            "PROGRAM PLC_PRG\nVAR\n  t1 : TON;\n  a : BOOL;\n  pt : TIME;\n  b : BOOL;\nEND_VAR", canonical, "LD", null))
        {
            HealthConnected = true, HealthPlatform = "codesys", HealthProjectName = "Demo",
            RematerializeAs = held => held.Replace(", PT := pt", ""),
        };
        var (root, host, client) = Bound(ide);
        try
        {
            Commands.Pull(root, client);
            var path = Path.Combine(root, "src", "PLC_PRG.pou");
            var pulled = File.ReadAllText(path).Replace("\r\n", "\n");
            var edited = pulled.Replace("t1(IN := a, PT := pt);", "t1(IN := b, PT := pt);");
            File.WriteAllText(path, edited);

            var r = Commands.Push(root, client);

            Assert.True(r.Kind == "ok", $"push rejected: {r.Reason}");
            Assert.Equal(edited, File.ReadAllText(path).Replace("\r\n", "\n"));
            Assert.Contains("PLC_PRG.pou", r.Message);
            var again = Commands.Pull(root, client);
            Assert.Equal("ok", again.Kind);
            Assert.Contains("PLC_PRG.pou", again.Synced!);
            Assert.Contains("t1(IN := b);", File.ReadAllText(path).Replace("\r\n", "\n"));
        }
        finally { host.Dispose(); TestUtil.ForceDelete(root); }
    }

    /// <summary>A pushed item whose version says the IDE holds other text, but whose text the directed fetch does not
    /// give back, was never COMPARED — so it must not be reported as "held as another program". It used to be filed
    /// there by default: a missing fact turned into a claim about the IDE's program. It is named as what it is — its
    /// text did not come back — and the baseline keeps the pushed version, so the next pull fetches it.</summary>
    [Fact]
    public void A_pushed_item_whose_text_the_IDE_does_not_give_back_is_not_claimed_as_another_program()
    {
        const string canonical = "IMPLEMENTATION LD\nNETWORK\n  t1(IN := a, PT := pt);\nEND_NETWORK";
        var ide = new FakeIde(new FakeIde.Item("PLC_PRG", Volt.Engine.Item.ItemKind.PlcPou, "", true,
            "PROGRAM PLC_PRG\nVAR\n  t1 : TON;\n  a : BOOL;\n  pt : TIME;\n  b : BOOL;\nEND_VAR", canonical, "LD", null))
        {
            HealthConnected = true, HealthPlatform = "codesys", HealthProjectName = "Demo",
            RematerializeAs = held => held.Replace(", PT := pt", ""),
        };
        var (root, host, client) = Bound(ide);
        try
        {
            Commands.Pull(root, client);
            var path = Path.Combine(root, "src", "PLC_PRG.pou");
            var edited = File.ReadAllText(path).Replace("\r\n", "\n").Replace("t1(IN := a, PT := pt);", "t1(IN := b, PT := pt);");
            File.WriteAllText(path, edited);
            // The receipt's walk reads the item once after the write and hashes what the IDE holds; the directed
            // fetch that follows cannot read it back.
            var readsAfterWrite = 0;
            ide.OnReadContent = (fake, item) =>
            {
                if (fake.Recorded.Contains("writecontent:PLC_PRG") && fake.Name(item) == "PLC_PRG" && ++readsAfterWrite > 1)
                    throw new System.InvalidOperationException("'PLC_PRG': the body cannot be read");
            };

            var r = Commands.Push(root, client);

            Assert.True(r.Kind == "ok", $"push rejected: {r.Reason}");
            Assert.NotNull(r.Message);
            Assert.DoesNotContain("another program", r.Message);
            Assert.Contains("PLC_PRG.pou", r.Message);
            Assert.Equal(edited, File.ReadAllText(path).Replace("\r\n", "\n"));
        }
        finally { host.Dispose(); TestUtil.ForceDelete(root); }
    }

    /// <summary>A `.task` is a DESCRIPTOR, not ST, and the post-push comparison must read it as one. Its gate ignores
    /// trailing whitespace, so a pushed descriptor can be accepted as canonical while its bytes — and so its version —
    /// differ from what the IDE holds. The comparison used to hand it to the ST reader, which threw "Unrecognized code
    /// header" AFTER the IDE had applied the push and BEFORE volt/ide and the baseline were written: an accepted push
    /// crashed the CLI and left both behind the IDE. The IDE holds the same descriptor laid out canonically, so it is
    /// adopted like any other layout.</summary>
    [Fact]
    public void A_pushed_task_the_IDE_holds_in_its_canonical_layout_is_adopted()
    {
        var canonical = Volt.Engine.Format.Task.TaskDescriptorFormat.Write(new Volt.Engine.Format.Task.TaskSettings(
            "cyclic", "t#10ms", "", "1", null, null, new[] { "PLC_PRG" }));
        var ide = ConnectedIde(Prg(),
            new FakeIde.Item("MainTask", Volt.Engine.Item.ItemKind.PlcTask, "", true, canonical, null, null, null));
        var (root, host, client) = Bound(ide);
        try
        {
            Commands.Pull(root, client);
            var path = Directory.GetFiles(root, "MainTask.task", SearchOption.AllDirectories).Single();
            var pulled = File.ReadAllText(path).Replace("\r\n", "\n");
            Assert.Equal(canonical, pulled);
            File.WriteAllText(path, pulled.TrimEnd('\n') + "   \n");

            var r = Commands.Push(root, client);

            Assert.True(r.Kind == "ok", $"push rejected: {r.Reason}");
            Assert.Contains("writetask:MainTask", ide.Recorded);
            Assert.Null(r.Message);
            Assert.Equal(canonical, File.ReadAllText(path).Replace("\r\n", "\n"));
            var again = Commands.Pull(root, client);
            Assert.Equal("already up to date with the IDE", again.Message);
            Assert.Equal(0, Commands.Status(root, client).Outgoing.Count);
        }
        finally { host.Dispose(); TestUtil.ForceDelete(root); }
    }

    /// <summary>A workspace file saved with a UTF-8 BOM still pushes. Visual Studio and TcXaeShell write UTF-8
    /// WITH a BOM by default on Windows, so any user who opens a `.prg` there and saves gets one — and the BOM
    /// sits in front of the header keyword, where `.Trim()` does not remove it (U+FEFF is not whitespace under
    /// .NET Core). The push was rejected with `Unrecognized code header: PROGRAM PLC_PRG` — an error that reads
    /// as self-contradictory, because the character it is complaining about is invisible. Found by hand while
    /// driving a live TwinCAT bridge.</summary>
    [Fact]
    public void Push_accepts_a_file_saved_with_a_utf8_BOM()
    {
        var ide = ConnectedIde(Prg());
        var (root, host, client) = Bound(ide);
        try
        {
            Commands.Pull(root, client);
            var path = Path.Combine(root, "src", "PLC_PRG.pou");
            // Exactly what an editor's "UTF-8 with signature" save produces: EF BB BF, then the unchanged text.
            File.WriteAllText(path, File.ReadAllText(path).Replace("x := 1;", "x := 2;"),
                new System.Text.UTF8Encoding(encoderShouldEmitUTF8Identifier: true));

            var r = Commands.Push(root, client);
            Assert.True(r.Kind == "ok", $"push rejected: {r.Reason}");
            Assert.Contains(ide.Recorded, x => x.StartsWith("writecontent:PLC_PRG"));
        }
        finally { host.Dispose(); TestUtil.ForceDelete(root); }
    }

    [Fact]
    public void Push_is_rejected_when_the_IDE_changed_since_the_last_sync()
    {
        var ide = ConnectedIde(Prg());
        var (root, host, client) = Bound(ide);
        try
        {
            Commands.Pull(root, client); // baseline @ projectVersion V1
            ide.MutateImplementation("PLC_PRG", "x := 99;"); // the engineer edits it in the IDE → V2
            EditPrg(root, "x := 1;", "x := 2;"); // our own conflicting local edit

            var r = Commands.Push(root, client);
            Assert.Equal("rejected", r.Kind);
            Assert.Equal("the IDE changed since your last sync — run `volt pull` first (or push --force)", r.Reason);
            Assert.DoesNotContain(ide.Recorded, x => x.StartsWith("writecontent:")); // nothing applied
        }
        finally { host.Dispose(); TestUtil.ForceDelete(root); }
    }

    [Fact]
    public void Push_force_overrides_a_diverged_IDE()
    {
        var ide = ConnectedIde(Prg());
        var (root, host, client) = Bound(ide);
        try
        {
            Commands.Pull(root, client);
            ide.MutateImplementation("PLC_PRG", "x := 99;"); // IDE moved on
            EditPrg(root, "x := 1;", "x := 2;");

            var r = Commands.Push(root, client, force: true);
            Assert.True(r.Kind == "ok", $"forced push rejected: {r.Reason}");
            Assert.Contains(ide.Recorded, x => x.StartsWith("writecontent:PLC_PRG")); // applied despite divergence
        }
        finally { host.Dispose(); TestUtil.ForceDelete(root); }
    }

    [Fact]
    public void Push_force_with_lease_that_is_stale_is_rejected_with_the_current_version()
    {
        var ide = ConnectedIde(Prg());
        var (root, host, client) = Bound(ide);
        try
        {
            Commands.Pull(root, client);
            EditPrg(root, "x := 1;", "x := 2;"); // an op to push, so we reach the bridge

            var r = Commands.Push(root, client, forceWithLease: "bogus-version");
            Assert.Equal("rejected", r.Kind);
            Assert.StartsWith("--force-with-lease is stale:", r.Reason);
            Assert.Contains("not bogus-version", r.Reason);
            Assert.DoesNotContain(ide.Recorded, x => x.StartsWith("writecontent:"));
        }
        finally { host.Dispose(); TestUtil.ForceDelete(root); }
    }

    [Fact]
    public void Push_force_with_lease_that_matches_the_current_version_applies()
    {
        var ide = ConnectedIde(Prg());
        var (root, host, client) = Bound(ide);
        try
        {
            Commands.Pull(root, client);
            ide.MutateImplementation("PLC_PRG", "x := 99;"); // IDE moved on → a NEW current projectVersion
            var current = client.GetRefs().ProjectVersion; // the lease the engineer would read after `volt status`
            EditPrg(root, "x := 1;", "x := 2;");

            var r = Commands.Push(root, client, forceWithLease: current);
            Assert.True(r.Kind == "ok", $"lease-matched push rejected: {r.Reason}");
            Assert.Contains(ide.Recorded, x => x.StartsWith("writecontent:PLC_PRG"));
        }
        finally { host.Dispose(); TestUtil.ForceDelete(root); }
    }

    [Fact]
    public void Push_dry_run_previews_without_touching_the_IDE()
    {
        var ide = ConnectedIde(Prg());
        var (root, host, client) = Bound(ide);
        try
        {
            Commands.Pull(root, client);
            EditPrg(root, "x := 1;", "x := 2;");

            var r = Commands.Push(root, client, dryRun: true);
            Assert.Equal("ok", r.Kind);
            Assert.Equal("dry run — would push these item(s)", r.Message);
            Assert.Contains("PLC_PRG.pou", r.Items!);
            Assert.Empty(ide.Recorded); // the bridge was never called
        }
        finally { host.Dispose(); TestUtil.ForceDelete(root); }
    }

    [Fact]
    public void Push_rejects_an_unrecognized_file_extension()
    {
        var ide = ConnectedIde(Prg());
        var (root, host, client) = Bound(ide);
        try
        {
            Commands.Pull(root, client);
            File.WriteAllText(Path.Combine(root, "src", "notes.txt"), "not a PLC item");

            var r = Commands.Push(root, client);
            Assert.Equal("rejected", r.Kind);
            Assert.Contains("unrecognized file extension", r.Reason);
            Assert.Contains("notes.txt", r.Reason);
        }
        finally { host.Dispose(); TestUtil.ForceDelete(root); }
    }

    /// <summary>A FILE NAME IS A WIRE NAME, EXTENSION CASE INCLUDED. The wire publishes `E_Mode.dut`; a file
    /// `E_Mode.Dut` was accepted as the same kind (the extension lookup ignored case) and pushed under its own
    /// spelling, so the receipt, the baseline and every later fetch named it `E_Mode.dut` while the file said
    /// `E_Mode.Dut`. Every name-keyed comparison after that (the pull's removal sweep, the push's version guard)
    /// missed it: a later edit was refused as a create beside itself, and a DUT deleted in the IDE kept its file,
    /// which the next push recreated. Refused by name BEFORE anything is committed or sent — there is no canonical
    /// spelling to fold it into without guessing, so the engineer renames it.</summary>
    [Theory]
    [InlineData("DUTs/E_Mode.Dut", "TYPE E_Mode : (Idle, Run);\nEND_TYPE\n")]
    [InlineData("POUs/FB_New.FB", "FUNCTION_BLOCK FB_New\nVAR\nEND_VAR\n")]
    public void Push_rejects_a_kind_extension_spelt_in_another_case(string rel, string text)
    {
        var ide = ConnectedIde(Prg());
        var (root, host, client) = Bound(ide);
        try
        {
            Commands.Pull(root, client);
            var path = Path.Combine(root, "src", rel);
            Directory.CreateDirectory(Path.GetDirectoryName(path)!);
            File.WriteAllText(path, text);

            var r = Commands.Push(root, client);
            Assert.Equal("rejected", r.Kind);
            Assert.Contains("unrecognized file extension", r.Reason);
            Assert.Contains(rel, r.Reason);
            Assert.Empty(ide.Recorded);
        }
        finally { host.Dispose(); TestUtil.ForceDelete(root); }
    }

    [Fact]
    public void Push_rejects_editing_a_read_only_item()
    {
        var ide = ConnectedIde(Prg(),
            FakeIde.Item.Library("Standard", "LIBRARY Standard\nNAMESPACE Standard\n"));
        var (root, host, client) = Bound(ide);
        try
        {
            Commands.Pull(root, client);
            var lib = Directory.EnumerateFiles(Path.Combine(root, "src"), "*.library", SearchOption.AllDirectories).Single();
            File.AppendAllText(lib, "\n(* tampered *)\n");

            var r = Commands.Push(root, client);
            Assert.Equal("rejected", r.Kind);
            Assert.Contains("read-only items can't be pushed", r.Reason);
        }
        finally { host.Dispose(); TestUtil.ForceDelete(root); }
    }

    [Fact]
    public void Push_applies_a_delete()
    {
        var ide = ConnectedIde(Prg(),
            FakeIde.Item.TextualPou("FB_Motor", "FUNCTION_BLOCK FB_Motor\nVAR\nEND_VAR", "y := 2;", "POUs"));
        var (root, host, client) = Bound(ide);
        try
        {
            Commands.Pull(root, client);
            File.Delete(Path.Combine(root, "src", "POUs", "FB_Motor.pou"));

            var r = Commands.Push(root, client);
            Assert.True(r.Kind == "ok", $"push rejected: {r.Reason}");
            Assert.Contains(ide.Recorded, x => x.StartsWith("delete:FB_Motor"));
        }
        finally { host.Dispose(); TestUtil.ForceDelete(root); }
    }

    [Fact]
    public void Push_applies_a_rename()
    {
        var ide = ConnectedIde(Prg(),
            FakeIde.Item.TextualPou("FB_Motor", "FUNCTION_BLOCK FB_Motor\nVAR\nEND_VAR", "y := 2;", "POUs"));
        var (root, host, client) = Bound(ide);
        try
        {
            Commands.Pull(root, client);
            var dir = Path.Combine(root, "src", "POUs");
            File.Move(Path.Combine(dir, "FB_Motor.pou"), Path.Combine(dir, "FB_Drive.pou"));

            var r = Commands.Push(root, client);
            Assert.True(r.Kind == "ok", $"push rejected: {r.Reason}");
            Assert.Contains(ide.Recorded, x => x.StartsWith("rename:FB_Motor"));
        }
        finally { host.Dispose(); TestUtil.ForceDelete(root); }
    }

    /// <summary>A CALLER THE IDE'S RENAME REWROTE IS AN IDE CHANGE THE CLIENT PULLS (openspec bridge-refusal-review 8.4).
    /// The rename rewrites <c>W_User</c>'s <c>inst : A_Motor</c> (DIALECT C2p), an item no op names. Adopting its new
    /// version over the workspace's OLD text hid the rewrite: the next pull saw nothing, and the next push of an edit to
    /// <c>W_User</c> passed its <c>ifVersion</c> gate and wrote the old name back over the rename. Its old version stays in
    /// the baseline instead, so status shows it incoming, the push says so, and a pull brings the rewrite in.</summary>
    [Fact]
    public void A_caller_the_rename_rewrote_is_incoming_and_a_pull_brings_the_rewrite_in()
    {
        var ide = new FakeIde(
            FakeIde.Item.TextualPou("A_Motor", "FUNCTION_BLOCK A_Motor\nVAR\nEND_VAR", ";"),
            FakeIde.Item.TextualPou("W_User", "PROGRAM W_User\nVAR\n\tinst : A_Motor;\nEND_VAR", "inst();"))
        { HealthConnected = true, HealthPlatform = "codesys", HealthProjectName = "Demo", RewritesReferencesOnRename = true };
        var (root, host, client) = Bound(ide);
        try
        {
            Assert.Equal("ok", Commands.Pull(root, client).Kind);
            var before = Sidecar.LoadIdeRefs(root)!.Items;
            File.Move(Path.Combine(root, "src", "A_Motor.pou"), Path.Combine(root, "src", "A_Drive.pou"));
            Git.CommitAll(root, "rename");

            var r = Commands.Push(root, client);

            Assert.True(r.Kind == "ok", $"push rejected: {r.Reason}");
            Assert.Contains("W_User.pou", r.Message ?? "");                                   // the push says so
            Assert.Equal(before["W_User.pou"], Sidecar.LoadIdeRefs(root)!.Items["W_User.pou"]);
            Assert.Contains("W_User.pou", Commands.Status(root, client).Incoming.Modified);
            Assert.Equal("ok", Commands.Pull(root, client).Kind);
            Assert.Contains("inst : A_Drive;", File.ReadAllText(Path.Combine(root, "src", "W_User.pou")));
            Assert.Equal(0, Commands.Status(root, client).Incoming.Count);
        }
        finally { host.Dispose(); TestUtil.ForceDelete(root); }
    }

    /// <summary>A FILE MOVED AND REWRITTEN PAST GIT'S RENAME THRESHOLD IS ONE MOVE+EDIT (openspec
    /// <c>push-without-header-check</c> 5.Q.6, design 5.Qb Q2). Git reports it as a <c>Delete</c> row plus an <c>Add</c>
    /// row; both map to the SAME item name, and the name is the identity, so the CLI pairs them into one
    /// <c>set</c> carrying the new folder, the text and the baseline's version. It used to send
    /// <c>deleteItem FB_Motor.pou</c> + <c>set FB_Motor.pou</c>, a batch that names one item twice and, forced, lost
    /// the object (and with it a class the wire does not carry: a check function, a persistent list — DIALECT C2n).</summary>
    [Fact]
    public void A_file_moved_and_rewritten_past_the_rename_threshold_pushes_one_move_and_edit()
    {
        var ide = ConnectedIde(Prg(),
            FakeIde.Item.TextualPou("FB_Motor", "FUNCTION_BLOCK FB_Motor\nVAR\nEND_VAR", "y := 2;", "POUs"));
        var (root, host, client) = Bound(ide);
        try
        {
            Commands.Pull(root, client);
            var from = Path.Combine(root, "src", "POUs", "FB_Motor.pou");
            Directory.CreateDirectory(Path.Combine(root, "src", "Drives"));
            File.Delete(from);
            // Nothing of the old text survives, so git cannot call it a rename.
            File.WriteAllText(Path.Combine(root, "src", "Drives", "FB_Motor.pou"),
                "FUNCTION_BLOCK FB_Motor\nVAR_INPUT\n\tbEnable : BOOL;\n\tnSpeedSetpoint : DINT;\nEND_VAR\n" +
                "VAR_OUTPUT\n\tbRunning : BOOL;\nEND_VAR\nIMPLEMENTATION ST\nbRunning := bEnable AND nSpeedSetpoint > 0;\n" +
                "END_FUNCTION_BLOCK\n");

            var r = Commands.Push(root, client);

            Assert.True(r.Kind == "ok", $"push rejected: {r.Reason}");
            Assert.DoesNotContain(ide.Recorded, x => x.StartsWith("delete:FB_Motor"));
            Assert.Contains(ide.Recorded, x => x.StartsWith("move:FB_Motor"));
            Assert.Contains(ide.Recorded, x => x.StartsWith("writecontent:FB_Motor"));
            Assert.Contains("bRunning := bEnable", ide.StoredImplementation("FB_Motor"));
            Assert.Equal(0, Commands.Status(root, client).Outgoing.Count);
        }
        finally { host.Dispose(); TestUtil.ForceDelete(root); }
    }

    /// <summary>GIT'S RENAME PAIRING IS NOT THE IDENTITY — THE NAME IS. The engineer deletes <c>FB_Alpha</c> and moves
    /// <c>FB_Beta</c> to another folder, rewriting it to closely resemble <c>FB_Alpha</c>'s old text. Git's similarity
    /// pairing then reports <c>Rename Alpha/FB_Alpha.pou → Drives/FB_Beta.pou</c> + <c>Delete Beta/FB_Beta.pou</c>, and
    /// taken at its word that is <c>set FB_Alpha.pou toName FB_Beta.pou</c> + <c>deleteItem FB_Beta.pou</c>: one name in
    /// two ops, refused by the bridge, with a remedy ("two pushes") a <c>volt push</c> cannot follow. By name it is
    /// <c>FB_Alpha</c> deleted and <c>FB_Beta</c> moved and edited, so a rename whose names another row also names is
    /// split back into its delete and its add, and paired by name like any other move+edit.</summary>
    [Fact]
    public void A_rename_that_git_paired_across_two_names_pushes_by_name()
    {
        const string alphaDecl = "FUNCTION_BLOCK FB_Alpha\nVAR_INPUT\n\tbEnable : BOOL;\n\tnSpeedSetpoint : DINT;\n\tnRamp : DINT;\nEND_VAR\nVAR_OUTPUT\n\tbRunning : BOOL;\n\tnActual : DINT;\nEND_VAR";
        const string alphaBody = "IF bEnable THEN\n\tnActual := nActual + nRamp;\n\tIF nActual > nSpeedSetpoint THEN\n\t\tnActual := nSpeedSetpoint;\n\tEND_IF\nELSE\n\tnActual := 0;\nEND_IF\nbRunning := nActual > 0;";
        var ide = ConnectedIde(Prg(),
            FakeIde.Item.TextualPou("FB_Alpha", alphaDecl, alphaBody, "Alpha"),
            FakeIde.Item.TextualPou("FB_Beta", "FUNCTION_BLOCK FB_Beta\nVAR\n\tq : WORD;\nEND_VAR", "q := q + 1;", "Beta"));
        var (root, host, client) = Bound(ide);
        try
        {
            Commands.Pull(root, client);
            var alpha = Path.Combine(root, "src", "Alpha", "FB_Alpha.pou");
            var betaText = File.ReadAllText(alpha).Replace("FB_Alpha", "FB_Beta");
            File.Delete(alpha);
            File.Delete(Path.Combine(root, "src", "Beta", "FB_Beta.pou"));
            Directory.CreateDirectory(Path.Combine(root, "src", "Drives"));
            File.WriteAllText(Path.Combine(root, "src", "Drives", "FB_Beta.pou"), betaText);

            var r = Commands.Push(root, client);

            Assert.True(r.Kind == "ok", $"push rejected: {r.Reason}");
            Assert.Contains(ide.Recorded, x => x == "delete:FB_Alpha");
            Assert.DoesNotContain(ide.Recorded, x => x.StartsWith("delete:FB_Beta") || x.StartsWith("rename:"));
            Assert.Contains(ide.Recorded, x => x.StartsWith("move:FB_Beta"));
            Assert.Contains("nActual := nActual + nRamp", ide.StoredImplementation("FB_Beta"));
            Assert.Equal(0, Commands.Status(root, client).Outgoing.Count);
        }
        finally { host.Dispose(); TestUtil.ForceDelete(root); }
    }

    /// <summary>A POU WHOSE TEXT CHANGES KIND IS ONE FILE THROUGHOUT (openspec <c>push-without-header-check</c> 5.Q). The
    /// text is written as sent, and CODESYS takes a POU's kind from it (DIALECT C2f) — but the wire names the object by
    /// its CLASS, so <c>X.pou</c> whose text now says <c>PROGRAM</c> is still <c>X.pou</c>: a plain content update, with
    /// no other name to report and no file to move. (Until 5.Q CODESYS published it as <c>X.prg</c> after a push of
    /// <c>X.fb</c>, and this test pinned the push naming the other name and the pull moving the file; the owner changed
    /// that premise with the one POU extension.) Its END line follows its header on the way back.</summary>
    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public void A_pou_whose_text_changes_kind_is_one_file_after_the_push_and_the_pull(bool existed)
    {
        var items = new System.Collections.Generic.List<FakeIde.Item> { Prg() };
        if (existed) items.Add(FakeIde.Item.TextualPou("X", "FUNCTION_BLOCK X\nVAR\n\tn : INT;\nEND_VAR", "n := 5;"));
        var ide = new FakeIde(items.ToArray())
        {
            HealthConnected = true, HealthPlatform = "codesys", HealthProjectName = "Demo",
        };
        var (root, host, client) = Bound(ide);
        try
        {
            Assert.Equal("ok", Commands.Pull(root, client).Kind);
            var dir = Path.Combine(root, "src");
            var file = Path.Combine(dir, "X.pou");
            File.WriteAllText(file, "PROGRAM X\nVAR\n\tn : INT;\nEND_VAR\nIMPLEMENTATION ST\nn := 6;\nEND_PROGRAM\n");

            var r = Commands.Push(root, client);

            Assert.True(r.Kind == "ok", $"push rejected: {r.Reason}");
            Assert.DoesNotContain(ide.Recorded, x => x.StartsWith("delete:") || x.StartsWith("rename:"));

            Assert.Equal("ok", Commands.Pull(root, client).Kind);
            Assert.Equal(new[] { "X.pou" }, Directory.GetFiles(dir, "X.*").Select(Path.GetFileName).ToArray());
            var held = File.ReadAllText(file);
            Assert.Contains("n := 6;", held);
            Assert.EndsWith("END_PROGRAM\n", held.Replace("\r\n", "\n"));
            Assert.Equal(0, Commands.Status(root, client).Outgoing.Count);
        }
        finally { host.Dispose(); TestUtil.ForceDelete(root); }
    }

    [Fact]
    public void Push_refuses_before_the_first_pull()
    {
        var ide = ConnectedIde(Prg());
        var (root, host, client) = Bound(ide);
        try
        {
            // bound but never pulled → no IDE baseline exists yet
            var r = Commands.Push(root, client);
            Assert.Equal("rejected", r.Kind);
            Assert.Contains("no IDE baseline yet", r.Reason);
        }
        finally { host.Dispose(); TestUtil.ForceDelete(root); }
    }

    [Fact]
    public void Push_refuses_outside_a_workspace()
    {
        var root = TestUtil.NewRepo(); // a git repo, but never `volt init`-bound (no .git/volt/config.json)
        try
        {
            // ConfigExists fails first, so the bridge is never contacted — a client on a dead pipe is fine.
            var r = Commands.Push(root, new BridgeClient(Pipe()));
            Assert.Equal("rejected", r.Kind);
            Assert.Contains("not a Volt workspace", r.Reason);
        }
        finally { TestUtil.ForceDelete(root); }
    }

    /// <summary>A FORCED PUSH DOES NOT MAKE THE CLIENT CLAIM ITEMS IT HAS NEVER SEEN.
    ///
    /// <para>The push receipt is a fresh FULL snapshot of the project, which it has to be — a native rename can
    /// rewrite the bodies of items outside the op set (TwinCAT does, CODESYS does not — DIALECT C2p), and their new versions must reach the baseline or the
    /// next push reports a phantom conflict. But `push --force` deliberately sends NO lease, so nothing has
    /// established that the client's view covered the project. An item the engineer added in the IDE since the
    /// last pull is in that receipt; adopted wholesale it goes into the sidecar at its current version, and from
    /// then on baseline == bridge, so `volt status` reports nothing and the file is missing from the workspace
    /// permanently and silently.</para>
    ///
    /// <para>Same shape as the unreadable-item bug, reached from the other side: an item that exists in the IDE
    /// and in no client view, with nothing anywhere saying so.</para></summary>
    [Fact]
    public void A_forced_push_does_not_adopt_an_item_the_workspace_never_had()
    {
        var ide = ConnectedIde(FakeIde.Item.TextualPou("PLC_PRG", "PROGRAM PLC_PRG\nVAR\nEND_VAR", "x := 1;"));
        var (root, host, client) = Bound(ide);
        try
        {
            Assert.Equal("ok", Commands.Pull(root, client).Kind);

            // The engineer adds a POU in the IDE. The workspace has never seen it.
            ide.AddItem(FakeIde.Item.TextualPou("Newcomer", "PROGRAM Newcomer\nVAR\nEND_VAR", "y := 2;"));

            // A local edit, pushed with --force (which sends no lease).
            var file = Path.Combine(root, "src", "PLC_PRG.pou");
            File.WriteAllText(file, File.ReadAllText(file).Replace("x := 1;", "x := 42;"));
            Git.CommitAll(root, "edit");
            Assert.Equal("ok", Commands.Push(root, client, force: true).Kind);

            // The IDE's own POU must still be waiting to be pulled.
            var status = Commands.Status(root, client);
            Assert.Contains("Newcomer.pou", status.Incoming.Added);
            Assert.False(File.Exists(Path.Combine(root, "src", "Newcomer.pou")));

            // …and pulling it actually brings it in, which is the whole point of not hiding it.
            Assert.Equal("ok", Commands.Pull(root, client).Kind);
            Assert.True(File.Exists(Path.Combine(root, "src", "Newcomer.pou")));
        }
        finally { host.Dispose(); TestUtil.ForceDelete(root); }
    }
}
